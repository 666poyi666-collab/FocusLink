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
});
