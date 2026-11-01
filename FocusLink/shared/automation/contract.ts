/**
 * FocusLink 本地自动化合同（唯一字段真值）。
 *
 * 这一层是纯数据与纯校验：不导入 Electron、不读数据库、不拼 SQL、不发网络请求。
 * CLI（node 直跑）、HTTP 路由和后续 MCP 适配层都从这里取字段语义，不许各写一套。
 *
 * 三条硬约束：
 * 1. 读取结果走白名单，默认不含备注、标签、设备标识、凭据、数据库路径与诊断正文。
 * 2. 每条写命令都必须携带 operationId、目标 ID、预期版本与有效期。
 * 3. `accepted` 只表示操作已耐久登记，绝不表示计时或第三方同步已完成。
 */

export const AUTOMATION_PROTOCOL_VERSION = 1;

/** 沿用既有回环 listener 端口，不另开第二个业务端口。 */
export const AUTOMATION_LISTEN_PORT = 18770;

/** 自动化路由命名空间；既有 `/v1` 作为兼容入口保留。 */
export const AUTOMATION_API_PREFIX = '/automation/v1';

export const AUTOMATION_MAX_BODY_BYTES = 256 * 1024;

export const AUTOMATION_DEFAULT_LIMIT = 50;
export const AUTOMATION_MAX_LIMIT = 200;

/** 幂等回执保留期；过期后只保留拒重 tombstone，旧 ID 不得重新执行。 */
export const AUTOMATION_OPERATION_RESULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

/** 提交事件保留窗口；订阅方游标早于窗口时必须重新取一致快照。 */
export const AUTOMATION_CHANGE_RETENTION = 2_000;

/** 番茄计划的默认有效期。 */
export const AUTOMATION_PLAN_TTL_MS = 5 * 60 * 1_000;

export const AUTOMATION_TOMATODO_SESSION_MARKER_PREFIX = '[FocusLink:tomatodo:session:';

// ---------------------------------------------------------------------------
// 授权范围
// ---------------------------------------------------------------------------

export type AutomationScope = 'focus:read' | 'focus:control' | 'records:write' | 'tomatodo:write';

export const AUTOMATION_SCOPES: readonly AutomationScope[] = [
  'focus:read',
  'focus:control',
  'records:write',
  'tomatodo:write',
];

export function isAutomationScope(value: unknown): value is AutomationScope {
  return typeof value === 'string' && (AUTOMATION_SCOPES as readonly string[]).includes(value);
}

/** 只读 token 不得控制计时、补录或同步番茄。 */
export function scopeAllows(
  granted: readonly AutomationScope[],
  required: AutomationScope,
): boolean {
  return granted.includes(required);
}

export function normalizeScopes(value: unknown): AutomationScope[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isAutomationScope))];
}

// ---------------------------------------------------------------------------
// 命令与结果
// ---------------------------------------------------------------------------

export type AutomationCommandType =
  | 'focus.start'
  | 'focus.pause'
  | 'focus.resume'
  | 'focus.finish'
  | 'focus.abort'
  | 'records.create'
  | 'records.update'
  | 'tomatodo.sync';

export const AUTOMATION_COMMAND_TYPES: readonly AutomationCommandType[] = [
  'focus.start',
  'focus.pause',
  'focus.resume',
  'focus.finish',
  'focus.abort',
  'records.create',
  'records.update',
  'tomatodo.sync',
];

/** 命令类型到所需授权范围的唯一映射。 */
export const AUTOMATION_COMMAND_SCOPE: Record<AutomationCommandType, AutomationScope> = {
  'focus.start': 'focus:control',
  'focus.pause': 'focus:control',
  'focus.resume': 'focus:control',
  'focus.finish': 'focus:control',
  'focus.abort': 'focus:control',
  'records.create': 'records:write',
  'records.update': 'records:write',
  'tomatodo.sync': 'tomatodo:write',
};

export type AutomationResultStatus = 'applied' | 'duplicate' | 'accepted' | 'conflict' | 'rejected';

export const AUTOMATION_TERMINAL_STATUSES: readonly AutomationResultStatus[] = [
  'applied',
  'duplicate',
  'conflict',
  'rejected',
];

export interface AutomationTaskRef {
  taskId: string;
  taskSource: 'local' | 'ticktick';
  taskTitle: string;
}

export interface AutomationSegmentInput {
  startedAt: number;
  endedAt: number;
  task?: AutomationTaskRef | null;
  title?: string | null;
}

export interface AutomationPauseInput {
  startedAt: number;
  endedAt: number;
  reason?: string | null;
}

/**
 * 补录输入。`timeline` 必须覆盖 [startedAt, endedAt] 的每一毫秒：
 * 无暂停时用一个连续 focus 区间，有暂停时按时间顺序给出 focus / pause 交替段。
 */
export interface AutomationRecordCreateInput {
  sessionId?: string | null;
  title?: string | null;
  note?: string | null;
  startedAt: number;
  endedAt: number;
  defaultTask?: AutomationTaskRef | null;
  tomatodoSubject?: string | null;
  tomatodoRecordName?: string | null;
  timeline: AutomationTimelineItemInput[];
}

export type AutomationTimelineItemInput =
  ({ kind: 'focus' } & AutomationSegmentInput) | ({ kind: 'pause' } & AutomationPauseInput);

/** 字段级 patch：缺省表示不改，显式 null 表示清空。 */
export interface AutomationRecordPatch {
  title?: string | null;
  note?: string | null;
  defaultTask?: AutomationTaskRef | null;
  tomatodoSubject?: string | null;
  tomatodoRecordName?: string | null;
  /** 时间线修正必须携带原因与完整受影响时间线。 */
  timeline?: AutomationTimelineCorrection | null;
}

export interface AutomationTimelineCorrection {
  reason: string;
  startedAt: number;
  endedAt: number;
  timeline: AutomationTimelineItemInput[];
}

export type AutomationCommand =
  | {
      type: 'focus.start';
      expiresAt: number;
      expectedControlVersion: string;
      expectedState: 'idle';
      task?: AutomationTaskRef | null;
      title?: string | null;
    }
  | {
      type: 'focus.pause' | 'focus.resume';
      expiresAt: number;
      expectedControlVersion: string;
      expectedState: 'running' | 'paused';
    }
  | {
      type: 'focus.finish' | 'focus.abort';
      expiresAt: number;
      expectedControlVersion: string;
      expectedState: 'running' | 'paused';
    }
  | { type: 'records.create'; expiresAt: number; input: AutomationRecordCreateInput }
  | {
      type: 'records.update';
      expiresAt: number;
      sessionId: string;
      expectedRecordVersion: number;
      patch: AutomationRecordPatch;
    }
  | { type: 'tomatodo.sync'; expiresAt: number; planId: string; sessionId: string };

export interface AutomationCommandEnvelope {
  operationId: string;
  /** 审计标签，不是权限证明。 */
  sourceClient: string;
  command: AutomationCommand;
}

export interface AutomationErrorPayload {
  code: AutomationErrorCode;
  message: string;
  retryable: boolean;
  /** 只暴露安全版本信息，不含正文。 */
  current: {
    recordVersion: number | null;
    controlVersion: string | null;
    state: string | null;
    sessionId: string | null;
  } | null;
}

export interface AutomationCommandResult {
  protocolVersion: number;
  status: AutomationResultStatus;
  operationId: string;
  commandType: AutomationCommandType;
  targetId: string | null;
  recordVersion: number | null;
  controlVersion: string | null;
  changeSeq: number | null;
  /** applied / duplicate 时的规范化回读；accepted / conflict / rejected 为 null。 */
  data: unknown;
  error: AutomationErrorPayload | null;
}

// ---------------------------------------------------------------------------
// 稳定错误码
// ---------------------------------------------------------------------------

export type AutomationErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'AUTH_FAILED'
  | 'SCOPE_DENIED'
  | 'NOT_FOUND'
  | 'ROUTE_NOT_FOUND'
  | 'OPERATION_ID_REUSED'
  | 'OPERATION_EXPIRED'
  | 'OPERATION_UNKNOWN'
  | 'VERSION_CONFLICT'
  | 'STATE_CONFLICT'
  | 'OVERLAPPING_RECORD'
  | 'TIMELINE_INVALID'
  | 'TIMELINE_GAP'
  | 'TIMELINE_OVERLAP'
  | 'TIMELINE_OUT_OF_BOUNDS'
  | 'TIME_CONSERVATION_FAILED'
  | 'RECORD_NOT_FINISHED'
  | 'PLAN_STALE'
  | 'PLAN_NOT_FOUND'
  | 'TOMATODO_BRIDGE_UNAVAILABLE'
  | 'TOMATODO_UPDATE_UNSUPPORTED'
  | 'RESYNC_REQUIRED'
  | 'CURSOR_INVALID'
  | 'CONNECTION_CHANGED'
  | 'UNSUPPORTED_COMMAND'
  | 'INTERNAL_ERROR'
  | 'APP_NOT_RUNNING'
  | 'LOCAL_API_UNAVAILABLE';

export const AUTOMATION_ERROR_HTTP_STATUS: Record<AutomationErrorCode, number> = {
  INVALID_ARGUMENT: 400,
  INVALID_JSON: 400,
  PAYLOAD_TOO_LARGE: 413,
  AUTH_FAILED: 401,
  SCOPE_DENIED: 403,
  NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  OPERATION_ID_REUSED: 409,
  OPERATION_EXPIRED: 409,
  OPERATION_UNKNOWN: 404,
  VERSION_CONFLICT: 409,
  STATE_CONFLICT: 409,
  OVERLAPPING_RECORD: 409,
  TIMELINE_INVALID: 400,
  TIMELINE_GAP: 400,
  TIMELINE_OVERLAP: 400,
  TIMELINE_OUT_OF_BOUNDS: 400,
  TIME_CONSERVATION_FAILED: 400,
  RECORD_NOT_FINISHED: 409,
  PLAN_STALE: 409,
  PLAN_NOT_FOUND: 404,
  TOMATODO_BRIDGE_UNAVAILABLE: 503,
  TOMATODO_UPDATE_UNSUPPORTED: 422,
  RESYNC_REQUIRED: 409,
  CURSOR_INVALID: 400,
  CONNECTION_CHANGED: 409,
  UNSUPPORTED_COMMAND: 400,
  INTERNAL_ERROR: 500,
  APP_NOT_RUNNING: 503,
  LOCAL_API_UNAVAILABLE: 503,
};

/** CLI 退出码固定，不随文案变化。0 成功，其余按错误族分组。 */
export const AUTOMATION_ERROR_CLI_EXIT: Record<AutomationErrorCode, number> = {
  INVALID_ARGUMENT: 2,
  INVALID_JSON: 2,
  PAYLOAD_TOO_LARGE: 2,
  AUTH_FAILED: 3,
  SCOPE_DENIED: 3,
  NOT_FOUND: 5,
  ROUTE_NOT_FOUND: 5,
  OPERATION_ID_REUSED: 4,
  OPERATION_EXPIRED: 4,
  OPERATION_UNKNOWN: 5,
  VERSION_CONFLICT: 4,
  STATE_CONFLICT: 4,
  OVERLAPPING_RECORD: 4,
  TIMELINE_INVALID: 2,
  TIMELINE_GAP: 2,
  TIMELINE_OVERLAP: 2,
  TIMELINE_OUT_OF_BOUNDS: 2,
  TIME_CONSERVATION_FAILED: 2,
  RECORD_NOT_FINISHED: 4,
  PLAN_STALE: 4,
  PLAN_NOT_FOUND: 5,
  TOMATODO_BRIDGE_UNAVAILABLE: 6,
  TOMATODO_UPDATE_UNSUPPORTED: 4,
  RESYNC_REQUIRED: 7,
  CURSOR_INVALID: 2,
  CONNECTION_CHANGED: 4,
  UNSUPPORTED_COMMAND: 2,
  INTERNAL_ERROR: 6,
  APP_NOT_RUNNING: 6,
  LOCAL_API_UNAVAILABLE: 6,
};

const RETRYABLE_ERROR_CODES = new Set<AutomationErrorCode>([
  'TOMATODO_BRIDGE_UNAVAILABLE',
  'INTERNAL_ERROR',
  'APP_NOT_RUNNING',
  'LOCAL_API_UNAVAILABLE',
  'CONNECTION_CHANGED',
]);

export function isRetryableErrorCode(code: AutomationErrorCode): boolean {
  return RETRYABLE_ERROR_CODES.has(code);
}

export function httpStatusForError(code: AutomationErrorCode): number {
  return AUTOMATION_ERROR_HTTP_STATUS[code] ?? 500;
}

export function cliExitForError(code: string): number {
  return AUTOMATION_ERROR_CLI_EXIT[code as AutomationErrorCode] ?? 1;
}

/** 冲突族：调用方必须重新取快照，不得换 ID 重做。 */
export function isConflictErrorCode(code: AutomationErrorCode): boolean {
  return httpStatusForError(code) === 409;
}

// ---------------------------------------------------------------------------
// 读取视图（白名单）
// ---------------------------------------------------------------------------

export type AutomationTimerState = 'idle' | 'running' | 'paused' | 'finished';

export interface AutomationTaskView {
  taskId: string;
  taskSource: 'local' | 'ticktick';
  taskTitle: string;
}

export interface AutomationSegmentView {
  segmentId: string;
  startedAt: number;
  endedAt: number;
  activeElapsedMs: number;
  title: string | null;
  task: AutomationTaskView | null;
}

export interface AutomationPauseView {
  pauseId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

export interface AutomationSessionView {
  sessionId: string;
  title: string | null;
  status: 'active' | 'finished' | 'aborted';
  startedAt: number;
  endedAt: number | null;
  activeElapsedMs: number;
  pauseElapsedMs: number;
  wallElapsedMs: number;
  task: AutomationTaskView | null;
  tomatodoSubject: string | null;
  tomatodoRecordName: string | null;
  recordVersion: number;
  segments: AutomationSegmentView[];
  pauses: AutomationPauseView[];
  source: 'ledger' | 'live';
}

export interface AutomationStateView {
  protocolVersion: number;
  observedAt: number;
  /** live = 正在跟随本机计时器；ledger = 只有历史账本。 */
  freshness: 'live' | 'ledger';
  timer: {
    state: AutomationTimerState;
    sessionId: string | null;
    controlVersion: string;
    activeElapsedMs: number;
    pauseElapsedMs: number;
    wallElapsedMs: number;
    currentTask: AutomationTaskView | null;
  };
  activeSession: AutomationSessionView | null;
  changeSeq: number;
}

export interface AutomationRecordListPage {
  protocolVersion: number;
  timezone: string;
  date: string;
  observedAt: number;
  changeSeq: number;
  items: AutomationSessionView[];
  nextCursor: string | null;
  totalActiveElapsedMs: number;
  totalPauseElapsedMs: number;
}

export interface AutomationSummaryBucket {
  key: string;
  label: string;
  activeElapsedMs: number;
  pauseElapsedMs: number;
  sessionCount: number;
}

export interface AutomationSummaryView {
  protocolVersion: number;
  timezone: string;
  from: string;
  to: string;
  observedAt: number;
  changeSeq: number;
  activeElapsedMs: number;
  pauseElapsedMs: number;
  wallElapsedMs: number;
  sessionCount: number;
  byTask: AutomationSummaryBucket[];
  byDay: AutomationSummaryBucket[];
}

export interface AutomationTomatodoStage {
  localCommitted: boolean;
  focuslinkCloudState: 'unknown' | 'queued' | 'confirmed' | 'absent';
  tomatodoLocalWritten: boolean;
  uploadConfirmed: boolean;
  phoneDeliveryState: 'unknown' | 'pending' | 'confirmed';
  remoteReadbackSupported: false;
  remoteDeleteSupported: false;
}

export interface AutomationTomatodoPreview {
  protocolVersion: number;
  planId: string;
  sessionId: string;
  recordVersion: number;
  subject: string;
  recordName: string;
  minutes: number;
  startedAt: number;
  projectedEndAt: number;
  payloadDigest: string;
  expiresAt: number;
  withinCloudWindow: boolean;
  alreadyWritten: boolean;
  /** 批准后同步：本次调用方必须持有 tomatodo:write 且用户明确要求同步。 */
  requiresApproval: true;
}

export interface AutomationTomatodoSyncResult {
  protocolVersion: number;
  planId: string;
  sessionId: string;
  recordVersion: number;
  stages: AutomationTomatodoStage;
  /** 分阶段真实结果，不把上传成功当成手机可见。 */
  note: string;
}

export interface AutomationCapabilitiesView {
  protocolVersion: number;
  apiVersion: string;
  scopes: AutomationScope[];
  commands: Array<{ type: AutomationCommandType; scope: AutomationScope }>;
  reads: string[];
  writes: {
    operationId: true;
    expectedVersion: true;
    expectedState: true;
    expiresAt: true;
  };
  limits: {
    maxBodyBytes: number;
    defaultLimit: number;
    maxLimit: number;
    planTtlMs: number;
  };
  capabilities: {
    recordCreate: true;
    recordTimelineCorrection: true;
    timerControl: true;
    tomatodoPreview: true;
    tomatodoSync: true;
    remoteDelete: false;
    remoteReadback: false;
  };
}

export interface AutomationDoctorView {
  protocolVersion: number;
  product: 'FocusLink';
  version: string;
  ok: boolean;
  checks: Array<{
    id: string;
    status: 'ok' | 'warn' | 'fail';
    code: string | null;
  }>;
}

export interface AutomationSchemaView {
  protocolVersion: number;
  commands: Array<{
    type: AutomationCommandType;
    scope: AutomationScope;
    required: string[];
    optional: string[];
    resultStatuses: AutomationResultStatus[];
  }>;
  errors: Array<{
    code: AutomationErrorCode;
    httpStatus: number;
    exitCode: number;
    retryable: boolean;
  }>;
  reads: Array<{ path: string; scope: AutomationScope; query: string[] }>;
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export interface AutomationParseFailure {
  ok: false;
  code: AutomationErrorCode;
  message: string;
}

export type AutomationParseResult<T> = { ok: true; value: T } | AutomationParseFailure;

const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const SOURCE_CLIENT_PATTERN = /^[A-Za-z0-9._:/-]{1,64}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const PLAN_ID_PATTERN = /^tp-[A-Za-z0-9_-]{8,120}$/;
const CONTROL_VERSION_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

export function isValidOperationId(value: unknown): value is string {
  return typeof value === 'string' && OPERATION_ID_PATTERN.test(value);
}

export function isValidPlanId(value: unknown): value is string {
  return typeof value === 'string' && PLAN_ID_PATTERN.test(value);
}

function fail(code: AutomationErrorCode, message: string): AutomationParseFailure {
  return { ok: false, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  value: unknown,
  field: string,
  pattern?: RegExp,
): AutomationParseResult<string> {
  if (typeof value !== 'string' || value.trim() === '') {
    return fail('INVALID_ARGUMENT', `${field} is required`);
  }
  if (pattern && !pattern.test(value)) {
    return fail('INVALID_ARGUMENT', `${field} has an invalid format`);
  }
  return { ok: true, value };
}

function optionalString(value: unknown, field: string): AutomationParseResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return fail('INVALID_ARGUMENT', `${field} must be a string`);
  return { ok: true, value };
}

function requireTimestamp(value: unknown, field: string): AutomationParseResult<number> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail('INVALID_ARGUMENT', `${field} must be a non-negative integer epoch millisecond`);
  }
  return { ok: true, value };
}

function requireCount(value: unknown, field: string): AutomationParseResult<number> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail('INVALID_ARGUMENT', `${field} must be a non-negative integer`);
  }
  return { ok: true, value };
}

function parseTaskRef(
  value: unknown,
  field: string,
): AutomationParseResult<AutomationTaskRef | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!isRecord(value)) return fail('INVALID_ARGUMENT', `${field} must be an object`);
  const taskId = requireString(value['taskId'], `${field}.taskId`, SESSION_ID_PATTERN);
  if (!taskId.ok) return taskId;
  const taskSource = value['taskSource'];
  if (taskSource !== 'local' && taskSource !== 'ticktick') {
    return fail('INVALID_ARGUMENT', `${field}.taskSource must be local or ticktick`);
  }
  const taskTitle = requireString(value['taskTitle'], `${field}.taskTitle`);
  if (!taskTitle.ok) return taskTitle;
  return { ok: true, value: { taskId: taskId.value, taskSource, taskTitle: taskTitle.value } };
}

function parseTimelineItem(
  value: unknown,
  index: number,
): AutomationParseResult<AutomationTimelineItemInput> {
  const field = `input.timeline[${index}]`;
  if (!isRecord(value)) return fail('INVALID_ARGUMENT', `${field} must be an object`);
  const kind = value['kind'];
  if (kind !== 'focus' && kind !== 'pause') {
    return fail('INVALID_ARGUMENT', `${field}.kind must be focus or pause`);
  }
  const startedAt = requireTimestamp(value['startedAt'], `${field}.startedAt`);
  if (!startedAt.ok) return startedAt;
  const endedAt = requireTimestamp(value['endedAt'], `${field}.endedAt`);
  if (!endedAt.ok) return endedAt;
  if (kind === 'focus') {
    const task = parseTaskRef(value['task'], `${field}.task`);
    if (!task.ok) return task;
    const title = optionalString(value['title'], `${field}.title`);
    if (!title.ok) return title;
    return {
      ok: true,
      value: {
        kind: 'focus',
        startedAt: startedAt.value,
        endedAt: endedAt.value,
        task: task.value,
        title: title.value,
      },
    };
  }
  const reason = optionalString(value['reason'], `${field}.reason`);
  if (!reason.ok) return reason;
  return {
    ok: true,
    value: {
      kind: 'pause',
      startedAt: startedAt.value,
      endedAt: endedAt.value,
      reason: reason.value,
    },
  };
}

export function parseTimelineItems(
  value: unknown,
): AutomationParseResult<AutomationTimelineItemInput[]> {
  if (!Array.isArray(value)) return fail('INVALID_ARGUMENT', 'input.timeline must be an array');
  if (value.length === 0) return fail('TIMELINE_INVALID', 'input.timeline must not be empty');
  if (value.length > 64) return fail('INVALID_ARGUMENT', 'input.timeline is too long');
  const items: AutomationTimelineItemInput[] = [];
  for (const [index, raw] of value.entries()) {
    const parsed = parseTimelineItem(raw, index);
    if (!parsed.ok) return parsed;
    items.push(parsed.value);
  }
  return { ok: true, value: items };
}

function parseRecordCreateInput(
  value: unknown,
): AutomationParseResult<AutomationRecordCreateInput> {
  if (!isRecord(value)) return fail('INVALID_ARGUMENT', 'input must be an object');
  const startedAt = requireTimestamp(value['startedAt'], 'input.startedAt');
  if (!startedAt.ok) return startedAt;
  const endedAt = requireTimestamp(value['endedAt'], 'input.endedAt');
  if (!endedAt.ok) return endedAt;
  const sessionId = optionalString(value['sessionId'], 'input.sessionId');
  if (!sessionId.ok) return sessionId;
  if (sessionId.value !== null && !SESSION_ID_PATTERN.test(sessionId.value)) {
    return fail('INVALID_ARGUMENT', 'input.sessionId has an invalid format');
  }
  const title = optionalString(value['title'], 'input.title');
  if (!title.ok) return title;
  const note = optionalString(value['note'], 'input.note');
  if (!note.ok) return note;
  const defaultTask = parseTaskRef(value['defaultTask'], 'input.defaultTask');
  if (!defaultTask.ok) return defaultTask;
  const tomatodoSubject = optionalString(value['tomatodoSubject'], 'input.tomatodoSubject');
  if (!tomatodoSubject.ok) return tomatodoSubject;
  const tomatodoRecordName = optionalString(
    value['tomatodoRecordName'],
    'input.tomatodoRecordName',
  );
  if (!tomatodoRecordName.ok) return tomatodoRecordName;
  const timeline = parseTimelineItems(value['timeline']);
  if (!timeline.ok) return timeline;
  return {
    ok: true,
    value: {
      sessionId: sessionId.value,
      title: title.value,
      note: note.value,
      startedAt: startedAt.value,
      endedAt: endedAt.value,
      defaultTask: defaultTask.value,
      tomatodoSubject: tomatodoSubject.value,
      tomatodoRecordName: tomatodoRecordName.value,
      timeline: timeline.value,
    },
  };
}

function parseRecordPatch(value: unknown): AutomationParseResult<AutomationRecordPatch> {
  if (!isRecord(value)) return fail('INVALID_ARGUMENT', 'patch must be an object');
  const patch: AutomationRecordPatch = {};
  if ('title' in value) {
    const title = optionalString(value['title'], 'patch.title');
    if (!title.ok) return title;
    patch.title = title.value;
  }
  if ('note' in value) {
    const note = optionalString(value['note'], 'patch.note');
    if (!note.ok) return note;
    patch.note = note.value;
  }
  if ('defaultTask' in value) {
    const task = parseTaskRef(value['defaultTask'], 'patch.defaultTask');
    if (!task.ok) return task;
    patch.defaultTask = task.value;
  }
  if ('tomatodoSubject' in value) {
    const subject = optionalString(value['tomatodoSubject'], 'patch.tomatodoSubject');
    if (!subject.ok) return subject;
    patch.tomatodoSubject = subject.value;
  }
  if ('tomatodoRecordName' in value) {
    const name = optionalString(value['tomatodoRecordName'], 'patch.tomatodoRecordName');
    if (!name.ok) return name;
    patch.tomatodoRecordName = name.value;
  }
  if ('timeline' in value) {
    const raw = value['timeline'];
    if (raw === null) {
      patch.timeline = null;
    } else {
      if (!isRecord(raw)) return fail('INVALID_ARGUMENT', 'patch.timeline must be an object');
      const reason = requireString(raw['reason'], 'patch.timeline.reason');
      if (!reason.ok) return reason;
      const startedAt = requireTimestamp(raw['startedAt'], 'patch.timeline.startedAt');
      if (!startedAt.ok) return startedAt;
      const endedAt = requireTimestamp(raw['endedAt'], 'patch.timeline.endedAt');
      if (!endedAt.ok) return endedAt;
      const timeline = parseTimelineItems(raw['timeline']);
      if (!timeline.ok) return timeline;
      patch.timeline = {
        reason: reason.value,
        startedAt: startedAt.value,
        endedAt: endedAt.value,
        timeline: timeline.value,
      };
    }
  }
  if (Object.keys(patch).length === 0) {
    return fail('INVALID_ARGUMENT', 'patch must contain at least one field');
  }
  if (patch.timeline === null) {
    return fail('INVALID_ARGUMENT', 'patch.timeline cannot be cleared; send a full timeline');
  }
  return { ok: true, value: patch };
}

export function parseAutomationCommand(value: unknown): AutomationParseResult<AutomationCommand> {
  if (!isRecord(value)) return fail('INVALID_ARGUMENT', 'command must be an object');
  const type = value['type'];
  if (typeof type !== 'string' || !(AUTOMATION_COMMAND_TYPES as readonly string[]).includes(type)) {
    return fail('UNSUPPORTED_COMMAND', 'command.type is not supported');
  }
  const expiresAt = requireTimestamp(value['expiresAt'], 'expiresAt');
  if (!expiresAt.ok) return expiresAt;
  const commandType = type as AutomationCommandType;
  switch (commandType) {
    case 'focus.start': {
      const control = requireString(
        value['expectedControlVersion'],
        'expectedControlVersion',
        CONTROL_VERSION_PATTERN,
      );
      if (!control.ok) return control;
      if (value['expectedState'] !== 'idle') {
        return fail('INVALID_ARGUMENT', 'focus.start requires expectedState idle');
      }
      const task = parseTaskRef(value['task'], 'task');
      if (!task.ok) return task;
      const title = optionalString(value['title'], 'title');
      if (!title.ok) return title;
      return {
        ok: true,
        value: {
          type: 'focus.start',
          expiresAt: expiresAt.value,
          expectedControlVersion: control.value,
          expectedState: 'idle',
          task: task.value,
          title: title.value,
        },
      };
    }
    case 'focus.pause':
    case 'focus.resume':
    case 'focus.finish':
    case 'focus.abort': {
      const control = requireString(
        value['expectedControlVersion'],
        'expectedControlVersion',
        CONTROL_VERSION_PATTERN,
      );
      if (!control.ok) return control;
      const expectedState = value['expectedState'];
      const needsRunning = type === 'focus.pause';
      const needsPaused = type === 'focus.resume';
      const activeStates = expectedState === 'running' || expectedState === 'paused';
      if (needsRunning && expectedState !== 'running') {
        return fail('INVALID_ARGUMENT', 'focus.pause requires expectedState running');
      }
      if (needsPaused && expectedState !== 'paused') {
        return fail('INVALID_ARGUMENT', 'focus.resume requires expectedState paused');
      }
      if (!needsRunning && !needsPaused && !activeStates) {
        return fail('INVALID_ARGUMENT', `${type} requires expectedState running or paused`);
      }
      return {
        ok: true,
        value: {
          type: commandType as 'focus.pause' | 'focus.resume' | 'focus.finish' | 'focus.abort',
          expiresAt: expiresAt.value,
          expectedControlVersion: control.value,
          expectedState: expectedState as 'running' | 'paused',
        },
      };
    }
    case 'records.create': {
      const input = parseRecordCreateInput(value['input']);
      if (!input.ok) return input;
      return {
        ok: true,
        value: { type: 'records.create', expiresAt: expiresAt.value, input: input.value },
      };
    }
    case 'records.update': {
      const sessionId = requireString(value['sessionId'], 'sessionId', SESSION_ID_PATTERN);
      if (!sessionId.ok) return sessionId;
      const version = requireCount(value['expectedRecordVersion'], 'expectedRecordVersion');
      if (!version.ok) return version;
      const patch = parseRecordPatch(value['patch']);
      if (!patch.ok) return patch;
      return {
        ok: true,
        value: {
          type: 'records.update',
          expiresAt: expiresAt.value,
          sessionId: sessionId.value,
          expectedRecordVersion: version.value,
          patch: patch.value,
        },
      };
    }
    case 'tomatodo.sync': {
      const planId = requireString(value['planId'], 'planId', PLAN_ID_PATTERN);
      if (!planId.ok) return planId;
      const sessionId = requireString(value['sessionId'], 'sessionId', SESSION_ID_PATTERN);
      if (!sessionId.ok) return sessionId;
      return {
        ok: true,
        value: {
          type: 'tomatodo.sync',
          expiresAt: expiresAt.value,
          planId: planId.value,
          sessionId: sessionId.value,
        },
      };
    }
    default:
      return fail('UNSUPPORTED_COMMAND', 'command.type is not supported');
  }
}

export function parseAutomationEnvelope(
  value: unknown,
): AutomationParseResult<AutomationCommandEnvelope> {
  if (!isRecord(value)) return fail('INVALID_ARGUMENT', 'body must be an object');
  const operationId = requireString(value['operationId'], 'operationId', OPERATION_ID_PATTERN);
  if (!operationId.ok) return operationId;
  const sourceClientRaw = value['sourceClient'];
  const sourceClient: AutomationParseResult<string> =
    sourceClientRaw === undefined
      ? { ok: true, value: 'unknown-client' }
      : requireString(sourceClientRaw, 'sourceClient', SOURCE_CLIENT_PATTERN);
  if (!sourceClient.ok) return sourceClient;
  const command = parseAutomationCommand(value['command']);
  if (!command.ok) return command;
  return {
    ok: true,
    value: {
      operationId: operationId.value,
      sourceClient: sourceClient.value,
      command: command.value,
    },
  };
}

// ---------------------------------------------------------------------------
// schema（由本合同生成，CLI / HTTP / 后续 MCP 共用）
// ---------------------------------------------------------------------------

export const AUTOMATION_READ_ROUTES: ReadonlyArray<{
  path: string;
  scope: AutomationScope;
  query: string[];
}> = [
  { path: '/state', scope: 'focus:read', query: [] },
  { path: '/records', scope: 'focus:read', query: ['date', 'timezone', 'limit', 'cursor'] },
  { path: '/records/{id}', scope: 'focus:read', query: [] },
  {
    path: '/summary',
    scope: 'focus:read',
    query: ['from', 'to', 'timezone', 'date', 'groupBy'],
  },
  { path: '/capabilities', scope: 'focus:read', query: [] },
  { path: '/operations/{id}', scope: 'focus:read', query: [] },
  { path: '/events', scope: 'focus:read', query: ['cursor', 'limit'] },
  { path: '/tomatodo/preview', scope: 'tomatodo:write', query: ['session'] },
];

export function buildAutomationSchema(): AutomationSchemaView {
  return {
    protocolVersion: AUTOMATION_PROTOCOL_VERSION,
    commands: [
      {
        type: 'focus.start',
        scope: AUTOMATION_COMMAND_SCOPE['focus.start'],
        required: ['operationId', 'expiresAt', 'expectedControlVersion', 'expectedState'],
        optional: ['task', 'title'],
        resultStatuses: ['applied', 'duplicate', 'conflict', 'rejected'],
      },
      {
        type: 'focus.pause',
        scope: AUTOMATION_COMMAND_SCOPE['focus.pause'],
        required: ['operationId', 'expiresAt', 'expectedControlVersion', 'expectedState'],
        optional: [],
        resultStatuses: ['applied', 'duplicate', 'conflict', 'rejected'],
      },
      {
        type: 'focus.resume',
        scope: AUTOMATION_COMMAND_SCOPE['focus.resume'],
        required: ['operationId', 'expiresAt', 'expectedControlVersion', 'expectedState'],
        optional: [],
        resultStatuses: ['applied', 'duplicate', 'conflict', 'rejected'],
      },
      {
        type: 'focus.finish',
        scope: AUTOMATION_COMMAND_SCOPE['focus.finish'],
        required: ['operationId', 'expiresAt', 'expectedControlVersion', 'expectedState'],
        optional: [],
        resultStatuses: ['applied', 'duplicate', 'conflict', 'rejected'],
      },
      {
        type: 'focus.abort',
        scope: AUTOMATION_COMMAND_SCOPE['focus.abort'],
        required: ['operationId', 'expiresAt', 'expectedControlVersion', 'expectedState'],
        optional: [],
        resultStatuses: ['applied', 'duplicate', 'conflict', 'rejected'],
      },
      {
        type: 'records.create',
        scope: AUTOMATION_COMMAND_SCOPE['records.create'],
        required: [
          'operationId',
          'expiresAt',
          'input.startedAt',
          'input.endedAt',
          'input.timeline',
        ],
        optional: [
          'input.sessionId',
          'input.title',
          'input.note',
          'input.defaultTask',
          'input.tomatodoSubject',
          'input.tomatodoRecordName',
        ],
        resultStatuses: ['applied', 'duplicate', 'conflict', 'rejected'],
      },
      {
        type: 'records.update',
        scope: AUTOMATION_COMMAND_SCOPE['records.update'],
        required: ['operationId', 'expiresAt', 'sessionId', 'expectedRecordVersion', 'patch'],
        optional: ['patch.timeline'],
        resultStatuses: ['applied', 'duplicate', 'conflict', 'rejected'],
      },
      {
        type: 'tomatodo.sync',
        scope: AUTOMATION_COMMAND_SCOPE['tomatodo.sync'],
        required: ['operationId', 'expiresAt', 'planId', 'sessionId'],
        optional: [],
        resultStatuses: ['applied', 'duplicate', 'accepted', 'rejected'],
      },
    ],
    errors: (Object.keys(AUTOMATION_ERROR_HTTP_STATUS) as AutomationErrorCode[]).map((code) => ({
      code,
      httpStatus: AUTOMATION_ERROR_HTTP_STATUS[code],
      exitCode: AUTOMATION_ERROR_CLI_EXIT[code],
      retryable: isRetryableErrorCode(code),
    })),
    reads: AUTOMATION_READ_ROUTES.map((route) => ({ ...route })),
  };
}

export function buildCapabilitiesView(
  scopes: readonly AutomationScope[],
): AutomationCapabilitiesView {
  return {
    protocolVersion: AUTOMATION_PROTOCOL_VERSION,
    apiVersion: String(AUTOMATION_PROTOCOL_VERSION),
    scopes: [...scopes],
    commands: AUTOMATION_COMMAND_TYPES.map((type) => ({
      type,
      scope: AUTOMATION_COMMAND_SCOPE[type],
    })),
    reads: AUTOMATION_READ_ROUTES.map((route) => route.path),
    writes: {
      operationId: true,
      expectedVersion: true,
      expectedState: true,
      expiresAt: true,
    },
    limits: {
      maxBodyBytes: AUTOMATION_MAX_BODY_BYTES,
      defaultLimit: AUTOMATION_DEFAULT_LIMIT,
      maxLimit: AUTOMATION_MAX_LIMIT,
      planTtlMs: AUTOMATION_PLAN_TTL_MS,
    },
    capabilities: {
      recordCreate: true,
      recordTimelineCorrection: true,
      timerControl: true,
      tomatodoPreview: true,
      tomatodoSync: true,
      remoteDelete: false,
      remoteReadback: false,
    },
  };
}
