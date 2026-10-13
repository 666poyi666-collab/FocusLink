/**
 * 只读读取云端「实时专注（live focus）」快照。
 *
 * 为什么需要它：实时专注由设备同步服务托管，本机账本要等整场结束并确认后才落库
 * （2026-10-13 实测：界面显示「已暂停 · 累计 1:06:43」，而 `focuslink.db` 里根本没有这一场）。
 * 所以整点核对想知道「正在进行的任务」，只能读云端快照，不能读本地库。
 *
 * 红线：本模块只读——只发一个 GET，不发送任何命令（pause/resume/finish 都不碰）。
 */
import {
  LIVE_FOCUS_SNAPSHOT_PATH,
  type LiveFocusSnapshotResponse,
  type LiveFocusState,
} from '@shared/sync/liveFocusProtocol';
import { getDeviceSyncRuntimeConnection } from './deviceSyncService.js';
import { logger } from '../logger.js';

export interface LiveFocusView {
  /** false = 设备同步未启用 / 无凭据 / 请求失败，其余字段无意义。 */
  available: boolean;
  state: LiveFocusState | 'unknown';
  revision: number | null;
  sessionId: string | null;
  title: string | null;
  taskTitle: string | null;
  startedAt: number | null;
  activeElapsedMs: number | null;
  pauseElapsedMs: number | null;
  wallElapsedMs: number | null;
  currentPauseStartedAt: number | null;
  segmentCount: number;
  runningSegmentStartedAt: number | null;
  serverTime: number | null;
  error: string | null;
}

const REQUEST_TIMEOUT_MS = 8_000;

function unavailable(error: string | null): LiveFocusView {
  return {
    available: false,
    state: 'unknown',
    revision: null,
    sessionId: null,
    title: null,
    taskTitle: null,
    startedAt: null,
    activeElapsedMs: null,
    pauseElapsedMs: null,
    wallElapsedMs: null,
    currentPauseStartedAt: null,
    segmentCount: 0,
    runningSegmentStartedAt: null,
    serverTime: null,
    error,
  };
}

/** 读取云端实时专注快照；任何失败都以 `available:false` 返回，不抛异常。 */
export async function readLiveFocusSnapshot(): Promise<LiveFocusView> {
  let connection: ReturnType<typeof getDeviceSyncRuntimeConnection>;
  try {
    connection = getDeviceSyncRuntimeConnection();
  } catch (error) {
    // 凭据不可读（例如另一个进程里 safeStorage 不可用）必须如实说明，不能让调用方以为「没在专注」。
    return unavailable(
      `设备同步凭据读取失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!connection) {
    return unavailable('设备同步未启用或缺少凭据');
  }

  const url = `${connection.endpoint}${LIVE_FOCUS_SNAPSHOT_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${connection.accessToken}`,
      },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      let code = '';
      try {
        const body = (await response.json()) as { error?: { code?: unknown } };
        code = typeof body?.error?.code === 'string' ? body.error.code : '';
      } catch {
        code = '';
      }
      return unavailable(`实时快照返回 ${response.status}${code ? `（${code}）` : ''}`);
    }
    const payload = (await response.json()) as LiveFocusSnapshotResponse;
    const snapshot = payload?.snapshot;
    if (!snapshot) return unavailable('实时快照响应缺少 snapshot');
    const session = snapshot.session;
    if (!session) {
      return {
        ...unavailable(null),
        available: true,
        state: snapshot.state,
        revision: snapshot.revision,
        serverTime: payload.serverTime ?? null,
      };
    }
    const runningSegment = session.segments.find((segment) => segment.endedAt === null) ?? null;
    return {
      available: true,
      state: session.state,
      revision: snapshot.revision,
      sessionId: session.id,
      title: session.title ?? null,
      taskTitle: session.task?.taskTitle ?? null,
      startedAt: session.startedAt ?? null,
      activeElapsedMs: session.activeElapsedMs ?? null,
      pauseElapsedMs: session.pauseElapsedMs ?? null,
      wallElapsedMs: session.wallElapsedMs ?? null,
      currentPauseStartedAt: session.currentPauseStartedAt ?? null,
      segmentCount: session.segments.length,
      runningSegmentStartedAt: runningSegment?.startedAt ?? null,
      serverTime: payload.serverTime ?? null,
      error: null,
    };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'AbortError'
        ? `请求超时（${REQUEST_TIMEOUT_MS}ms）`
        : error instanceof Error
          ? error.message
          : String(error);
    logger.warn('liveFocus', 'live snapshot read failed', { url, error: reason });
    return unavailable(reason);
  } finally {
    clearTimeout(timer);
  }
}
