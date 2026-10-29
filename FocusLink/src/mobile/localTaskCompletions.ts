import type { TaskSnapshotResponse } from '@shared/sync/taskSnapshotProtocol';
import { applyTaskSnapshotMutation } from '@shared/sync/taskSnapshotProtocol';

/**
 * 完成/恢复的本机意图队列。
 *
 * 与 `localTaskEdits` 的区别：完成状态必须带稳定 operationId 走云端 CAS mutation，
 * 这样循环任务的下一次循环由权威端推进，本机只投影结果。撤销窗口内的点击先在
 * 本机丢弃意图，云端从未看见过这次完成，因此恢复对循环任务也是精确的。
 */
export const TASK_COMPLETION_UNDO_MS = 6_000;

export interface LocalTaskCompletion {
  taskId: string;
  scope: string;
  /** 目标状态：true = 完成，false = 恢复到未完成。 */
  completed: boolean;
  createdAt: number;
  /** 撤销窗口结束前不发送；窗口内撤销直接丢弃记录，不会惊动云端。 */
  notBefore: number;
  /** 只有 409 这类明确的版本冲突才允许换 base 并换 operationId。 */
  revisionAttempt: number;
  operationId: string;
  attemptCount: number;
  nextRetryAt: number;
  blocked: boolean;
  lastErrorCode: string | null;
}

export function completionOperationId(
  taskId: string,
  completed: boolean,
  revisionAttempt: number,
): string {
  return `local-task:${taskId}:${completed ? 'complete' : 'restore'}:${revisionAttempt}`;
}

export function newLocalTaskCompletion(
  taskId: string,
  scope: string,
  completed: boolean,
  now = Date.now(),
): LocalTaskCompletion {
  return {
    taskId,
    scope,
    completed,
    createdAt: now,
    notBefore: now + TASK_COMPLETION_UNDO_MS,
    revisionAttempt: 0,
    operationId: completionOperationId(taskId, completed, 0),
    attemptCount: 0,
    nextRetryAt: 0,
    blocked: false,
    lastErrorCode: null,
  };
}

/**
 * 同一任务只保留一个意图：后一次点击覆盖前一次，并重新开始撤销窗口。
 * createdAt 保持不变，队列顺序因此只由第一次点击决定。
 */
export function replaceLocalTaskCompletion(
  previous: LocalTaskCompletion,
  completed: boolean,
  now = Date.now(),
): LocalTaskCompletion {
  return {
    ...previous,
    completed,
    notBefore: now + TASK_COMPLETION_UNDO_MS,
    revisionAttempt: 0,
    operationId: completionOperationId(previous.taskId, completed, 0),
    attemptCount: 0,
    nextRetryAt: 0,
    blocked: false,
    lastErrorCode: null,
  };
}

/** 同一任务的记录按创建时间排序，任务之间互相独立、互不阻塞。 */
export function sortLocalTaskCompletions(
  records: readonly LocalTaskCompletion[],
): LocalTaskCompletion[] {
  return [...records].sort((a, b) => a.createdAt - b.createdAt);
}

export function retryLocalTaskCompletion(
  record: LocalTaskCompletion,
  status: number | null,
  now = Date.now(),
  retryAfterMs: number | null = null,
): LocalTaskCompletion {
  const attemptCount = (record.attemptCount ?? 0) + 1;
  // 只有原样重放后的版本冲突才换 base；换 operationId 后必须按新的 base 重新提交。
  if (status === 409) {
    const revisionAttempt = record.revisionAttempt + 1;
    return {
      ...record,
      revisionAttempt,
      attemptCount,
      operationId: completionOperationId(record.taskId, record.completed, revisionAttempt),
      nextRetryAt: now + 1_000,
      blocked: false,
      lastErrorCode: 'revision_mismatch',
    };
  }
  // 完成状态是屏幕上刚发生的动作：重试要比新建任务更积极，网络恢复后 1 分钟内必须收敛。
  const base = Math.min(60_000, 5_000 * 2 ** Math.min(attemptCount - 1, 4));
  const spread =
    [...record.taskId].reduce((sum, char) => sum + char.charCodeAt(0), attemptCount * 17) % 101;
  // 服务端给的 Retry-After 必须原样尊重，只有我们自己算的退避才封顶 60 秒。
  const delay = Math.max(
    Math.min(60_000, Math.round(base * (0.8 + spread / 250))),
    retryAfterMs ?? 0,
  );
  const blocked =
    status === 401 ||
    status === 403 ||
    (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429);
  return {
    ...record,
    attemptCount,
    blocked,
    nextRetryAt: blocked ? now : now + delay,
    lastErrorCode:
      status === 401
        ? 'authentication_failed'
        : status === 403
          ? 'authorization_failed'
          : status === 429
            ? 'rate_limited'
            : status !== null && status >= 500
              ? 'server_error'
              : status !== null && status >= 400
                ? 'rejected'
                : 'network_error',
  };
}

export function localTaskCompletionIssue(record: LocalTaskCompletion): string | null {
  if (!record.blocked) return null;
  if (record.lastErrorCode === 'authentication_failed')
    return '设备身份已失效，需要重新配对；本机完成状态仍保留';
  if (record.lastErrorCode === 'authorization_failed')
    return '当前设备没有任务写入权限；本机完成状态仍保留';
  return '云端未确认这次完成状态，请到同步详情重新检查；本机记录仍保留';
}

/**
 * 把还没发出去的完成意图投影到已确认快照上：任务勾选立刻生效，循环任务的下一次日期
 * 也按权威规则在本机算好，用户不必等网络。
 */
export function overlayLocalTaskCompletions(
  remote: TaskSnapshotResponse,
  records: readonly LocalTaskCompletion[],
): TaskSnapshotResponse {
  const relevant = records.filter((record) => !record.blocked);
  if (relevant.length === 0) return remote;
  let snapshot = remote.snapshot;
  for (const record of sortLocalTaskCompletions(relevant)) {
    if (!snapshot) break;
    try {
      snapshot = applyTaskSnapshotMutation(
        snapshot,
        { kind: 'set_task_completed', taskId: record.taskId, completed: record.completed },
        Math.max(remote.snapshot?.publishedAt ?? 0, record.createdAt),
      ).snapshot;
    } catch {
      // 任务已不存在或已变成只读导入任务：这条意图交给补发流程按失败处理。
      continue;
    }
  }
  return { ...remote, snapshot };
}

export function findLocalTaskCompletion(
  records: readonly LocalTaskCompletion[],
  taskId: string,
): LocalTaskCompletion | undefined {
  return records.find((record) => record.taskId === taskId);
}

export type TaskCompletionIntentPlan =
  | { kind: 'noop' }
  | { kind: 'drop'; record: LocalTaskCompletion }
  | { kind: 'replace'; record: LocalTaskCompletion }
  | { kind: 'create'; record: LocalTaskCompletion };

/**
 * 一次点击应该变成什么：重复点击同一意图 = 什么都不做；撤销窗口内撤销 = 丢弃意图
 * （云端从未收到这次完成）；窗口外改主意 = 换意图；没有记录 = 新建意图。
 */
export function planTaskCompletionIntent(input: {
  records: readonly LocalTaskCompletion[];
  taskId: string;
  scope: string;
  completed: boolean;
  now: number;
}): TaskCompletionIntentPlan {
  const existing = findLocalTaskCompletion(input.records, input.taskId);
  if (existing !== undefined && !existing.blocked) {
    if (existing.completed === input.completed) return { kind: 'noop' };
    if (input.completed === false && existing.notBefore > input.now) {
      return { kind: 'drop', record: existing };
    }
    return {
      kind: 'replace',
      record: replaceLocalTaskCompletion(existing, input.completed, input.now),
    };
  }
  return {
    kind: 'create',
    record: newLocalTaskCompletion(input.taskId, input.scope, input.completed, input.now),
  };
}
