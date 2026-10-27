import type { SyncedTask, TaskSnapshotResponse } from '@shared/sync/taskSnapshotProtocol';
import { TASK_SNAPSHOT_PROTOCOL_VERSION } from '@shared/sync/taskSnapshotProtocol';
import { createEmptyTaskSnapshot } from './taskSnapshotMutations';
import { FOCUSLINK_INBOX_PROJECT_ID } from '@shared/taskProjectPolicy';

export interface LocalTaskCreate {
  id: string;
  scope: string;
  title: string;
  projectId: string | null;
  createdAt: number;
  expectedRevision: number | null;
  operationId: string;
  revisionAttempt: number;
  attemptCount: number;
  nextRetryAt: number;
  blocked: boolean;
  lastErrorCode: string | null;
}

export function newLocalTaskCreate(
  id: string,
  scope: string,
  title: string,
  projectId: string | null,
  now = Date.now(),
): LocalTaskCreate {
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error('任务名称不能为空');
  return {
    id,
    scope,
    title: cleanTitle,
    projectId,
    createdAt: now,
    expectedRevision: null,
    operationId: `local-task:${id}:create:0`,
    revisionAttempt: 0,
    attemptCount: 0,
    nextRetryAt: 0,
    blocked: false,
    lastErrorCode: null,
  };
}

export function prepareLocalTaskCreate(
  record: LocalTaskCreate,
  remote: TaskSnapshotResponse,
): LocalTaskCreate {
  if (record.expectedRevision !== null) return record;
  const projectId = remote.snapshot?.projects.some((p) => p.id === record.projectId)
    ? record.projectId
    : FOCUSLINK_INBOX_PROJECT_ID;
  return { ...record, projectId, expectedRevision: remote.revision };
}

export function retryLocalTaskCreate(
  record: LocalTaskCreate,
  status: number | null,
  now = Date.now(),
  retryAfterMs: number | null = null,
): LocalTaskCreate {
  const attemptCount = (record.attemptCount ?? 0) + 1;
  // Only a definitive CAS rejection permits a new base and a new operation id.
  if (status === 409) {
    const revisionAttempt = record.revisionAttempt + 1;
    return {
      ...record,
      expectedRevision: null,
      revisionAttempt,
      attemptCount,
      operationId: `local-task:${record.id}:create:${revisionAttempt}`,
      nextRetryAt: now + 1_000,
      lastErrorCode: 'revision_mismatch',
    };
  }
  const base = Math.min(15 * 60_000, 15_000 * 2 ** Math.min(attemptCount - 1, 8));
  const spread =
    [...record.id].reduce((sum, char) => sum + char.charCodeAt(0), attemptCount * 17) % 101;
  const delay = Math.min(
    15 * 60_000,
    Math.max(Math.round(base * (0.8 + spread / 250)), retryAfterMs ?? 0),
  );
  return {
    ...record,
    attemptCount,
    blocked:
      status === 401 ||
      status === 403 ||
      (status !== null && status >= 400 && status < 500 && status !== 429),
    nextRetryAt: now + delay,
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

export function localTaskCreateIssue(record: LocalTaskCreate): string | null {
  if (!record.blocked) return null;
  if (record.lastErrorCode === 'authentication_failed')
    return '设备身份已失效，需要重新配对；本机任务仍保留';
  if (record.lastErrorCode === 'authorization_failed')
    return '当前设备没有任务写入权限；本机任务仍保留';
  if (record.lastErrorCode === 'contract_error') return '同步回执异常，请重新检查；本机任务仍保留';
  return '云端未接受任务，请到同步详情重新检查；本机任务仍保留';
}

export function localTaskFromCreate(record: LocalTaskCreate): SyncedTask {
  return {
    id: record.id,
    source: 'local',
    projectId: record.projectId || FOCUSLINK_INBOX_PROJECT_ID,
    title: record.title,
    status: 'incomplete',
    priority: null,
    dueDate: null,
    tags: [],
    parentId: null,
    isCompleted: false,
    updatedAt: record.createdAt,
  };
}

/** Pending local rows are a UI projection; never forge the cloud register revision. */
export function overlayLocalTaskCreates(
  remote: TaskSnapshotResponse | null,
  pending: readonly LocalTaskCreate[],
): TaskSnapshotResponse {
  const base = remote ?? {
    protocolVersion: TASK_SNAPSHOT_PROTOCOL_VERSION,
    revision: 0,
    sourceDeviceId: null,
    snapshot: createEmptyTaskSnapshot(0),
    serverTime: 0,
  };
  if (pending.length === 0) return base;
  const payload = base.snapshot ?? createEmptyTaskSnapshot(0);
  const ids = new Set(payload.tasks.map((t) => t.id));
  return {
    ...base,
    snapshot: {
      ...payload,
      tasks: [...pending.filter((p) => !ids.has(p.id)).map(localTaskFromCreate), ...payload.tasks],
    },
  };
}
