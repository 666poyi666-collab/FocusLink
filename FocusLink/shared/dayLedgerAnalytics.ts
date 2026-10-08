import type { FocusSegment, FocusSession, PauseEvent } from './types';

export const DEFAULT_EFFECTIVE_DAY_START_HOUR = 7;
export const DEFAULT_EFFECTIVE_DAY_END_HOUR = 22;

export type DayLedgerKind = 'focus' | 'pause' | 'gap';
export type DayLedgerStatus = 'not-started' | 'observed' | 'estimated-only';

export interface DayLedgerInterval {
  kind: DayLedgerKind;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  sessionIds: string[];
  sourceIds: string[];
  /** Exact timeline intervals are never synthesized from duration-only legacy rows. */
  estimated: false;
}

export interface DayLedgerTask {
  key: string;
  taskId: string | null;
  title: string;
  activeMs: number;
  segmentCount: number;
  estimated: false;
}

export interface DayLedgerSessionFocus {
  sessionId: string;
  focusMs: number;
  /** Duration-only legacy sessions keep their effective-day share, but never gain fake bounds. */
  estimated: boolean;
}

export interface DayLedgerAnalytics {
  date: string;
  isToday: boolean;
  status: DayLedgerStatus;
  dayStartedAt: number;
  dayEndedAt: number;
  effectiveStartedAt: number;
  effectiveEndedAt: number;
  observationStartedAt: number | null;
  observationEndedAt: number;
  intervals: DayLedgerInterval[];
  gaps: DayLedgerInterval[];
  tasks: DayLedgerTask[];
  /** Per-session effective-day focus for range KPIs; concurrent sessions may overlap. */
  sessionFocus: DayLedgerSessionFocus[];
  totals: {
    focusMs: number;
    pauseMs: number;
    gapMs: number;
    observationMs: number;
    estimatedFocusMs: number;
    estimatedPauseMs: number;
  };
  /** True when duration-only legacy data exists but cannot be placed on the exact timeline. */
  estimated: boolean;
}

export interface DayLedgerSource {
  sessions: readonly FocusSession[];
  segments: readonly FocusSegment[];
  pauses: readonly PauseEvent[];
}

export interface BuildDayLedgerOptions {
  day: number;
  now?: number;
  effectiveStartHour?: number;
  effectiveEndHour?: number;
  /**
   * New calendar-day semantics: end the observation window at the last real record's end
   * instead of the whole effective-day boundary, so night-time / no-record hours are not
   * counted as gap. Desktop/mobile product statistics enable this via buildCalendarDayLedger.
   * The parameterized effective-day kernel keeps the default false for backward compatibility.
   */
  capObservationAtLastRecord?: boolean;
}

interface ExactSourceInterval {
  kind: 'focus' | 'pause';
  startedAt: number;
  endedAt: number;
  sessionId: string;
  sourceId: string;
}

function startOfLocalDay(timestamp: number): number {
  const value = new Date(timestamp);
  value.setHours(0, 0, 0, 0);
  return value.getTime();
}

function nextLocalDay(timestamp: number): number {
  const value = new Date(startOfLocalDay(timestamp));
  value.setDate(value.getDate() + 1);
  return value.getTime();
}

function localHour(timestamp: number, hour: number): number {
  const value = new Date(startOfLocalDay(timestamp));
  value.setHours(hour, 0, 0, 0);
  return value.getTime();
}

function localDateKey(timestamp: number): string {
  const value = new Date(timestamp);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function isSameLocalDay(left: number, right: number): boolean {
  return startOfLocalDay(left) === startOfLocalDay(right);
}

function clampInterval(
  startedAt: number,
  endedAt: number,
  lower: number,
  upper: number,
): { startedAt: number; endedAt: number } | null {
  const start = Math.max(startedAt, lower);
  const end = Math.min(endedAt, upper);
  return end > start ? { startedAt: start, endedAt: end } : null;
}

function exactEndForSegment(
  segment: FocusSegment,
  session: FocusSession | undefined,
  isToday: boolean,
  liveEnd: number,
): number | null {
  if (segment.endedAt !== null && segment.endedAt > segment.startedAt) return segment.endedAt;
  if (isToday && session?.status === 'active' && liveEnd > segment.startedAt) {
    return liveEnd;
  }
  return null;
}

function exactEndForPause(
  pause: PauseEvent,
  session: FocusSession | undefined,
  isToday: boolean,
  liveEnd: number,
): number | null {
  if (pause.pauseEndedAt !== null && pause.pauseEndedAt > pause.pauseStartedAt) {
    return pause.pauseEndedAt;
  }
  if (isToday && session?.status === 'active' && liveEnd > pause.pauseStartedAt) return liveEnd;
  return null;
}

function effectiveSessionEnd(session: FocusSession): number {
  if (session.endedAt !== null && session.endedAt > session.startedAt) return session.endedAt;
  return session.startedAt + Math.max(0, session.wallElapsedMs);
}

function estimatedShare(
  session: FocusSession,
  valueMs: number,
  rangeStart: number,
  rangeEnd: number,
): number {
  if (valueMs <= 0) return 0;
  const end = effectiveSessionEnd(session);
  if (end <= session.startedAt) {
    return session.startedAt >= rangeStart && session.startedAt < rangeEnd ? valueMs : 0;
  }
  const overlap = Math.max(0, Math.min(end, rangeEnd) - Math.max(session.startedAt, rangeStart));
  return valueMs * (overlap / (end - session.startedAt));
}

function collectExactIntervals(
  source: DayLedgerSource,
  isToday: boolean,
  windowStart: number,
  windowEnd: number,
): ExactSourceInterval[] {
  const sessions = new Map(source.sessions.map((session) => [session.id, session] as const));
  const focus = source.segments.flatMap((segment): ExactSourceInterval[] => {
    const endedAt = exactEndForSegment(
      segment,
      sessions.get(segment.sessionId),
      isToday,
      windowEnd,
    );
    if (endedAt === null) return [];
    const clipped = clampInterval(segment.startedAt, endedAt, windowStart, windowEnd);
    return clipped
      ? [
          {
            kind: 'focus',
            ...clipped,
            sessionId: segment.sessionId,
            sourceId: segment.id,
          },
        ]
      : [];
  });
  const pauses = source.pauses.flatMap((pause): ExactSourceInterval[] => {
    const endedAt = exactEndForPause(pause, sessions.get(pause.sessionId), isToday, windowEnd);
    if (endedAt === null) return [];
    const clipped = clampInterval(pause.pauseStartedAt, endedAt, windowStart, windowEnd);
    return clipped
      ? [
          {
            kind: 'pause',
            ...clipped,
            sessionId: pause.sessionId,
            sourceId: pause.id,
          },
        ]
      : [];
  });
  return [...focus, ...pauses];
}

function mergeIntervals(intervals: DayLedgerInterval[]): DayLedgerInterval[] {
  const merged: DayLedgerInterval[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    const sameSources =
      previous &&
      previous.sourceIds.length === interval.sourceIds.length &&
      previous.sourceIds.every((sourceId, index) => sourceId === interval.sourceIds[index]);
    if (
      previous &&
      previous.kind === interval.kind &&
      previous.endedAt === interval.startedAt &&
      (interval.kind === 'gap' || sameSources)
    ) {
      previous.endedAt = interval.endedAt;
      previous.durationMs += interval.durationMs;
      previous.sessionIds = Array.from(new Set([...previous.sessionIds, ...interval.sessionIds]));
      previous.sourceIds = Array.from(new Set([...previous.sourceIds, ...interval.sourceIds]));
      continue;
    }
    merged.push({ ...interval });
  }
  return merged;
}

function buildTaskAllocation(
  intervals: readonly DayLedgerInterval[],
  segments: readonly FocusSegment[],
): DayLedgerTask[] {
  const segmentsById = new Map(segments.map((segment) => [segment.id, segment] as const));
  const taskMap = new Map<
    string,
    DayLedgerTask & {
      segmentIds: Set<string>;
    }
  >();
  for (const interval of intervals) {
    if (interval.kind !== 'focus') continue;
    const sources = interval.sourceIds
      .map((sourceId) => segmentsById.get(sourceId))
      .filter((segment): segment is FocusSegment => Boolean(segment));
    if (sources.length === 0) continue;
    const sourceShare = interval.durationMs / sources.length;
    for (const segment of sources) {
      const title = segment.title?.trim() || '未关联任务';
      const key = segment.taskId
        ? `${segment.taskSource ?? 'unknown'}:${segment.taskId}`
        : `unlinked:${title}`;
      const item =
        taskMap.get(key) ??
        ({
          key,
          taskId: segment.taskId,
          title,
          activeMs: 0,
          segmentCount: 0,
          estimated: false,
          segmentIds: new Set<string>(),
        } satisfies DayLedgerTask & { segmentIds: Set<string> });
      item.activeMs += sourceShare;
      item.segmentIds.add(segment.id);
      item.segmentCount = item.segmentIds.size;
      taskMap.set(key, item);
    }
  }
  return Array.from(taskMap.values())
    .map(({ segmentIds: _segmentIds, ...item }) => item)
    .sort((left, right) => right.activeMs - left.activeMs || left.title.localeCompare(right.title));
}

function partitionObservation(
  observationStart: number,
  observationEnd: number,
  sources: ExactSourceInterval[],
): DayLedgerInterval[] {
  const clipped = sources.flatMap((source): ExactSourceInterval[] => {
    const interval = clampInterval(
      source.startedAt,
      source.endedAt,
      observationStart,
      observationEnd,
    );
    return interval ? [{ ...source, ...interval }] : [];
  });
  const boundaries = Array.from(
    new Set([
      observationStart,
      observationEnd,
      ...clipped.flatMap((interval) => [interval.startedAt, interval.endedAt]),
    ]),
  ).sort((left, right) => left - right);
  const intervals: DayLedgerInterval[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startedAt = boundaries[index];
    const endedAt = boundaries[index + 1];
    if (endedAt <= startedAt) continue;
    const active = clipped.filter(
      (interval) => interval.startedAt < endedAt && interval.endedAt > startedAt,
    );
    const pause = active.filter((interval) => interval.kind === 'pause');
    const focus = active.filter((interval) => interval.kind === 'focus');
    const selected = pause.length > 0 ? pause : focus;
    intervals.push({
      kind: pause.length > 0 ? 'pause' : focus.length > 0 ? 'focus' : 'gap',
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      sessionIds: Array.from(new Set(selected.map((interval) => interval.sessionId))),
      sourceIds: Array.from(new Set(selected.map((interval) => interval.sourceId))),
      estimated: false,
    });
  }
  return mergeIntervals(intervals);
}

/**
 * 把逐日账本里的任务合并成同一份排行（桌面侧栏/卡贴与移动端看板共用同一合并规则）。
 * 桌面与移动此前各有一份私有副本，改动容易只改一边 —— 统一放在这里。
 */
export function mergeLedgerTasks(dayLedgers: readonly DayLedgerAnalytics[]): DayLedgerTask[] {
  const taskMap = new Map<string, DayLedgerTask>();
  for (const ledger of dayLedgers) {
    for (const task of ledger.tasks) {
      const current = taskMap.get(task.key);
      taskMap.set(
        task.key,
        current
          ? {
              ...current,
              activeMs: current.activeMs + task.activeMs,
              segmentCount: current.segmentCount + task.segmentCount,
            }
          : { ...task },
      );
    }
  }
  return Array.from(taskMap.values()).sort(
    (left, right) => right.activeMs - left.activeMs || left.title.localeCompare(right.title),
  );
}

/** Product statistics cover the entire local calendar day, including night-time work. */
export function buildCalendarDayLedger(
  options: Pick<BuildDayLedgerOptions, 'day' | 'now'>,
  source: DayLedgerSource,
): DayLedgerAnalytics {
  return buildDayLedger(
    { ...options, effectiveStartHour: 0, effectiveEndHour: 24, capObservationAtLastRecord: true },
    source,
  );
}

export function buildDayLedger(
  options: BuildDayLedgerOptions,
  source: DayLedgerSource,
): DayLedgerAnalytics {
  const now = options.now ?? Date.now();
  const dayStartedAt = startOfLocalDay(options.day);
  const dayEndedAt = nextLocalDay(dayStartedAt);
  const effectiveStartedAt = localHour(
    dayStartedAt,
    options.effectiveStartHour ?? DEFAULT_EFFECTIVE_DAY_START_HOUR,
  );
  const effectiveDayEnd = localHour(
    dayStartedAt,
    options.effectiveEndHour ?? DEFAULT_EFFECTIVE_DAY_END_HOUR,
  );
  const isToday = isSameLocalDay(dayStartedAt, now);
  const effectiveEndedAt = isToday ? Math.min(now, effectiveDayEnd) : effectiveDayEnd;
  const calculationWindowEnd = Math.max(effectiveStartedAt, effectiveEndedAt);
  const exact = collectExactIntervals(source, isToday, effectiveStartedAt, calculationWindowEnd);
  const lastRecordEndedAt =
    exact.length > 0 ? Math.max(...exact.map((interval) => interval.endedAt)) : null;
  // 观察窗口的起点取「当日第一条真实记录」（专注或暂停），而不是第一条专注：
  // 跨午夜的暂停被切到 00:00 之后，它本身就是今天的记录；若从第一条专注起算，
  // 这段暂停会被整段丢掉，日账本的暂停时长就比 totals 少（用户口径：以凌晨 0 点为界，哪一天有就算哪一天）。
  const observationStartedAt =
    exact.length > 0
      ? Math.max(effectiveStartedAt, Math.min(...exact.map((interval) => interval.startedAt)))
      : null;
  // 新口径（仅自然日账本启用）：观察窗口终点收束到「当日最后一条真实记录的结束点」。
  // 今天封顶 now、历史日封顶次日零点；夜间/无记录区不再被算作空档。
  // focus + pause + gap = observation 不变量在收束后仍成立（区间只是变短）。
  const observationEndedAt =
    observationStartedAt !== null &&
    options.capObservationAtLastRecord &&
    lastRecordEndedAt !== null
      ? Math.min(lastRecordEndedAt, effectiveEndedAt)
      : effectiveEndedAt;
  const intervals =
    observationStartedAt !== null && observationEndedAt > observationStartedAt
      ? partitionObservation(observationStartedAt, observationEndedAt, exact)
      : [];
  // 「该会话有没有精确记录」要按会话在库里的全部记录判断，而不是只按落在本日窗口内的记录判断：
  // 跨午夜会话的片段可能全在昨天（今天只看到它的暂停），那是真实记录而非无明细的 legacy 行，
  // 若据此把会话总量按墙钟比例摊一份「估算专注」进今天，昨天的专注就会漏进今天的账本。
  const sourceSessions = new Map(source.sessions.map((session) => [session.id, session] as const));
  const sessionIdsWithRecordedFocus = new Set(
    source.segments
      .filter(
        (segment) =>
          exactEndForSegment(
            segment,
            sourceSessions.get(segment.sessionId),
            isToday,
            calculationWindowEnd,
          ) !== null,
      )
      .map((segment) => segment.sessionId),
  );
  const sessionIdsWithRecordedPause = new Set(
    source.pauses
      .filter(
        (pause) =>
          exactEndForPause(
            pause,
            sourceSessions.get(pause.sessionId),
            isToday,
            calculationWindowEnd,
          ) !== null,
      )
      .map((pause) => pause.sessionId),
  );
  const exactSessionFocus = new Map<string, number>();
  for (const interval of intervals) {
    if (interval.kind !== 'focus') continue;
    for (const sessionId of interval.sessionIds) {
      exactSessionFocus.set(
        sessionId,
        (exactSessionFocus.get(sessionId) ?? 0) + interval.durationMs,
      );
    }
  }
  const estimatedSessionFocus = source.sessions.flatMap((session): DayLedgerSessionFocus[] => {
    if (sessionIdsWithRecordedFocus.has(session.id)) return [];
    const focusMs = estimatedShare(
      session,
      session.activeElapsedMs,
      effectiveStartedAt,
      calculationWindowEnd,
    );
    return focusMs > 0 ? [{ sessionId: session.id, focusMs, estimated: true }] : [];
  });
  const estimatedFocusMs = estimatedSessionFocus.reduce(
    (total, session) => total + session.focusMs,
    0,
  );
  const estimatedPauseMs = source.sessions.reduce(
    (total, session) =>
      total +
      (sessionIdsWithRecordedPause.has(session.id)
        ? 0
        : estimatedShare(
            session,
            session.pauseElapsedMs,
            effectiveStartedAt,
            calculationWindowEnd,
          )),
    0,
  );
  const totals = intervals.reduce(
    (result, interval) => {
      if (interval.kind === 'focus') result.focusMs += interval.durationMs;
      if (interval.kind === 'pause') result.pauseMs += interval.durationMs;
      if (interval.kind === 'gap') result.gapMs += interval.durationMs;
      result.observationMs += interval.durationMs;
      return result;
    },
    {
      focusMs: 0,
      pauseMs: 0,
      gapMs: 0,
      observationMs: 0,
      estimatedFocusMs,
      estimatedPauseMs,
    },
  );
  const estimated = estimatedFocusMs > 0 || estimatedPauseMs > 0;
  const status: DayLedgerStatus =
    observationStartedAt !== null ? 'observed' : estimated ? 'estimated-only' : 'not-started';
  const tasks = buildTaskAllocation(intervals, source.segments);
  const sessionFocus = [
    ...Array.from(exactSessionFocus, ([sessionId, focusMs]) => ({
      sessionId,
      focusMs,
      estimated: false as const,
    })),
    ...estimatedSessionFocus,
  ].sort(
    (left, right) => right.focusMs - left.focusMs || left.sessionId.localeCompare(right.sessionId),
  );
  return {
    date: localDateKey(dayStartedAt),
    isToday,
    status,
    dayStartedAt,
    dayEndedAt,
    effectiveStartedAt,
    effectiveEndedAt,
    observationStartedAt,
    observationEndedAt,
    intervals,
    gaps: intervals.filter((interval) => interval.kind === 'gap'),
    tasks,
    sessionFocus,
    totals,
    estimated,
  };
}
