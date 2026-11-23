// 断网兜底：实时权威不可达时必须能继续/暂停/结束本机专注（P0 回归测试）
// 纯 JS 内存库替代 better-sqlite3，fetch 用桩替换真实网络。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createMemDb() {
  const sessions: any[] = [];
  const segments: any[] = [];
  const pauses: any[] = [];
  const metaStore = new Map<string, string>();
  return {
    sessions,
    segments,
    pauses,
    insertSession: (s: any) => sessions.push({ ...s }),
    updateSession: (s: any) => {
      const i = sessions.findIndex((x) => x.id === s.id);
      if (i >= 0) sessions[i] = { ...s };
      else sessions.push({ ...s });
    },
    getSession: (id: string) => sessions.find((x) => x.id === id) || null,
    getActiveSession: () => sessions.find((x) => x.status === 'active') || null,
    insertSegment: (s: any) => segments.push({ ...s }),
    updateSegment: (s: any) => {
      const i = segments.findIndex((x) => x.id === s.id);
      if (i >= 0) segments[i] = { ...s };
      else segments.push({ ...s });
    },
    listSegments: (sid: string) =>
      segments.filter((x) => x.sessionId === sid).sort((a, b) => a.startedAt - b.startedAt),
    getSegment: (id: string) => segments.find((x) => x.id === id) || null,
    deleteSegment: (id: string) => {
      const i = segments.findIndex((x) => x.id === id);
      if (i >= 0) segments.splice(i, 1);
    },
    insertPause: (p: any) => pauses.push({ ...p }),
    updatePause: (p: any) => {
      const i = pauses.findIndex((x) => x.id === p.id);
      if (i >= 0) pauses[i] = { ...p };
      else pauses.push({ ...p });
    },
    getOpenPause: (sid: string) =>
      pauses
        .filter((x) => x.sessionId === sid && x.pauseEndedAt == null)
        .sort((a, b) => b.pauseStartedAt - a.pauseStartedAt)[0] || null,
    listPauses: (sid: string) =>
      pauses.filter((x) => x.sessionId === sid).sort((a, b) => a.pauseStartedAt - b.pauseStartedAt),
    getMeta: (k: string) => metaStore.get(k) ?? null,
    setMeta: (k: string, v: string) => metaStore.set(k, v),
  };
}

const memDb = createMemDb();

vi.mock('../electron/db/index', () => ({
  initDatabase: () => null,
  getDb: () => null,
  getActiveSession: () => memDb.getActiveSession(),
  insertSession: (s: any) => memDb.insertSession(s),
  updateSession: (s: any) => memDb.updateSession(s),
  getSession: (id: string) => memDb.getSession(id),
  insertSegment: (s: any) => memDb.insertSegment(s),
  updateSegment: (s: any) => memDb.updateSegment(s),
  listSegments: (sid: string) => memDb.listSegments(sid),
  getSegment: (id: string) => memDb.getSegment(id),
  deleteSegment: (id: string) => memDb.deleteSegment(id),
  reassignPausesToSegment: (fromIds: string[], toId: string) => {
    for (const pause of memDb.pauses) {
      if (fromIds.includes(pause.segmentId)) pause.segmentId = toId;
    }
  },
  insertPause: (p: any) => memDb.insertPause(p),
  updatePause: (p: any) => memDb.updatePause(p),
  getOpenPause: (sid: string) => memDb.getOpenPause(sid),
  listPauses: (sid: string) => memDb.listPauses(sid),
  getMeta: (k: string) => memDb.getMeta(k),
  setMeta: (k: string, v: string) => memDb.setMeta(k, v),
}));

const CONNECTION = {
  endpoint: 'http://127.0.0.1:5999',
  accessToken: 'token',
  deviceId: 'desktop-test',
};

vi.mock('../electron/sync/deviceSyncService', () => ({
  getDeviceSyncRuntimeConnection: () => CONNECTION,
  setDeviceSyncLiveTelemetry: () => undefined,
  runDeviceSync: async () => undefined,
}));

import { TimerManager } from '../electron/timer/manager';
import { FocusTimerController } from '../electron/timer/focusTimerController';

const REMOTE_SESSION_ID = '11111111-2222-3333-4444-555555555555';
const REMOTE_SEGMENT_ID = '66666666-7777-8888-9999-aaaaaaaaaaaa';

function runningSnapshot(serverTime: number) {
  return {
    protocolVersion: 1,
    serverTime,
    snapshot: {
      revision: 7,
      state: 'running',
      session: {
        id: REMOTE_SESSION_ID,
        title: null,
        state: 'running',
        startedAt: serverTime - 600_000,
        activeElapsedMs: 600_000,
        pauseElapsedMs: 0,
        wallElapsedMs: 600_000,
        currentPauseStartedAt: null,
        segments: [{ id: REMOTE_SEGMENT_ID, startedAt: serverTime - 600_000, endedAt: null }],
        pauses: [],
        task: { taskId: 'task-1', taskSource: 'local', taskTitle: '写作' },
        updatedAt: serverTime - 1_000,
        lastCommandDeviceId: 'phone',
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function installFetch(commandBehaviour: 'offline' | 'conflict') {
  const mock = vi.fn(async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/sync/v2/live/command')) {
      if (commandBehaviour === 'conflict') return jsonResponse({ error: 'conflict' }, 409);
      throw new TypeError('fetch failed');
    }
    if (url.includes('/sync/v2/live/wait')) {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
          return;
        }
        signal?.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted.', 'AbortError')),
          { once: true },
        );
      });
    }
    return jsonResponse(runningSnapshot(Date.now()));
  });
  (globalThis as any).fetch = mock;
  return mock;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等待超时: ${label}`);
}

describe('实时专注断网兜底', () => {
  const realFetch = globalThis.fetch;
  let timer: TimerManager;
  let controller: FocusTimerController;

  beforeEach(() => {
    memDb.sessions.length = 0;
    memDb.segments.length = 0;
    memDb.pauses.length = 0;
    timer = new TimerManager();
    controller = new FocusTimerController(timer);
  });

  afterEach(() => {
    controller.dispose();
    (globalThis as any).fetch = realFetch;
  });

  it('实时命令传输失败时，结束专注落到本机账本且沿用远端 id', async () => {
    installFetch('offline');
    controller.reloadConfiguration();
    await waitFor(() => controller.getSnapshot().state === 'running', '进入实时运行态');
    expect((controller as any).liveMode).toBe(true);

    const snapshot = await controller.stop();

    expect(snapshot.state).toBe('finished');
    expect(snapshot.sessionId).toBe(REMOTE_SESSION_ID);
    // 本机账本只有一条会话、一条片段，id 与远端一致（重连后是同 id upsert）
    expect(memDb.sessions).toHaveLength(1);
    expect(memDb.sessions[0].id).toBe(REMOTE_SESSION_ID);
    expect(memDb.sessions[0].status).toBe('finished');
    expect(memDb.segments).toHaveLength(1);
    expect(memDb.segments[0].id).toBe(REMOTE_SEGMENT_ID);
    expect(memDb.segments[0].endedAt).not.toBeNull();
    // 降级后不再假装连着远端，但重连时仍记得要收口那条远端会话
    expect((controller as any).liveMode).toBe(false);
    expect((controller as any).localizedSessionId).toBe(REMOTE_SESSION_ID);
  });

  it('语义冲突（HTTP 409）不算断网，必须原样上抛', async () => {
    installFetch('conflict');
    controller.reloadConfiguration();
    await waitFor(() => controller.getSnapshot().state === 'running', '进入实时运行态');

    await expect(controller.stop()).rejects.toThrow(/HTTP 409/);
    expect(memDb.sessions).toHaveLength(0);
    expect((controller as any).liveMode).toBe(true);
  });

  it('接管断线快照时补齐 lastTick 之后的运行时长，不把冻结快照当总时长', () => {
    const now = Date.now();
    const startedAt = now - 58.5 * 60_000;
    const snapshot = {
      state: 'running' as const,
      sessionId: REMOTE_SESSION_ID,
      currentSegmentId: REMOTE_SEGMENT_ID,
      currentTaskId: null,
      currentTaskTitle: null,
      currentTaskSource: null,
      sessionDefaultTaskId: null,
      sessionDefaultTaskTitle: null,
      activeElapsedMs: 21.5 * 60_000,
      pauseElapsedMs: 0,
      wallElapsedMs: 21.5 * 60_000,
      currentPauseStartedAt: null,
      segments: [
        {
          id: REMOTE_SEGMENT_ID,
          taskId: null,
          taskTitle: null,
          taskSource: null,
          title: null,
          startedAt,
          endedAt: null,
          activeElapsedMs: 21.5 * 60_000,
        },
      ],
      pauseEvents: [],
      // 最后一份实时快照停在 37 分钟前；界面一直靠 lastTick 外推显示 58.5 分钟
      lastTick: now - 37 * 60_000,
    };

    expect(timer.adoptFromSnapshot(snapshot)).toBe(true);
    const finished = timer.stop();

    expect(finished.sessionId).toBe(REMOTE_SESSION_ID);
    expect(finished.state).toBe('finished');
    // session 与 segment 必须同口径，统计页求和不能再退回 21.5 分钟
    expect(memDb.segments[0].activeElapsedMs).toBe(memDb.sessions[0].activeElapsedMs);
  });

  it('本机已经结束的会话拒绝被远端活动快照接管，账本保持原值', () => {
    const now = Date.now();
    const startedAt = now - 58.5 * 60_000;
    memDb.insertSession({
      id: REMOTE_SESSION_ID,
      title: null,
      status: 'finished',
      startedAt,
      endedAt: startedAt + 58.5 * 60_000,
      activeElapsedMs: 3_513_747,
      pauseElapsedMs: 0,
      wallElapsedMs: 3_513_747,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
      note: null,
      createdAt: startedAt,
      updatedAt: startedAt + 58.5 * 60_000,
    });
    const snapshot = {
      state: 'paused' as const,
      sessionId: REMOTE_SESSION_ID,
      currentSegmentId: null,
      currentTaskId: null,
      currentTaskTitle: null,
      currentTaskSource: null,
      sessionDefaultTaskId: null,
      sessionDefaultTaskTitle: null,
      activeElapsedMs: 2.4 * 60 * 60_000,
      pauseElapsedMs: 0,
      wallElapsedMs: 2.4 * 60 * 60_000,
      currentPauseStartedAt: now,
      segments: [
        {
          id: REMOTE_SEGMENT_ID,
          taskId: null,
          taskTitle: null,
          taskSource: null,
          title: null,
          startedAt,
          endedAt: null,
          activeElapsedMs: 2.4 * 60 * 60_000,
        },
      ],
      pauseEvents: [],
      lastTick: now,
    };

    expect(timer.adoptFromSnapshot(snapshot)).toBe(false);
    expect(memDb.sessions).toHaveLength(1);
    expect(memDb.sessions[0].status).toBe('finished');
    expect(memDb.sessions[0].activeElapsedMs).toBe(3_513_747);
    expect(memDb.segments).toHaveLength(0);
  });

  it('重启后远端仍挂着本机已结束的会话时，先 abort 收口，不展示幽灵计时器', async () => {
    const now = Date.now();
    memDb.insertSession({
      id: REMOTE_SESSION_ID,
      title: null,
      status: 'finished',
      startedAt: now - 58.5 * 60_000,
      endedAt: now - 60_000,
      activeElapsedMs: 3_513_747,
      pauseElapsedMs: 0,
      wallElapsedMs: 3_513_747,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
      note: null,
      createdAt: now - 58.5 * 60_000,
      updatedAt: now - 60_000,
    });
    const commands: any[] = [];
    const fetchMock = vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/sync/v2/live/command')) {
        const body = JSON.parse(String(init?.body));
        commands.push(body);
        return jsonResponse({
          protocolVersion: 1,
          serverTime: now,
          snapshot: { revision: 271, state: 'idle', session: null },
          ack: {
            commandId: body.command.commandId,
            status: 'applied',
            revision: 271,
            errorCode: null,
            completedEntityId: REMOTE_SESSION_ID,
          },
        });
      }
      if (url.includes('/sync/v2/live/wait')) {
        const signal = init?.signal;
        return await new Promise<Response>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
            return;
          }
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          );
        });
      }
      return jsonResponse(runningSnapshot(now));
    });
    (globalThis as any).fetch = fetchMock;

    controller.reloadConfiguration();
    await waitFor(() => commands.length === 1, '收口远端幽灵会话');
    await waitFor(() => controller.getSnapshot().state === 'idle', '保持本机空闲账本');

    expect(commands[0].command.action).toBe('abort');
    expect(commands[0].command.sessionId).toBe(REMOTE_SESSION_ID);
    expect(memDb.sessions).toHaveLength(1);
    expect(memDb.sessions[0].status).toBe('finished');
    expect(memDb.sessions[0].activeElapsedMs).toBe(3_513_747);
    expect((controller as any).liveMode).toBe(true);
  });
});
