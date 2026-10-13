// 番茄 Todo 同步服务的会话级契约测试（2026-10-13 口径：一次专注会话 = 一条番茄记录）。
//
// 这个套件锁的是「对外可观察的行为」，不是内部实现：
//   - 记录粒度是会话：marker 用 `[FocusLink:tomatodo:session:<sessionId>]`，时长取会话累计专注毫秒；
//   - durable 重试队列存 sessionId（键 `tomatodo.pendingSessionIdsV161`）；
//   - 七条诚实性不变量：不谎报已同步、过期历史不重试、读状态无副作用、
//     失败留下重试意图、自定义标题不被降级回「学习」、缺手机通道时不清队列、同会话幂等。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusSegment, FocusSession, TomatodoSubject } from '@shared/types';
import type { PendingTomatodoRecord } from '../electron/integrations/tomatodo/localDb';

/** durable 重试队列的存储键；元素是 sessionId。 */
const DURABLE_KEY = 'tomatodo.pendingSessionIdsV161';

const harness = vi.hoisted(() => ({
  sessions: [] as FocusSession[],
  segments: [] as FocusSegment[],
  running: true,
  addSessionRecord: vi.fn(),
  updateNames: vi.fn(),
  writeBridge: vi.fn(),
  writeBatchBridge: vi.fn(),
  updateBridge: vi.fn(),
  deleteBridge: vi.fn(),
  ensureBridge: vi.fn(),
  writtenSessionMarkers: new Set<string>(),
  pendingRecords: [] as PendingTomatodoRecord[],
  recordStates: new Map<string, { exists: boolean; cloudSynced: boolean; recordId?: number }>(),
  settings: new Map<string, string>(),
}));

vi.mock('../electron/db/index', () => ({
  findTaskCache: () => null,
  getSegment: (id: string) => harness.segments.find((segment) => segment.id === id) ?? null,
  getSession: (id: string) => harness.sessions.find((session) => session.id === id) ?? null,
  listSegments: (sessionId: string) =>
    harness.segments.filter((segment) => segment.sessionId === sessionId),
  getSetting: (key: string) => harness.settings.get(key) ?? null,
  setSetting: (key: string, value: string) => {
    harness.settings.set(key, value);
  },
  setSessionTomatodoSubject: (sessionId: string, subject: TomatodoSubject | null) => {
    const session = harness.sessions.find((item) => item.id === sessionId);
    if (!session) return 0;
    session.tomatodoSubject = subject;
    return 1;
  },
  setSessionTomatodoRecordName: (sessionId: string, recordName: string | null) => {
    const session = harness.sessions.find((item) => item.id === sessionId);
    if (!session) return 0;
    session.tomatodoRecordName = recordName;
    return 1;
  },
}));

vi.mock('../electron/integrations/tomatodo/localDb', () => ({
  addTomatodoSessionRecord: harness.addSessionRecord,
  deleteTomatodoRecordBySessionId: vi.fn(() => ({ ok: true, deletedCount: 1 })),
  getTomatodoSessionRecordState: vi.fn((_dbPath: string, sessionId: string) =>
    Object.assign({ exists: false, cloudSynced: false }, harness.recordStates.get(sessionId)),
  ),
  isTomatodoRunningAsync: async () => harness.running,
  listPendingTomatodoRecords: () => harness.pendingRecords,
  resolveTomatodoDbPath: () => 'tomatodo_db.json',
  updateTomatodoSessionRecordNames: harness.updateNames,
}));

vi.mock('../electron/integrations/tomatodo/cloudBridge', () => ({
  deleteTomatodoRecordThroughBridge: harness.deleteBridge,
  updateTomatodoRecordNameThroughBridge: harness.updateBridge,
  writeTomatodoRecordsThroughBridge: harness.writeBatchBridge,
  writeTomatodoRecordThroughBridge: harness.writeBridge,
}));

vi.mock('../electron/integrations/tomatodo/bridgeLifecycle', () => ({
  ensureTomatodoBridge: harness.ensureBridge,
}));

vi.mock('../electron/settingsStore', () => ({
  getSettings: () => ({
    tomatodo: { enabled: true, dbPath: '', defaultSubject: '学习' },
  }),
}));

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  deleteTomatodoRecordForSession,
  getPendingTomatodoCount,
  getPendingTomatodoSummary,
  getTomatodoSyncStatus,
  setTomatodoRecordNameForSegment,
  setTomatodoRecordNameForSession,
  setTomatodoSubjectForSession,
  setTomatodoSubjectsForSegments,
  syncSegmentToTomatodo,
  syncSessionToTomatodo,
  uploadPendingTomatodoRecords,
} from '../electron/sync/tomatodoSyncService';
import {
  buildTomatodoSessionRecord,
  parseTomatodoMarker,
  TOMATODO_CLOUD_UPLOAD_WINDOW_MS,
  tomatodoRecordMinutes,
} from '../shared/tomatodoPolicy';

function makeSession(overrides: Partial<FocusSession> = {}): FocusSession {
  const endedAt = Date.now() - 1_000;
  const startedAt = endedAt - 60_000;
  return {
    id: 'session-1',
    title: null,
    status: 'finished',
    startedAt,
    endedAt,
    activeElapsedMs: 60_000,
    pauseElapsedMs: 0,
    wallElapsedMs: 60_000,
    defaultTaskId: null,
    defaultTaskSource: null,
    defaultTaskTitle: null,
    note: null,
    createdAt: startedAt,
    updatedAt: endedAt,
    tomatodoSubject: null,
    tomatodoRecordName: null,
    ...overrides,
  };
}

function makeSegment(overrides: Partial<FocusSegment> = {}): FocusSegment {
  const endedAt = Date.now() - 1_000;
  const startedAt = endedAt - 60_000;
  return {
    id: 'segment-1',
    sessionId: 'session-1',
    taskId: null,
    taskSource: null,
    title: '普通任务',
    startedAt,
    endedAt,
    activeElapsedMs: 60_000,
    note: null,
    cloudFocusId: null,
    tomatodoSubject: null,
    tomatodoRecordName: null,
    createdAt: startedAt,
    updatedAt: endedAt,
    ...overrides,
  };
}

function makePendingSessionRecord(
  overrides: Partial<PendingTomatodoRecord> = {},
): PendingTomatodoRecord {
  return {
    recordId: 486,
    markerKind: 'session',
    markerId: 'session-1',
    segmentId: null,
    sessionId: 'session-1',
    name: '学习',
    time: 1,
    startDate: Date.now() - 60_000,
    isSynced: 0,
    ...overrides,
  };
}

function durableSessionIds(): string[] {
  return JSON.parse(harness.settings.get(DURABLE_KEY) ?? '[]') as string[];
}

function sessionMarker(sessionId: string): string {
  return `[FocusLink:tomatodo:session:${sessionId}]`;
}

function firstSession(): FocusSession {
  const session = harness.sessions[0];
  if (!session) throw new Error('test harness has no session');
  return session;
}

function unavailableBridge(): Record<string, unknown> {
  return {
    available: false,
    ok: false,
    recordFound: false,
    localWritten: false,
    localChanged: false,
    uploadConfirmed: false,
    cloudRecordReadbackSupported: false,
    skipped: false,
    error: 'tomatodo_bridge_unavailable',
  };
}

function confirmedBridge(): Record<string, unknown> {
  return {
    available: true,
    ok: true,
    recordFound: true,
    localWritten: true,
    localChanged: true,
    uploadConfirmed: true,
    cloudRecordReadbackSupported: false,
    skipped: false,
    recordId: 486,
  };
}

function resetHarness(): void {
  harness.sessions = [makeSession()];
  harness.segments = [makeSegment()];
  harness.running = true;
  harness.settings.clear();
  harness.pendingRecords = [];
  harness.recordStates.clear();
  harness.writtenSessionMarkers.clear();
  harness.addSessionRecord.mockReset();
  harness.updateNames.mockReset();
  harness.writeBridge.mockReset();
  harness.writeBatchBridge.mockReset();
  harness.updateBridge.mockReset();
  harness.deleteBridge.mockReset();
  harness.ensureBridge.mockReset();

  // 真实 localDb 的幂等判据是 marker 是否已存在；这里按同一规则记账，
  // 让「同一会话第二次写入不产生第二条 PCRecord」在服务层可被观察。
  harness.addSessionRecord.mockImplementation((_dbPath: string, input: { sessionId: string }) => {
    const marker = sessionMarker(input.sessionId);
    if (harness.writtenSessionMarkers.has(marker)) return { ok: true, skipped: true };
    harness.writtenSessionMarkers.add(marker);
    return { ok: true, skipped: false, recordId: 486 };
  });
  harness.updateNames.mockImplementation(
    (_dbPath: string, updates: Array<{ sessionId: string }>) => {
      const foundKeys = updates
        .filter((update) => harness.recordStates.has(update.sessionId))
        .map((update) => update.sessionId);
      return { ok: true, foundKeys, updatedCount: foundKeys.length };
    },
  );
}

describe('tomatodo session record mapping (one focus session = one PCRecord)', () => {
  beforeEach(() => {
    resetHarness();
  });

  it('rounds the session active time to the integer minutes FocusLink shows', () => {
    // 7.5046 分 → 8 分钟；114.0351 分 → 114 分钟（界面与番茄必须显示同一个数）。
    expect(tomatodoRecordMinutes(450_276)).toBe(8);
    expect(tomatodoRecordMinutes(6_842_106)).toBe(114);
    // 不足 1 分钟的会话没有可表达的时长，按 1 分钟记录而不是 0。
    expect(tomatodoRecordMinutes(0)).toBe(1);
    expect(tomatodoRecordMinutes(-5)).toBe(1);
    expect(tomatodoRecordMinutes(89_999)).toBe(1);
  });

  it('derives createDate from startedAt + displayed minutes and stamps the session marker', () => {
    const startedAt = 1_700_000_000_000;
    const record = buildTomatodoSessionRecord({
      sessionId: 'session-x',
      subject: '数学',
      recordName: '数学错题回顾',
      startedAt,
      activeElapsedMs: 450_276,
    });

    expect(record.time).toBe(8);
    expect(record.startDate).toBe(startedAt);
    expect(record.createDate).toBe(startedAt + 8 * 60_000);
    expect(record.name).toBe('数学错题回顾');
    expect(record.s1).toBe(sessionMarker('session-x'));
    expect(parseTomatodoMarker(record.s1)).toEqual({ kind: 'session', id: 'session-x' });
    // 新记录必须是待同步，只有番茄云接口确认后才能置 1。
    expect(record.isSynced).toBe(0);
  });

  it('falls back to the subject as the record name when no custom title is set', () => {
    const record = buildTomatodoSessionRecord({
      sessionId: 'session-x',
      subject: '学习',
      recordName: '   ',
      startedAt: 1_700_000_000_000,
      activeElapsedMs: 60_000,
    });

    expect(record.name).toBe('学习');
    expect(record.time).toBe(1);
  });

  it('writes the session-scoped record through the bridge, not a per-segment one', async () => {
    const session = makeSession({ activeElapsedMs: 450_276 });
    harness.sessions = [session];
    harness.writeBridge.mockResolvedValue(confirmedBridge());

    await syncSessionToTomatodo('session-1');

    const written = harness.writeBridge.mock.calls[0]?.[0] as {
      name: string;
      time: number;
      startDate: number;
      createDate: number;
      s1: string;
    };
    expect(written.name).toBe('学习');
    expect(written.time).toBe(8);
    expect(written.startDate).toBe(session.startedAt);
    expect(written.createDate).toBe(session.startedAt + 8 * 60_000);
    expect(written.s1).toBe(sessionMarker('session-1'));
  });
});

describe('tomatodo sync service bridge safety and state', () => {
  beforeEach(() => {
    resetHarness();
  });

  it('does not count a skipped missing subject marker as externally found', async () => {
    harness.updateBridge.mockResolvedValue({
      ...unavailableBridge(),
      available: true,
      ok: true,
      recordFound: false,
      skipped: true,
    });

    const result = await setTomatodoSubjectForSession('session-1', '数学');

    expect(result).toMatchObject({
      ok: true,
      updatedCount: 1,
      externalFoundCount: 0,
      externalUpdatedCount: 0,
    });
    expect(durableSessionIds()).toEqual([]);
  });

  it('persists a marker-backed subject update when the running bridge is unavailable', async () => {
    harness.recordStates.set('session-1', { exists: true, cloudSynced: true });
    harness.updateBridge.mockResolvedValue(unavailableBridge());

    const result = await setTomatodoSubjectForSession('session-1', '数学');

    expect(result).toMatchObject({ ok: false, updatedCount: 1, externalFoundCount: 0 });
    expect(durableSessionIds()).toEqual(['session-1']);
    expect(getTomatodoSyncStatus('session-1')).toMatchObject({
      sessionId: 'session-1',
      writtenLocally: true,
      cloudSynced: false,
      state: 'confirmation-pending',
      subject: '数学',
    });
  });

  it('reports a session-compatible segments view pointing at the same single record', () => {
    harness.segments = [
      makeSegment(),
      makeSegment({ id: 'segment-2', startedAt: Date.now() - 30_000 }),
    ];
    harness.sessions = [
      makeSession({ tomatodoSubject: '数学', tomatodoRecordName: '数学错题回顾' }),
    ];

    const status = getTomatodoSyncStatus('session-1');

    expect(status).toMatchObject({
      sessionId: 'session-1',
      subject: '数学',
      source: 'manual',
      recordName: '数学错题回顾',
      customRecordName: '数学错题回顾',
      minutes: 1,
    });
    expect(status.segments.map((item) => item.segmentId)).toEqual(['segment-1', 'segment-2']);
    for (const item of status.segments) {
      expect(item).toMatchObject({
        recordName: '数学错题回顾',
        customRecordName: '数学错题回顾',
        subject: '数学',
        synced: false,
        state: 'not-written',
      });
    }
  });

  it('distinguishes expired unconfirmed history from previously confirmed uploads', () => {
    harness.sessions = [
      makeSession({ startedAt: Date.now() - TOMATODO_CLOUD_UPLOAD_WINDOW_MS - 60_000 }),
    ];
    harness.recordStates.set('session-1', { exists: true, cloudSynced: false });
    expect(getTomatodoSyncStatus('session-1')).toMatchObject({
      state: 'expired-history',
      writtenLocally: true,
      cloudSynced: false,
    });

    harness.recordStates.set('session-1', { exists: true, cloudSynced: true });
    expect(getTomatodoSyncStatus('session-1')).toMatchObject({
      state: 'cloud-synced',
      cloudSynced: true,
    });

    harness.settings.set(DURABLE_KEY, JSON.stringify(['session-1']));
    expect(getTomatodoSyncStatus('session-1')).toMatchObject({
      state: 'expired-history',
      cloudSynced: false,
    });
    expect(durableSessionIds()).toEqual(['session-1']);
  });

  it('reads status without mutating the durable queue or writing external records', () => {
    harness.recordStates.set('session-1', { exists: true, cloudSynced: false });
    harness.settings.set(DURABLE_KEY, JSON.stringify(['session-1']));
    const before = harness.settings.get(DURABLE_KEY);

    const status = getTomatodoSyncStatus('session-1');

    expect(status).toMatchObject({ state: 'confirmation-pending' });
    // The read path must not clear the durable marker nor write any external record.
    expect(harness.settings.get(DURABLE_KEY)).toBe(before);
    expect(harness.addSessionRecord).not.toHaveBeenCalled();
    expect(harness.updateBridge).not.toHaveBeenCalled();
  });

  it('does not let a pending new subject borrow an old cloud confirmation', () => {
    harness.recordStates.set('session-1', { exists: true, cloudSynced: true });
    harness.settings.set(DURABLE_KEY, JSON.stringify(['session-1']));

    const status = getTomatodoSyncStatus('session-1');

    // A newer intent (here a subject change) is still durable-pending, so the previously
    // confirmed isSynced=1 for the OLD subject must not be presented as current.
    expect(status).toMatchObject({
      sessionId: 'session-1',
      writtenLocally: true,
      cloudSynced: false,
      state: 'confirmation-pending',
    });
    expect(status.segments[0]).toMatchObject({
      segmentId: 'segment-1',
      cloudSynced: false,
      synced: false,
      state: 'confirmation-pending',
    });
  });

  it('keeps expired history honest even when a durable marker lingers', () => {
    harness.sessions = [
      makeSession({ startedAt: Date.now() - TOMATODO_CLOUD_UPLOAD_WINDOW_MS - 60_000 }),
    ];
    harness.recordStates.set('session-1', { exists: true, cloudSynced: false });
    harness.settings.set(DURABLE_KEY, JSON.stringify(['session-1']));

    const status = getTomatodoSyncStatus('session-1');

    expect(status).toMatchObject({
      state: 'expired-history',
      cloudSynced: false,
    });
    expect(status.segments[0]).toMatchObject({ synced: false, cloudSynced: false });
  });

  it('persists only marker-backed failures from a batch subject update', async () => {
    harness.sessions = [makeSession(), makeSession({ id: 'session-2' })];
    harness.segments = [
      makeSegment(),
      makeSegment({ id: 'segment-2', sessionId: 'session-2', startedAt: 62_000, endedAt: 122_000 }),
    ];
    harness.recordStates.set('session-1', { exists: true, cloudSynced: true });
    harness.updateBridge.mockResolvedValue(unavailableBridge());

    const result = await setTomatodoSubjectsForSegments(['segment-1', 'segment-2'], '物理');

    expect(result).toMatchObject({ ok: false, updatedCount: 2 });
    // 片段批量入口按会话去重：两个片段各属一个会话，只有已存在记录的那个留下重试意图。
    expect(durableSessionIds()).toEqual(['session-1']);
  });

  it('fails safely when the running app bridge is unavailable and never writes JSON directly', async () => {
    harness.writeBridge.mockResolvedValue(unavailableBridge());

    const result = await syncSegmentToTomatodo('segment-1');

    expect(result).toMatchObject({
      ok: false,
      localWritten: false,
      cloudSynced: false,
      syncState: 'failed',
      subject: '学习',
    });
    expect(harness.addSessionRecord).not.toHaveBeenCalled();
    expect(durableSessionIds()).toEqual(['session-1']);
  });

  it('reports a locally written but unconfirmed upload as cloud-pending', async () => {
    harness.writeBridge.mockResolvedValue({
      ...confirmedBridge(),
      uploadConfirmed: false,
      cloudError: 'offline',
    });

    const result = await syncSegmentToTomatodo('segment-1');

    expect(result).toMatchObject({
      ok: true,
      localWritten: true,
      cloudSynced: false,
      syncState: 'cloud-pending',
      error: 'offline',
    });
    expect(harness.addSessionRecord).not.toHaveBeenCalled();
  });

  it('uses cloud-synced only for an upload-confirmed bridge result', async () => {
    harness.writeBridge.mockResolvedValue(confirmedBridge());

    const result = await syncSegmentToTomatodo('segment-1');

    expect(result).toMatchObject({
      ok: true,
      localWritten: true,
      cloudSynced: true,
      syncState: 'cloud-synced',
    });
    expect(durableSessionIds()).toEqual([]);
  });

  it('keeps a durable pending marker when cloud upload succeeds but phone delivery is unavailable', async () => {
    harness.writeBridge.mockResolvedValue({
      ...confirmedBridge(),
      phoneSyncConfirmed: false,
      phoneSyncError: 'tomatodo_phone_not_connected',
    });

    const result = await syncSegmentToTomatodo('segment-1');

    // 云端已确认但手机通道缺失：对外仍是 confirmation-pending，且 durable 意图必须保留。
    expect(result).toMatchObject({
      ok: true,
      cloudSynced: true,
      phoneSynced: false,
      syncState: 'confirmation-pending',
      error: 'tomatodo_phone_not_connected',
    });
    expect(durableSessionIds()).toEqual(['session-1']);
  });

  it('saves a custom record title on the session and pushes it to the running bridge', async () => {
    harness.updateBridge.mockResolvedValue(confirmedBridge());

    const result = await setTomatodoRecordNameForSession('session-1', '  数学错题回顾  ');

    expect(result).toMatchObject({ ok: true, updatedCount: 1 });
    expect(firstSession().tomatodoRecordName).toBe('数学错题回顾');
    expect(harness.updateBridge).toHaveBeenCalledWith('session-1', '数学错题回顾', {
      syncToPhone: true,
    });
    expect(harness.addSessionRecord).not.toHaveBeenCalled();
  });

  it('lets the compat segment entry set the title of the whole session', async () => {
    harness.updateBridge.mockResolvedValue(confirmedBridge());

    await setTomatodoRecordNameForSegment('segment-1', '数学错题回顾');

    expect(firstSession().tomatodoRecordName).toBe('数学错题回顾');
    expect(harness.updateBridge).toHaveBeenCalledWith('session-1', '数学错题回顾', {
      syncToPhone: true,
    });
  });

  it('clearing the custom title falls back to the subject as the record name', async () => {
    harness.sessions = [
      makeSession({ tomatodoSubject: '数学', tomatodoRecordName: '数学错题回顾' }),
    ];
    harness.updateBridge.mockResolvedValue(confirmedBridge());

    await setTomatodoRecordNameForSession('session-1', null);

    expect(firstSession().tomatodoRecordName).toBeNull();
    expect(harness.updateBridge).toHaveBeenCalledWith('session-1', '数学', { syncToPhone: true });
  });

  it('keeps a durable retry intent when a session rename fails externally', async () => {
    harness.sessions = [makeSession({ tomatodoRecordName: '数学错题回顾' })];
    harness.recordStates.set('session-1', { exists: true, cloudSynced: true });
    harness.updateBridge.mockResolvedValue(unavailableBridge());

    const result = await setTomatodoRecordNameForSession('session-1', '数学错题回顾');

    expect(result.ok).toBe(false);
    expect(firstSession().tomatodoRecordName).toBe('数学错题回顾');
    expect(durableSessionIds()).toEqual(['session-1']);
  });

  it('reports the custom title in the sync status without touching the durable queue', () => {
    harness.sessions = [
      makeSession({ tomatodoSubject: '数学', tomatodoRecordName: '数学错题回顾' }),
    ];

    const status = getTomatodoSyncStatus('session-1');

    expect(status).toMatchObject({
      subject: '数学',
      source: 'manual',
      recordName: '数学错题回顾',
      customRecordName: '数学错题回顾',
    });
    expect(harness.settings.has(DURABLE_KEY)).toBe(false);
    expect(harness.addSessionRecord).not.toHaveBeenCalled();
    expect(harness.updateBridge).not.toHaveBeenCalled();
  });

  it('writes exactly one record per session when several segments are synced separately', async () => {
    harness.running = false;
    const session = makeSession({ activeElapsedMs: 120_000 });
    harness.sessions = [session];
    harness.segments = [
      makeSegment(),
      makeSegment({ id: 'segment-2', startedAt: Date.now() - 30_000, activeElapsedMs: 20_000 }),
    ];

    const first = await syncSegmentToTomatodo('segment-1');
    const second = await syncSegmentToTomatodo('segment-2');

    expect(first).toMatchObject({ ok: true, skipped: false });
    // 第二次写入拿到同一条会话记录：marker 已存在，番茄侧不会产生第二条 PCRecord。
    expect(second).toMatchObject({ ok: true, skipped: true });
    expect(harness.addSessionRecord).toHaveBeenCalledTimes(2);
    for (const call of harness.addSessionRecord.mock.calls) {
      expect(call[1]).toMatchObject({
        sessionId: 'session-1',
        // 会话累计专注时长，而不是单个片段的时长。
        activeElapsedMs: 120_000,
        startedAt: session.startedAt,
      });
    }
    expect(harness.writtenSessionMarkers).toEqual(new Set([sessionMarker('session-1')]));
  });

  it('clears the durable intent when a session record is deleted', async () => {
    harness.settings.set(DURABLE_KEY, JSON.stringify(['session-1']));
    harness.deleteBridge.mockResolvedValue({
      available: true,
      ok: true,
      deletedCount: 1,
      cleanupScope: 'local-record-only',
      remoteDeleteSupported: false,
    });

    const result = await deleteTomatodoRecordForSession('session-1');

    expect(result).toEqual({ ok: true, deletedCount: 1 });
    expect(durableSessionIds()).toEqual([]);
  });

  it('serializes concurrent session uploads through one service-level operation slot', async () => {
    let active = 0;
    let maxActive = 0;
    harness.writeBridge.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return confirmedBridge();
    });

    await Promise.all([syncSegmentToTomatodo('segment-1'), syncSegmentToTomatodo('segment-1')]);

    expect(maxActive).toBe(1);
  });
});

describe('tomatodo pending upload queue (session-level)', () => {
  beforeEach(() => {
    resetHarness();
  });

  it('never downgrades a custom session title to 学习 when replaying a pending upload', async () => {
    // FL-SYNC-018 回归：已落库记录名是自定义标题时，上传必须带上会话当前标题，
    // 而不是旧代码的 `isTomatodoSubject(record.name) ? record.name : 学习`。
    harness.sessions = [
      makeSession({ tomatodoSubject: '数学', tomatodoRecordName: '数学错题回顾' }),
    ];
    harness.pendingRecords = [
      makePendingSessionRecord({ recordId: 486, name: '学习', time: 63.05 }),
    ];
    harness.writeBatchBridge.mockResolvedValue({
      available: true,
      ok: true,
      results: [{ ...confirmedBridge(), localChanged: false, skipped: true, recordId: 486 }],
    });

    const result = await uploadPendingTomatodoRecords();

    expect(result).toMatchObject({ ok: true, total: 1, uploaded: 1, failed: 0 });
    const uploaded = harness.writeBatchBridge.mock.calls[0]?.[0] as Array<{
      name: string;
      s1: string;
      time: number;
    }>;
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.name).toBe('数学错题回顾');
    expect(uploaded[0]?.s1).toBe(sessionMarker('session-1'));
    expect(uploaded[0]?.time).toBe(1);
  });

  it('replays a durable session that never reached the TomaToDo JSON', async () => {
    harness.settings.set(DURABLE_KEY, JSON.stringify(['session-1']));
    harness.writeBatchBridge.mockResolvedValue({
      available: true,
      ok: true,
      results: [confirmedBridge()],
    });

    const result = await uploadPendingTomatodoRecords();

    expect(result).toEqual({
      ok: true,
      total: 1,
      uploaded: 1,
      failed: 0,
      expired: 0,
      error: undefined,
    });
    expect(harness.writeBatchBridge).toHaveBeenCalledTimes(1);
    expect(durableSessionIds()).toEqual([]);
    expect(harness.ensureBridge).not.toHaveBeenCalled();
  });

  it('does not clear durable pending when cloud upload succeeds without phone delivery', async () => {
    harness.settings.set(DURABLE_KEY, JSON.stringify(['session-1']));
    harness.writeBatchBridge.mockResolvedValue({
      available: true,
      ok: true,
      results: [
        {
          ...confirmedBridge(),
          localChanged: false,
          skipped: true,
          phoneSyncConfirmed: false,
          phoneSyncError: 'tomatodo_phone_not_connected',
        },
      ],
    });

    const result = await uploadPendingTomatodoRecords();

    expect(result).toMatchObject({ ok: false, total: 1, uploaded: 0, failed: 1 });
    expect(durableSessionIds()).toEqual(['session-1']);
  });

  it('counts only session-level records in the pending summary', () => {
    harness.settings.set(DURABLE_KEY, JSON.stringify(['session-1']));
    harness.pendingRecords = [
      // 片段级历史记录没有会话口径，永远不会被重传，也不计入待传。
      makePendingSessionRecord({
        recordId: 300,
        markerKind: 'segment',
        markerId: 'segment-legacy',
        segmentId: 'segment-legacy',
        sessionId: null,
        name: '英语',
      }),
      makePendingSessionRecord({ recordId: 486 }),
    ];

    expect(getPendingTomatodoSummary()).toEqual({ total: 1, uploadable: 1, expired: 0 });
    expect(getPendingTomatodoCount()).toBe(1);
  });

  it('keeps expired history locally while removing it from upload and retry counts', async () => {
    const startedAt = Date.now() - TOMATODO_CLOUD_UPLOAD_WINDOW_MS - 120_000;
    harness.sessions = [makeSession({ startedAt, endedAt: startedAt + 60_000 })];
    harness.segments = [
      makeSegment({ startedAt, endedAt: startedAt + 60_000, activeElapsedMs: 60_000 }),
    ];
    harness.pendingRecords = [makePendingSessionRecord({ recordId: 299, startDate: startedAt })];

    expect(getPendingTomatodoSummary()).toEqual({ total: 1, uploadable: 0, expired: 1 });
    expect(getPendingTomatodoCount()).toBe(0);
    const result = await uploadPendingTomatodoRecords({ ensureBridge: true });

    expect(result).toMatchObject({
      ok: true,
      total: 1,
      uploaded: 0,
      failed: 0,
      expired: 1,
    });
    expect(result.error).toContain('已停止自动重试');
    expect(harness.ensureBridge).not.toHaveBeenCalled();
    expect(harness.writeBatchBridge).not.toHaveBeenCalled();
    expect(harness.pendingRecords).toHaveLength(1);
  });

  it('ensures and launches the bridge only for an explicit manual pending upload', async () => {
    harness.running = false;
    harness.settings.set(DURABLE_KEY, JSON.stringify(['session-1']));
    harness.ensureBridge.mockResolvedValue({
      state: 'connected',
      connected: true,
      running: true,
      installed: true,
      launched: true,
      executablePath: 'C:\\Program Files\\TomaToDo\\TomaToDo.exe',
    });
    harness.writeBatchBridge.mockResolvedValue({
      available: true,
      ok: true,
      results: [confirmedBridge()],
    });

    const result = await uploadPendingTomatodoRecords({ ensureBridge: true });

    expect(result).toEqual({
      ok: true,
      total: 1,
      uploaded: 1,
      failed: 0,
      expired: 0,
      error: undefined,
    });
    expect(harness.ensureBridge).toHaveBeenCalledTimes(1);
    expect(harness.writeBatchBridge).toHaveBeenCalledTimes(1);
    expect(harness.addSessionRecord).not.toHaveBeenCalled();
  });

  it('writes a durable bridge failure to local JSON after TomaToDo closes', async () => {
    harness.running = false;
    harness.settings.set(DURABLE_KEY, JSON.stringify(['session-1']));

    const result = await uploadPendingTomatodoRecords();

    expect(result).toMatchObject({ ok: false, total: 1, uploaded: 0, failed: 0 });
    expect(result.error).toContain('已安全写入本地待传队列');
    expect(harness.addSessionRecord).toHaveBeenCalledTimes(1);
    expect(harness.addSessionRecord.mock.calls[0]?.[1]).toMatchObject({
      sessionId: 'session-1',
    });
    expect(durableSessionIds()).toEqual(['session-1']);
  });

  it('drops retry intent for a durable session that can never become uploadable', async () => {
    // 会话已不存在：重试永远不会成功，队列只应清掉意图，不报错、不上传。
    harness.settings.set(DURABLE_KEY, JSON.stringify(['session-missing']));

    const result = await uploadPendingTomatodoRecords();

    expect(result).toMatchObject({ ok: true, total: 0, uploaded: 0, expired: 0 });
    expect(durableSessionIds()).toEqual([]);
    expect(harness.writeBatchBridge).not.toHaveBeenCalled();
  });

  it('reconciles a transient bridge failure when TomaToDo confirms the record moments later', async () => {
    harness.pendingRecords = [makePendingSessionRecord({ recordId: 212, name: '学习' })];
    harness.writeBatchBridge.mockResolvedValue({
      available: true,
      ok: false,
      results: [
        {
          ...confirmedBridge(),
          ok: false,
          localChanged: false,
          uploadConfirmed: false,
          cloudError: 'transient startup race',
        },
      ],
    });
    setTimeout(() => {
      harness.recordStates.set('session-1', { exists: true, cloudSynced: true });
    }, 50);

    const result = await uploadPendingTomatodoRecords();

    expect(result).toEqual({
      ok: true,
      total: 1,
      uploaded: 1,
      failed: 0,
      expired: 0,
      error: undefined,
    });
  });

  it('keeps a failed bridge upload pending instead of borrowing a confirmation that never came', async () => {
    harness.pendingRecords = [makePendingSessionRecord({ recordId: 213, name: '数学错题回顾' })];
    harness.recordStates.set('session-1', { exists: true, cloudSynced: false });
    harness.settings.set(DURABLE_KEY, JSON.stringify(['session-1']));
    harness.writeBatchBridge.mockResolvedValue({
      available: true,
      ok: false,
      results: [
        {
          ...confirmedBridge(),
          ok: false,
          uploadConfirmed: false,
          cloudError: 'cloud_upload_failed',
        },
      ],
    });

    const result = await uploadPendingTomatodoRecords();

    expect(result).toMatchObject({ ok: false, total: 1, uploaded: 0, failed: 1, expired: 0 });
    // 桥报失败、宽限窗口内番茄也没有把它落成 isSynced=1：重试意图必须留着，绝不能当成已上传。
    expect(durableSessionIds()).toEqual(['session-1']);
  }, 10_000);
});
