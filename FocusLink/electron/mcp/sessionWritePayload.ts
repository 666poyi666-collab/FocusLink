// `/v1` 写接口的纯输入翻译层。
//
// 目的（2026-11-03 用户与外部助手的需求）：本地自动化端口此前只有只读的 `/v1` 与会话控制，
// 外部助手想改标题、归类、关联任务只能点界面。这里把 `/v1/sessions/:id` 的简单字段翻译成
// 自动化服务已有的 `records.update` / `records.create` 命令补丁 —— 不复制账本写入逻辑，
// 所有写操作仍然经过同一条命令管线（版本冲突、幂等回执、变更日志、界面刷新）。
import type {
  AutomationRecordCreateInput,
  AutomationRecordPatch,
  AutomationTaskRef,
} from '@shared/automation/contract';

/** 输入不合法时的稳定错误；HTTP 层直接映射成状态码与错误码。 */
export class SessionWriteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SessionWriteError';
  }
}

export interface CachedTask {
  id: string;
  title: string;
  source: string;
}

export interface SessionPatchContext {
  session: {
    id: string;
    startedAt: number;
    endedAt: number | null;
    pauseElapsedMs: number;
    defaultTaskId: string | null;
    defaultTaskSource: string | null;
    defaultTaskTitle: string | null;
  };
  findTask: (taskId: string) => CachedTask | null;
}

function has(payload: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

/**
 * 解析 `If-Match` 请求头里的 recordVersion。
 *
 * 支持 `3`、`"3"`、`W/"3"`；`*` 与非整数一律拒绝 —— 本接口不接受「任意当前版本」。
 * 返回 null 表示没有该请求头。
 */
export function parseIfMatchHeader(value: string | string[] | undefined): number | null {
  if (value === undefined) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new SessionWriteError(
      400,
      'INVALID_ARGUMENT',
      'If-Match must be a recordVersion integer',
    );
  }
  let text = raw.trim();
  if (/^W\//i.test(text)) text = text.slice(2).trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).trim();
  }
  if (!/^\d+$/.test(text)) {
    throw new SessionWriteError(
      400,
      'INVALID_ARGUMENT',
      'If-Match must be a recordVersion integer',
    );
  }
  return Number(text);
}

function nullableString(value: unknown, name: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new SessionWriteError(400, 'INVALID_ARGUMENT', `${name} must be a string or null`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function positiveMinutes(value: unknown, name = 'minutes'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1440) {
    throw new SessionWriteError(
      400,
      'INVALID_ARGUMENT',
      `${name} must be an integer between 1 and 1440`,
    );
  }
  return value;
}

function isTaskSource(value: unknown): value is 'local' | 'ticktick' {
  return value === 'local' || value === 'ticktick';
}

/** 解析 `taskId` / `defaultTaskId`（null = 取消关联），标题与来源优先用显式字段，其次查本机任务缓存。 */
function readTaskRef(
  payload: Record<string, unknown>,
  context: { findTask: (taskId: string) => CachedTask | null },
): AutomationTaskRef | null | undefined {
  const provided = has(payload, 'taskId') || has(payload, 'defaultTaskId');
  if (!provided) return undefined;
  const raw = has(payload, 'taskId') ? payload['taskId'] : payload['defaultTaskId'];
  if (raw === null) return null;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new SessionWriteError(
      400,
      'INVALID_ARGUMENT',
      'taskId must be a non-empty string or null',
    );
  }
  const taskId = raw.trim();
  const cached = context.findTask(taskId);
  const explicitTitle = has(payload, 'taskTitle')
    ? nullableString(payload['taskTitle'], 'taskTitle')
    : null;
  const title = explicitTitle ?? cached?.title ?? null;
  if (!title) {
    throw new SessionWriteError(
      404,
      'TASK_NOT_FOUND',
      'task is not in the local task cache; pass taskTitle (and taskSource) to link it explicitly',
    );
  }
  const explicitSource = has(payload, 'taskSource') ? payload['taskSource'] : null;
  const source = explicitSource ?? cached?.source ?? 'local';
  if (!isTaskSource(source)) {
    throw new SessionWriteError(400, 'INVALID_ARGUMENT', 'taskSource must be local or ticktick');
  }
  return { taskId, taskSource: source, taskTitle: title };
}

/**
 * 把 `/v1/sessions/:id` 的 PATCH 正文翻译成 `records.update` 的字段补丁。
 *
 * - 缺省字段不改；显式 `null` 清空（与合同一致）。
 * - `minutes` 是「整场有效时长」的便捷写法；只接受没有暂停的会话，有暂停时必须用精确时间线，
 *   避免把暂停时长悄悄算进有效时长（FL-SYNC-020 的口径）。
 */
export function buildSessionPatch(
  payload: Record<string, unknown>,
  context: SessionPatchContext,
): AutomationRecordPatch {
  const patch: AutomationRecordPatch = {};

  if (has(payload, 'title')) patch.title = nullableString(payload['title'], 'title');
  if (has(payload, 'note')) patch.note = nullableString(payload['note'], 'note');
  if (has(payload, 'tomatodoSubject')) {
    patch.tomatodoSubject = nullableString(payload['tomatodoSubject'], 'tomatodoSubject');
  }
  if (has(payload, 'tomatodoRecordName')) {
    patch.tomatodoRecordName = nullableString(payload['tomatodoRecordName'], 'tomatodoRecordName');
  }

  const taskRef = readTaskRef(payload, context);
  if (taskRef !== undefined) patch.defaultTask = taskRef;

  if (has(payload, 'timeline')) {
    throw new SessionWriteError(
      400,
      'INVALID_ARGUMENT',
      'timeline is not accepted here; use /automation/v1 records.update for exact timeline corrections',
    );
  }

  if (has(payload, 'minutes')) {
    const minutes = positiveMinutes(payload['minutes']);
    if (context.session.pauseElapsedMs > 0) {
      throw new SessionWriteError(
        422,
        'MINUTES_REQUIRES_TIMELINE',
        'session has pauses; send an explicit timeline correction instead of minutes',
      );
    }
    const startedAt = context.session.startedAt;
    const endedAt = startedAt + minutes * 60_000;
    const segmentTask =
      patch.defaultTask ??
      (context.session.defaultTaskId
        ? {
            taskId: context.session.defaultTaskId,
            taskSource: isTaskSource(context.session.defaultTaskSource)
              ? context.session.defaultTaskSource
              : 'local',
            taskTitle: context.session.defaultTaskTitle ?? '',
          }
        : null);
    patch.timeline = {
      reason: 'API 修正时长',
      startedAt,
      endedAt,
      timeline: [
        {
          kind: 'focus',
          startedAt,
          endedAt,
          title: segmentTask?.taskTitle ?? context.session.defaultTaskTitle ?? null,
          task: segmentTask,
        },
      ],
    };
  }

  if (Object.keys(patch).length === 0) {
    throw new SessionWriteError(
      400,
      'INVALID_ARGUMENT',
      'no updatable field was provided (title, note, tomatodoSubject, tomatodoRecordName, taskId, defaultTaskId, minutes)',
    );
  }
  return patch;
}

/** 把 `POST /v1/sessions` 的正文翻译成 `records.create` 的补录输入。 */
export function buildSessionCreateInput(
  payload: Record<string, unknown>,
  context: { findTask: (taskId: string) => CachedTask | null },
): AutomationRecordCreateInput {
  const startedAt = payload['startedAt'];
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
    throw new SessionWriteError(400, 'INVALID_ARGUMENT', 'startedAt must be epoch milliseconds');
  }
  const endedAtRaw = payload['endedAt'];
  if (typeof endedAtRaw !== 'number' || !Number.isFinite(endedAtRaw)) {
    throw new SessionWriteError(400, 'INVALID_ARGUMENT', 'endedAt must be epoch milliseconds');
  }
  if (endedAtRaw <= startedAt) {
    throw new SessionWriteError(400, 'INVALID_ARGUMENT', 'endedAt must be later than startedAt');
  }
  const requestedMinutes = has(payload, 'minutes')
    ? positiveMinutes(payload['minutes'])
    : Math.max(1, Math.round((endedAtRaw - startedAt) / 60_000));
  const focusEnd = startedAt + requestedMinutes * 60_000;
  const task = readTaskRef(payload, context) ?? null;
  const sessionId = has(payload, 'sessionId')
    ? nullableString(payload['sessionId'], 'sessionId')
    : null;

  return {
    sessionId,
    title: has(payload, 'title') ? nullableString(payload['title'], 'title') : null,
    note: has(payload, 'note') ? nullableString(payload['note'], 'note') : null,
    startedAt,
    endedAt: focusEnd,
    defaultTask: task,
    tomatodoSubject: has(payload, 'tomatodoSubject')
      ? nullableString(payload['tomatodoSubject'], 'tomatodoSubject')
      : null,
    tomatodoRecordName: has(payload, 'tomatodoRecordName')
      ? nullableString(payload['tomatodoRecordName'], 'tomatodoRecordName')
      : null,
    timeline: [
      {
        kind: 'focus',
        startedAt,
        endedAt: focusEnd,
        title: task?.taskTitle ?? null,
        task,
      },
    ],
  };
}
