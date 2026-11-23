import type { TaskSource } from '../types';

export const LIVE_FOCUS_PROTOCOL_VERSION = 1 as const;
export const LIVE_FOCUS_MAX_WAIT_MS = 25_000;
export const LIVE_FOCUS_MAX_TITLE_LENGTH = 1_000;
export const LIVE_FOCUS_MAX_TRANSITIONS = 5_000;
export const LIVE_FOCUS_MAX_COMMAND_BODY_BYTES = 16 * 1024;
export const LIVE_FOCUS_SNAPSHOT_PATH = '/sync/v2/live' as const;
export const LIVE_FOCUS_WAIT_PATH = '/sync/v2/live/wait' as const;
export const LIVE_FOCUS_COMMAND_PATH = '/sync/v2/live/command' as const;

const LIVE_FOCUS_REQUEST_KEYS = new Set(['protocolVersion', 'deviceId', 'command']);
const LIVE_FOCUS_START_COMMAND_KEYS = new Set([
  'commandId',
  'action',
  'expectedRevision',
  'sessionId',
  'title',
  'task',
]);
const LIVE_FOCUS_COMMAND_KEYS = new Set(['commandId', 'action', 'expectedRevision', 'sessionId']);
const LIVE_FOCUS_ADOPT_COMMAND_KEYS = new Set([
  'commandId',
  'action',
  'expectedRevision',
  'sessionId',
  'session',
]);
const LIVE_FOCUS_ADOPT_SEED_KEYS = new Set([
  'id',
  'title',
  'state',
  'startedAt',
  'clientNow',
  'segments',
  'pauses',
  'task',
]);
const LIVE_FOCUS_SEGMENT_KEYS = new Set(['id', 'startedAt', 'endedAt', 'task']);
const LIVE_FOCUS_PAUSE_KEYS = new Set(['id', 'segmentId', 'startedAt', 'endedAt']);
const LIVE_FOCUS_LINK_TASK_COMMAND_KEYS = new Set([
  'commandId',
  'action',
  'expectedRevision',
  'sessionId',
  'segmentId',
  'task',
]);

export type LiveFocusState = 'idle' | 'running' | 'paused';
export type LiveFocusAction =
  'start' | 'adopt' | 'pause' | 'resume' | 'finish' | 'abort' | 'link-task';

interface LiveFocusCommandBase {
  commandId: string;
  expectedRevision: number;
  sessionId: string;
}

export interface LiveFocusStartCommand extends LiveFocusCommandBase {
  action: 'start';
  title: string | null;
  /** Optional for protocol-v1 clients built before task context was introduced. */
  task?: LiveFocusTaskContext | null;
}

export interface LiveFocusTaskContext {
  taskId: string;
  taskSource: TaskSource;
  taskTitle: string | null;
}

export interface LiveFocusTimelineSegment {
  id: string;
  startedAt: number;
  endedAt: number | null;
  /**
   * Segment-level task override. Omitted means "inherit the session task"; an explicit null means
   * the segment was deliberately unlinked, so it must not fall back to the session task.
   */
  task?: LiveFocusTaskContext | null;
}

export interface LiveFocusTimelinePause {
  id: string;
  segmentId: string;
  startedAt: number;
  endedAt: number | null;
}

export interface LiveFocusTransitionCommand extends LiveFocusCommandBase {
  action: 'pause' | 'resume' | 'finish' | 'abort';
}

/**
 * One already-running local session offered to the live authority. The authority adopts it as-is so
 * the phone and the PC observe the same timeline instead of the PC staying a private local timer.
 */
export interface LiveFocusAdoptSeed {
  id: string;
  title: string | null;
  state: Exclude<LiveFocusState, 'idle'>;
  startedAt: number;
  /** Client clock when the seed was captured; the authority uses it to remove clock skew. */
  clientNow: number;
  segments: LiveFocusTimelineSegment[];
  pauses: LiveFocusTimelinePause[];
  task: LiveFocusTaskContext | null;
}

export interface LiveFocusAdoptCommand extends LiveFocusCommandBase {
  action: 'adopt';
  session: LiveFocusAdoptSeed;
}

/** Relinks one timeline segment of the running session; null clears the override. */
export interface LiveFocusLinkTaskCommand extends LiveFocusCommandBase {
  action: 'link-task';
  segmentId: string;
  task: LiveFocusTaskContext | null;
}

export type LiveFocusCommand =
  | LiveFocusStartCommand
  | LiveFocusAdoptCommand
  | LiveFocusTransitionCommand
  | LiveFocusLinkTaskCommand;

/**
 * Effective task of one live segment: an explicit segment override wins, including an explicit null
 * clear; only a missing override inherits the session default task.
 */
export function liveSegmentTask(
  segment: LiveFocusTimelineSegment,
  sessionTask: LiveFocusTaskContext | null,
): LiveFocusTaskContext | null {
  return segment.task === undefined ? sessionTask : segment.task;
}

/** Display title of one live segment, preserving the legacy session-title fallback when inheriting. */
export function liveSegmentTitle(
  segment: LiveFocusTimelineSegment,
  sessionTask: LiveFocusTaskContext | null,
  sessionTitle: string | null,
): string | null {
  if (segment.task !== undefined) return segment.task?.taskTitle ?? null;
  return sessionTask?.taskTitle ?? sessionTitle;
}

export interface LiveFocusCommandRequest {
  protocolVersion: typeof LIVE_FOCUS_PROTOCOL_VERSION;
  deviceId: string;
  command: LiveFocusCommand;
}

export type LiveFocusCommandAckStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected';

export interface LiveFocusCommandAck {
  commandId: string;
  status: LiveFocusCommandAckStatus;
  /** Applied revision, original revision for duplicates, or current revision on failure. */
  revision: number;
  errorCode: string | null;
  /** Set only when finish/abort has atomically published a completed ledger entity. */
  completedEntityId: string | null;
}

export interface LiveFocusSessionSnapshot {
  id: string;
  title: string | null;
  state: Exclude<LiveFocusState, 'idle'>;
  startedAt: number;
  activeElapsedMs: number;
  pauseElapsedMs: number;
  wallElapsedMs: number;
  currentPauseStartedAt: number | null;
  segments: LiveFocusTimelineSegment[];
  pauses: LiveFocusTimelinePause[];
  task: LiveFocusTaskContext | null;
  updatedAt: number;
  lastCommandDeviceId: string;
}

export interface LiveFocusSnapshot {
  /** Account-scoped revision. It increases once for every successfully applied command. */
  revision: number;
  state: LiveFocusState;
  session: LiveFocusSessionSnapshot | null;
}

export interface LiveFocusSnapshotResponse {
  protocolVersion: typeof LIVE_FOCUS_PROTOCOL_VERSION;
  snapshot: LiveFocusSnapshot;
  /** Elapsed values in snapshot are materialized at this server timestamp. */
  serverTime: number;
}

export interface LiveFocusWaitResponse extends LiveFocusSnapshotResponse {
  /** False means the bounded wait expired without a revision change. */
  changed: boolean;
}

export interface LiveFocusCommandResponse extends LiveFocusSnapshotResponse {
  ack: LiveFocusCommandAck;
}

export interface LiveFocusCommandValidationResult {
  ok: boolean;
  request?: LiveFocusCommandRequest;
  error?: string;
}

/** Strictly validates a live command body without accepting ownership or provider fields. */
export function validateLiveFocusCommandRequest(value: unknown): LiveFocusCommandValidationResult {
  if (!isRecord(value)) return invalid('request must be an object');
  if (!hasOnlyKeys(value, LIVE_FOCUS_REQUEST_KEYS)) {
    return invalid('request contains unsupported fields');
  }
  if (value.protocolVersion !== LIVE_FOCUS_PROTOCOL_VERSION) {
    return invalid('unsupported protocol version');
  }
  if (!isLiveFocusId(value.deviceId)) return invalid('deviceId is invalid');
  if (!isRecord(value.command)) return invalid('command must be an object');

  const command = value.command;
  const action = command.action;
  if (!isLiveFocusAction(action)) return invalid('command action is invalid');
  const allowedKeys =
    action === 'start'
      ? LIVE_FOCUS_START_COMMAND_KEYS
      : action === 'link-task'
        ? LIVE_FOCUS_LINK_TASK_COMMAND_KEYS
        : action === 'adopt'
          ? LIVE_FOCUS_ADOPT_COMMAND_KEYS
          : LIVE_FOCUS_COMMAND_KEYS;
  if (!hasOnlyKeys(command, allowedKeys)) {
    return invalid('command contains unsupported fields');
  }
  if (!isLiveFocusId(command.commandId)) return invalid('commandId is invalid');
  if (!isLiveFocusId(command.sessionId)) return invalid('sessionId is invalid');
  if (!isRevision(command.expectedRevision)) return invalid('expectedRevision is invalid');

  if (action === 'start') {
    if (!isNullableTitle(command.title)) return invalid('title is invalid');
    if (command.task !== undefined && !isNullableTask(command.task))
      return invalid('task is invalid');
    return {
      ok: true,
      request: {
        protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
        deviceId: value.deviceId,
        command: {
          commandId: command.commandId,
          action,
          expectedRevision: command.expectedRevision,
          sessionId: command.sessionId,
          title: command.title,
          task: command.task ?? null,
        },
      },
    };
  }

  if (action === 'adopt') {
    const seed = parseLiveFocusAdoptSeed(command.session);
    if (!seed || seed.id !== command.sessionId) return invalid('session is invalid');
    return {
      ok: true,
      request: {
        protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
        deviceId: value.deviceId,
        command: {
          commandId: command.commandId,
          action,
          expectedRevision: command.expectedRevision,
          sessionId: command.sessionId,
          session: seed,
        },
      },
    };
  }

  if (action === 'link-task') {
    if (!isLiveFocusId(command.segmentId)) return invalid('segmentId is invalid');
    if (!isNullableTask(command.task)) return invalid('task is invalid');
    return {
      ok: true,
      request: {
        protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
        deviceId: value.deviceId,
        command: {
          commandId: command.commandId,
          action,
          expectedRevision: command.expectedRevision,
          sessionId: command.sessionId,
          segmentId: command.segmentId,
          task: command.task,
        },
      },
    };
  }

  return {
    ok: true,
    request: {
      protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
      deviceId: value.deviceId,
      command: {
        commandId: command.commandId,
        action,
        expectedRevision: command.expectedRevision,
        sessionId: command.sessionId,
      },
    },
  };
}

export function isLiveFocusId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

export function isLiveFocusRevision(value: unknown): value is number {
  return isRevision(value);
}

function isLiveFocusAction(value: unknown): value is LiveFocusAction {
  return (
    value === 'start' ||
    value === 'adopt' ||
    value === 'pause' ||
    value === 'resume' ||
    value === 'finish' ||
    value === 'abort' ||
    value === 'link-task'
  );
}

function isNullableTitle(value: unknown): value is string | null {
  return (
    value === null || (typeof value === 'string' && value.length <= LIVE_FOCUS_MAX_TITLE_LENGTH)
  );
}

function isNullableTask(value: unknown): value is LiveFocusTaskContext | null {
  if (value === null) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, new Set(['taskId', 'taskSource', 'taskTitle']))) {
    return false;
  }
  return (
    isLiveFocusId(value.taskId) &&
    (value.taskSource === 'local' || value.taskSource === 'ticktick') &&
    isNullableTitle(value.taskTitle)
  );
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isTimestamp(value);
}

/**
 * Parses one PC timeline handed to the live authority. This is deliberately structural: the
 * server does not trust elapsed counters, it recomputes them from the segment/pause boundaries.
 * The only invariants enforced here are the ones that keep that recomputation well-defined.
 */
export function parseLiveFocusAdoptSeed(value: unknown): LiveFocusAdoptSeed | null {
  if (!isRecord(value) || !hasOnlyKeys(value, LIVE_FOCUS_ADOPT_SEED_KEYS)) return null;
  if (!isLiveFocusId(value.id)) return null;
  if (!isNullableTitle(value.title)) return null;
  if (value.state !== 'running' && value.state !== 'paused') return null;
  if (!isTimestamp(value.startedAt) || !isTimestamp(value.clientNow)) return null;
  if (value.clientNow < value.startedAt) return null;
  const rawSegments = value.segments;
  const rawPauses = value.pauses;
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) return null;
  if (rawSegments.length > LIVE_FOCUS_MAX_TRANSITIONS) return null;
  if (!Array.isArray(rawPauses) || rawPauses.length > LIVE_FOCUS_MAX_TRANSITIONS) return null;

  const segments: LiveFocusTimelineSegment[] = [];
  for (const raw of rawSegments) {
    const segment = parseAdoptSegment(raw);
    if (!segment) return null;
    const previous = segments.at(-1);
    if (previous) {
      if (previous.endedAt === null) return null;
      if (segment.startedAt < previous.endedAt) return null;
    } else if (segment.startedAt < value.startedAt) {
      return null;
    }
    segments.push(segment);
  }
  if (value.state === 'running' && segments.at(-1)?.endedAt !== null) return null;

  const pauses: LiveFocusTimelinePause[] = [];
  for (const raw of rawPauses) {
    const pause = parseAdoptPause(raw);
    if (!pause) return null;
    const segment = segments.find((entry) => entry.id === pause.segmentId);
    if (!segment) return null;
    if (pause.startedAt < segment.startedAt) return null;
    if (segment.endedAt !== null && pause.startedAt > segment.endedAt) return null;
    const previous = pauses.at(-1);
    if (previous) {
      if (previous.endedAt === null) return null;
      if (pause.startedAt < previous.endedAt) return null;
    }
    pauses.push(pause);
  }
  if (value.state === 'running' && pauses.some((pause) => pause.endedAt === null)) return null;
  const lastSegment = segments.at(-1);
  const lastPause = pauses.at(-1);
  if (value.state === 'paused') {
    if (lastSegment?.endedAt === null) return null;
    if (!lastPause || lastPause.endedAt !== null) return null;
    if (lastPause.segmentId !== lastSegment?.id) return null;
    if (lastPause.startedAt !== lastSegment.endedAt) return null;
  }
  if (value.task !== null && !isNullableTask(value.task)) return null;
  return {
    id: value.id,
    title: value.title,
    state: value.state,
    startedAt: value.startedAt,
    clientNow: value.clientNow,
    segments,
    pauses,
    task: value.task === null ? null : { ...value.task },
  };
}

function parseAdoptSegment(value: unknown): LiveFocusTimelineSegment | null {
  if (!isRecord(value) || !hasOnlyKeys(value, LIVE_FOCUS_SEGMENT_KEYS)) return null;
  if (!isLiveFocusId(value.id)) return null;
  if (!isTimestamp(value.startedAt) || !isNullableTimestamp(value.endedAt)) return null;
  if (value.endedAt !== null && value.endedAt < value.startedAt) return null;
  if (value.task !== undefined && !isNullableTask(value.task)) return null;
  const segment: LiveFocusTimelineSegment = {
    id: value.id,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
  };
  if (value.task !== undefined) segment.task = value.task === null ? null : { ...value.task };
  return segment;
}

function parseAdoptPause(value: unknown): LiveFocusTimelinePause | null {
  if (!isRecord(value) || !hasOnlyKeys(value, LIVE_FOCUS_PAUSE_KEYS)) return null;
  if (!isLiveFocusId(value.id) || !isLiveFocusId(value.segmentId)) return null;
  if (!isTimestamp(value.startedAt) || !isNullableTimestamp(value.endedAt)) return null;
  if (value.endedAt !== null && value.endedAt < value.startedAt) return null;
  return {
    id: value.id,
    segmentId: value.segmentId,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function invalid(error: string): LiveFocusCommandValidationResult {
  return { ok: false, error };
}
