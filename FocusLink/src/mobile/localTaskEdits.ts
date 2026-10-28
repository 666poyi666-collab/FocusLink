import type { TaskSnapshotPayload, TaskSnapshotResponse } from '@shared/sync/taskSnapshotProtocol';
import { deleteTaskSnapshotTask, updateTaskSnapshotTask } from './taskSnapshotMutations';

/** Fields the mobile task page can change; merged per task while offline. */
export interface LocalTaskEditPatch {
  title?: string;
  priority?: number | null;
  startDate?: number | null;
  dueDate?: number | null;
  tags?: string[];
  parentId?: string | null;
}

/**
 * A durable, per-task pending edit. Several edits to the same task collapse into one record
 * so replay keeps the user's final intent instead of an intermediate state.
 */
export interface LocalTaskEdit {
  taskId: string;
  scope: string;
  patch: LocalTaskEditPatch;
  deleted: boolean;
  createdAt: number;
  attemptCount: number;
  nextRetryAt: number;
  blocked: boolean;
  lastErrorCode: string | null;
}

export function newLocalTaskEdit(
  taskId: string,
  scope: string,
  patch: LocalTaskEditPatch,
  deleted: boolean,
  now: number,
): LocalTaskEdit {
  return {
    taskId,
    scope,
    patch,
    deleted,
    createdAt: now,
    attemptCount: 0,
    nextRetryAt: now,
    blocked: false,
    lastErrorCode: null,
  };
}

/** Merge a newer intent into an existing record; a delete always wins over field edits. */
export function mergeLocalTaskEdit(
  previous: LocalTaskEdit,
  next: LocalTaskEditPatch | null,
): LocalTaskEdit {
  if (next === null)
    return { ...previous, deleted: true, patch: {}, nextRetryAt: 0, blocked: false };
  return {
    ...previous,
    patch: { ...previous.patch, ...next },
    nextRetryAt: 0,
    blocked: false,
  };
}

export function retryLocalTaskEdit(
  record: LocalTaskEdit,
  status: number | null,
  now: number,
  retryAfterMs: number | null = null,
): LocalTaskEdit {
  const attemptCount = record.attemptCount + 1;
  const blocked =
    status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429;
  const backoff = retryAfterMs ?? Math.min(60_000, 1_000 * 2 ** Math.min(attemptCount, 6));
  return {
    ...record,
    attemptCount,
    blocked,
    lastErrorCode: blocked ? `http_${status}` : status === null ? 'network' : `http_${status}`,
    nextRetryAt: blocked ? now : now + backoff,
  };
}

export function localTaskEditIssue(record: LocalTaskEdit): string | null {
  if (record.blocked) return record.lastErrorCode ?? 'conflict';
  return null;
}

/**
 * Apply pending edits on top of the latest confirmed snapshot so the task page shows the
 * user's intent while the write is still queued. Deleted tasks disappear immediately.
 */
export function overlayLocalTaskEdits(
  remote: TaskSnapshotResponse,
  edits: readonly LocalTaskEdit[],
): TaskSnapshotResponse {
  const relevant = edits.filter((edit) => !edit.blocked);
  if (relevant.length === 0) return remote;
  const publishedAt = Math.max(
    remote.snapshot?.publishedAt ?? 0,
    ...relevant.map((edit) => edit.createdAt),
  );
  let snapshot: TaskSnapshotPayload | null = remote.snapshot ?? null;
  for (const edit of [...relevant].sort((a, b) => a.createdAt - b.createdAt)) {
    if (!snapshot) break;
    try {
      snapshot = edit.deleted
        ? deleteTaskSnapshotTask(snapshot, edit.taskId, publishedAt).snapshot
        : updateTaskSnapshotTask(snapshot, edit.taskId, edit.patch, publishedAt);
    } catch {
      // A task that no longer exists (or is now read-only) drops its stale local intent.
      continue;
    }
  }
  return { ...remote, snapshot };
}
