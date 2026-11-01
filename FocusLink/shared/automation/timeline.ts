/**
 * 补录/修正时间线的纯计算与校验。
 *
 * 不变量：时间线必须覆盖 [startedAt, endedAt] 的每一毫秒。
 * - 无暂停 = 一个连续 focus 区间；
 * - 有暂停 = 按时间顺序 focus / pause 交替，首尾闭合、互不重叠、无空洞。
 * 覆盖完整时三时间守恒自动成立：wall = active + pause。
 * 缺口、重叠、越界一律显式拒绝，绝不由调用方或 AI 自行补时间。
 */

import type {
  AutomationErrorCode,
  AutomationSegmentInput,
  AutomationTimelineItemInput,
} from './contract';

export interface TimelineSegment {
  segmentId: string;
  startedAt: number;
  endedAt: number;
  activeElapsedMs: number;
  task: AutomationSegmentInput['task'];
  title: string | null;
}

export interface TimelinePause {
  pauseId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  reason: string | null;
}

export interface TimelineLedger {
  startedAt: number;
  endedAt: number;
  wallElapsedMs: number;
  activeElapsedMs: number;
  pauseElapsedMs: number;
  segments: TimelineSegment[];
  pauses: TimelinePause[];
}

export interface TimelineFailure {
  ok: false;
  code: AutomationErrorCode;
  message: string;
  /** 出问题的区间下标，供调用方定位；全局错误为 null。 */
  index: number | null;
}

export type TimelineResult = { ok: true; ledger: TimelineLedger } | TimelineFailure;

export interface TimelineBuildInput {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  items: readonly AutomationTimelineItemInput[];
}

const MAX_TIMELINE_MS = 7 * 24 * 60 * 60 * 1_000;

function failure(
  code: AutomationErrorCode,
  message: string,
  index: number | null = null,
): TimelineFailure {
  return { ok: false, code, message, index };
}

/**
 * 片段/暂停 id 由会话 id 与序号派生，重放同一 operationId 时逐字节稳定，
 * 不会因重试产生第二套记录。
 */
export function timelineSegmentId(sessionId: string, index: number): string {
  return `${sessionId}-s${index}`;
}

export function timelinePauseId(sessionId: string, index: number): string {
  return `${sessionId}-p${index}`;
}

export function buildTimelineLedger(input: TimelineBuildInput): TimelineResult {
  const { sessionId, startedAt, endedAt, items } = input;
  if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(endedAt)) {
    return failure('INVALID_ARGUMENT', 'startedAt and endedAt must be integer milliseconds');
  }
  if (endedAt <= startedAt) {
    return failure('TIMELINE_INVALID', 'endedAt must be later than startedAt');
  }
  if (endedAt - startedAt > MAX_TIMELINE_MS) {
    return failure('TIMELINE_INVALID', 'record span exceeds seven days');
  }
  if (items.length === 0) {
    return failure('TIMELINE_INVALID', 'timeline must not be empty');
  }

  const segments: TimelineSegment[] = [];
  const pauses: TimelinePause[] = [];
  let cursor = startedAt;
  let activeElapsedMs = 0;
  let pauseElapsedMs = 0;
  let segmentIndex = 0;
  let pauseIndex = 0;

  for (const [index, item] of items.entries()) {
    if (!Number.isSafeInteger(item.startedAt) || !Number.isSafeInteger(item.endedAt)) {
      return failure('INVALID_ARGUMENT', 'timeline item timestamps must be integers', index);
    }
    if (item.endedAt <= item.startedAt) {
      return failure('TIMELINE_INVALID', 'timeline item must have positive duration', index);
    }
    if (item.startedAt < startedAt || item.endedAt > endedAt) {
      return failure('TIMELINE_OUT_OF_BOUNDS', 'timeline item is outside the record span', index);
    }
    if (item.startedAt < cursor) {
      return failure('TIMELINE_OVERLAP', 'timeline items overlap or are out of order', index);
    }
    if (item.startedAt > cursor) {
      return failure('TIMELINE_GAP', 'timeline does not cover the record span', index);
    }
    cursor = item.endedAt;

    if (item.kind === 'focus') {
      const duration = item.endedAt - item.startedAt;
      activeElapsedMs += duration;
      segments.push({
        segmentId: timelineSegmentId(sessionId, segmentIndex),
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        activeElapsedMs: duration,
        task: item.task ?? null,
        title: item.title ?? null,
      });
      segmentIndex += 1;
    } else {
      const duration = item.endedAt - item.startedAt;
      pauseElapsedMs += duration;
      pauses.push({
        pauseId: timelinePauseId(sessionId, pauseIndex),
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        durationMs: duration,
        reason: item.reason ?? null,
      });
      pauseIndex += 1;
    }
  }

  if (cursor !== endedAt) {
    return failure('TIMELINE_GAP', 'timeline does not reach endedAt', items.length - 1);
  }
  if (segments.length === 0) {
    return failure('TIMELINE_INVALID', 'record must contain at least one focus interval');
  }
  if (activeElapsedMs <= 0) {
    return failure('TIMELINE_INVALID', 'record must contain positive focus time');
  }

  const wallElapsedMs = endedAt - startedAt;
  if (activeElapsedMs + pauseElapsedMs !== wallElapsedMs) {
    return failure(
      'TIME_CONSERVATION_FAILED',
      'active and pause time must add up to the full span',
    );
  }

  return {
    ok: true,
    ledger: {
      startedAt,
      endedAt,
      wallElapsedMs,
      activeElapsedMs,
      pauseElapsedMs,
      segments,
      pauses,
    },
  };
}

/** 无暂停的连续区间：`focus.timeline` 的最常见形态，单独提供避免调用方自己拼数组。 */
export function continuousTimeline(
  startedAt: number,
  endedAt: number,
  task: AutomationSegmentInput['task'],
  title: string | null,
): AutomationTimelineItemInput[] {
  return [{ kind: 'focus', startedAt, endedAt, task, title }];
}

export function timelineTotals(ledger: TimelineLedger): {
  activeElapsedMs: number;
  pauseElapsedMs: number;
  wallElapsedMs: number;
} {
  return {
    activeElapsedMs: ledger.activeElapsedMs,
    pauseElapsedMs: ledger.pauseElapsedMs,
    wallElapsedMs: ledger.wallElapsedMs,
  };
}

export interface Span {
  startedAt: number;
  endedAt: number;
}

/** 半开区间相交；用于补录前的重叠检查。 */
export function spansOverlap(left: Span, right: Span): boolean {
  return left.startedAt < right.endedAt && right.startedAt < left.endedAt;
}

// ---------------------------------------------------------------------------
// 版本
// ---------------------------------------------------------------------------

export interface ControlVersionParts {
  sessionId: string | null;
  /** 控制修订，只在业务变更时推进，每秒累计显示不推进。 */
  revision: number;
  /** 连接代际，旧账号结果不得进入新账号。 */
  generation: number;
}

export function formatControlVersion(parts: ControlVersionParts): string {
  return `${parts.sessionId ?? 'idle'}:${parts.revision}:${parts.generation}`;
}

export function readControlSessionId(controlVersion: string): string | null {
  const index = controlVersion.lastIndexOf(':');
  if (index <= 0) return null;
  const beforeRevision = controlVersion.slice(0, controlVersion.lastIndexOf(':', index - 1));
  return beforeRevision === 'idle' ? null : beforeRevision;
}

export function recordVersionOf(stored: number | null | undefined): number {
  return Number.isSafeInteger(stored) && (stored ?? -1) >= 0 ? (stored as number) : 0;
}

// ---------------------------------------------------------------------------
// 番茄计划指纹
// ---------------------------------------------------------------------------

export interface TomatodoPlanPayload {
  sessionId: string;
  recordVersion: number;
  subject: string;
  recordName: string;
  minutes: number;
  startedAt: number;
}

/**
 * 计划的规范正文。哈希在 Electron 侧计算（shared 不能依赖 node:crypto），
 * 但字符串本身必须是唯一口径，否则计划会误判为新鲜。
 */
export function canonicalTomatodoPlanPayload(payload: TomatodoPlanPayload): string {
  return [
    payload.sessionId,
    String(payload.recordVersion),
    payload.subject,
    payload.recordName,
    String(payload.minutes),
    String(payload.startedAt),
  ].join('\u001f');
}

export function tomatodoProjectedEndAt(startedAt: number, minutes: number): number {
  return startedAt + Math.max(1, minutes) * 60_000;
}
