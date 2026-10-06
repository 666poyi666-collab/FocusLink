// 实时（多端）会话的本地投影。
//
// 背景：deviceSync.liveControlEnabled 打开后，进行中的会话事实来源在云端 Durable Object，
// 主进程 start() 不再往本地 SQLite 写 focus_sessions / focus_segments 行；而统计页与
// 会话账本只读 SQLite，于是「今日统计」和第三栏都看不到正在进行中的这次专注。
//
// 这里把 timer.getSnapshot() 里的进行中会话映射成 FocusSession / FocusSegment / PauseEvent，
// 由 sessions:list / sessions:get / sessions:analytics 注入，避免改 SQL 或伪造数据库行。
// 本地模式下会话已经落库，hasLocalSession 会返回 true，投影直接放弃，不会重复计数。

import type { FocusSegment, FocusSession, PauseEvent, TimerSnapshot } from '@shared/types';

export interface LiveSessionProjection {
  session: FocusSession;
  segments: FocusSegment[];
  pauses: PauseEvent[];
}

/**
 * 把进行中的实时会话投影成本地记录形状。
 *
 * @param snapshot 主进程计时器快照（实时会话的片段来自云端快照）
 * @param hasLocalSession 判断该会话是否已经在本地库中存在（存在则说明是本地模式，不要投影）
 * @returns 需要注入的记录；本地会话、空闲状态或没有片段时返回 null
 */
export function projectLiveSession(
  snapshot: TimerSnapshot,
  hasLocalSession: (sessionId: string) => boolean,
): LiveSessionProjection | null {
  const sessionId = snapshot.sessionId;
  if (!sessionId) return null;
  if (snapshot.state !== 'running' && snapshot.state !== 'paused') return null;
  if (snapshot.segments.length === 0) return null;
  if (hasLocalSession(sessionId)) return null;

  const firstSegment = snapshot.segments[0];
  const startedAt = firstSegment.startedAt;

  const segments: FocusSegment[] = snapshot.segments.map((segment) => ({
    id: segment.id,
    sessionId,
    taskId: segment.taskId,
    taskSource: segment.taskSource,
    title: segment.title,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    activeElapsedMs: segment.activeElapsedMs,
    note: null,
    // 云端会话的片段没有滴答云端记录 ID 与番茄分类，删除联动依赖本地行，这里保持空。
    cloudFocusId: null,
    tomatodoSubject: null,
    createdAt: segment.startedAt,
    updatedAt: segment.endedAt ?? segment.startedAt,
  }));

  const pauses: PauseEvent[] = snapshot.pauseEvents.map((pause) => ({
    id: pause.id,
    sessionId,
    segmentId: pause.segmentId,
    pauseStartedAt: pause.pauseStartedAt,
    pauseEndedAt: pause.pauseEndedAt,
    durationMs: pause.durationMs,
    reason: null,
    createdAt: pause.pauseStartedAt,
    updatedAt: pause.pauseEndedAt ?? pause.pauseStartedAt,
  }));

  // 快照没有单独的会话默认任务来源字段，从片段里反查一次即可。
  const defaultTaskSource =
    segments.find((segment) => segment.taskId && segment.taskId === snapshot.sessionDefaultTaskId)
      ?.taskSource ?? null;

  const session: FocusSession = {
    id: sessionId,
    title: snapshot.sessionDefaultTaskTitle ?? null,
    status: 'active',
    startedAt,
    endedAt: null,
    activeElapsedMs: snapshot.activeElapsedMs,
    pauseElapsedMs: snapshot.pauseElapsedMs,
    wallElapsedMs: snapshot.wallElapsedMs,
    defaultTaskId: snapshot.sessionDefaultTaskId,
    defaultTaskSource,
    defaultTaskTitle: snapshot.sessionDefaultTaskTitle,
    note: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    segmentCount: segments.length,
    linkedSegmentCount: segments.filter((segment) => Boolean(segment.taskId)).length,
    ticktickLinkedSegmentCount: segments.filter(
      (segment) => Boolean(segment.taskId) && segment.taskSource === 'ticktick',
    ).length,
  };

  return { session, segments, pauses };
}
