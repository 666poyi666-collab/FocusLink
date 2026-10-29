import { describe, expect, it } from 'vitest';
import type {
  TaskSnapshotPayload,
  TaskSnapshotResponse,
} from '../shared/sync/taskSnapshotProtocol';
import type { TaskRecurrence } from '../shared/types';
import {
  TASK_COMPLETION_UNDO_MS,
  completionOperationId,
  newLocalTaskCompletion,
  overlayLocalTaskCompletions,
  replaceLocalTaskCompletion,
  retryLocalTaskCompletion,
  sortLocalTaskCompletions,
} from '../src/mobile/localTaskCompletions';

function makeTask(
  id: string,
  overrides: Record<string, unknown> = {},
): TaskSnapshotPayload['tasks'][number] {
  return {
    id,
    source: 'local',
    projectId: 'local-inbox',
    parentId: null,
    title: id,
    status: 'incomplete',
    priority: 0,
    startDate: null,
    dueDate: null,
    recurrence: null,
    tags: [] as string[],
    isCompleted: false,
    updatedAt: 1,
    ...overrides,
  } as TaskSnapshotPayload['tasks'][number];
}

const dailyRecurrence: TaskRecurrence = {
  timezone: 'Asia/Shanghai',
  frequency: 'daily',
  interval: 1,
  byWeekday: [],
  byMonthDay: [],
  endAt: null,
  count: null,
  rollover: 'from_schedule',
  completedCount: 0,
};

const DAY_MS = 86_400_000;
const DUE_DATE = 1_767_225_600_000;

function makeSnapshot(tasks: TaskSnapshotPayload['tasks']): TaskSnapshotPayload {
  return {
    publishedAt: 10,
    projects: [{ id: 'local-inbox', source: 'local', name: '收件箱', color: '#16899f' }],
    tasks,
  };
}

function makeResponse(tasks: TaskSnapshotPayload['tasks']): TaskSnapshotResponse {
  return {
    protocolVersion: 1,
    revision: 4,
    sourceDeviceId: 'device-a',
    snapshot: makeSnapshot(tasks),
    serverTime: 11,
  };
}

function taskOf(response: TaskSnapshotResponse, taskId: string) {
  return response.snapshot?.tasks.find((task) => task.id === taskId);
}

describe('local task completion intent', () => {
  it('opens a 6s undo window and keys the operation by target state and revision attempt', () => {
    const intent = newLocalTaskCompletion('task-a', 'unpaired', true, 1_000);

    expect(TASK_COMPLETION_UNDO_MS).toBe(6_000);
    expect(intent).toMatchObject({
      taskId: 'task-a',
      scope: 'unpaired',
      completed: true,
      createdAt: 1_000,
      notBefore: 7_000,
      revisionAttempt: 0,
      attemptCount: 0,
      nextRetryAt: 0,
      blocked: false,
      lastErrorCode: null,
    });
    expect(intent.operationId).toBe('local-task:task-a:complete:0');

    const restore = newLocalTaskCompletion('task-a', 'unpaired', false, 1_000);
    expect(restore.operationId).toBe('local-task:task-a:restore:0');
    expect(restore.operationId).not.toBe(intent.operationId);
    expect(completionOperationId('task-a', true, 1)).not.toBe(intent.operationId);
    expect(completionOperationId('task-a', true, 1)).not.toBe(
      completionOperationId('task-a', false, 1),
    );
  });

  it('rebases only the 409 revision attempt and blocks permanent 4xx failures', () => {
    const intent = newLocalTaskCompletion('task-a', 'unpaired', true, 1_000);

    const conflict = retryLocalTaskCompletion(intent, 409, 5_000);
    expect(conflict.revisionAttempt).toBe(1);
    expect(conflict.operationId).toBe('local-task:task-a:complete:1');
    expect(conflict.blocked).toBe(false);
    expect(conflict.nextRetryAt).toBe(6_000);
    expect(conflict.lastErrorCode).toBe('revision_mismatch');
    expect(conflict.attemptCount).toBe(1);

    for (const [status, code] of [
      [401, 'authentication_failed'],
      [403, 'authorization_failed'],
    ] as const) {
      const blocked = retryLocalTaskCompletion(intent, status, 5_000);
      expect(blocked.blocked).toBe(true);
      expect(blocked.lastErrorCode).toBe(code);
      expect(blocked.nextRetryAt).toBe(5_000);
      expect(blocked.revisionAttempt).toBe(0);
      expect(blocked.operationId).toBe(intent.operationId);
    }

    const throttled = retryLocalTaskCompletion(intent, 429, 5_000, 90_000);
    expect(throttled.blocked).toBe(false);
    expect(throttled.lastErrorCode).toBe('rate_limited');
    expect(throttled.nextRetryAt).toBe(95_000);

    const offline = retryLocalTaskCompletion(intent, null, 5_000);
    expect(offline.blocked).toBe(false);
    expect(offline.lastErrorCode).toBe('network_error');
    expect(offline.nextRetryAt).toBeGreaterThan(5_000);
  });

  it('projects completion and restore onto the confirmed snapshot without mutating it', () => {
    const response = makeResponse([makeTask('task-a'), makeTask('done', { isCompleted: true })]);
    const pending = newLocalTaskCompletion('task-a', 'device-a', true, 100);
    const projected = overlayLocalTaskCompletions(response, [pending]);

    expect(projected.revision).toBe(4);
    expect(taskOf(projected, 'task-a')).toMatchObject({ isCompleted: true, status: 'completed' });
    expect(taskOf(response, 'task-a')).toMatchObject({ isCompleted: false, status: 'incomplete' });
    expect(projected.snapshot).not.toBe(response.snapshot);

    const restore = newLocalTaskCompletion('done', 'device-a', false, 100);
    const restored = overlayLocalTaskCompletions(response, [restore]);
    expect(taskOf(restored, 'done')).toMatchObject({ isCompleted: false, status: 'incomplete' });
    expect(taskOf(response, 'done')?.isCompleted).toBe(true);
  });

  it('keeps blocked records and unknown tasks out of the projection', () => {
    const response = makeResponse([makeTask('task-a')]);
    const blocked = retryLocalTaskCompletion(
      newLocalTaskCompletion('task-a', 'device-a', true, 100),
      401,
      200,
    );
    expect(blocked.blocked).toBe(true);
    expect(taskOf(overlayLocalTaskCompletions(response, [blocked]), 'task-a')?.isCompleted).toBe(
      false,
    );

    const missing = newLocalTaskCompletion('ghost', 'device-a', true, 100);
    const afterMissing = overlayLocalTaskCompletions(response, [missing]);
    expect(afterMissing.snapshot?.tasks).toEqual(response.snapshot?.tasks);
  });

  it('rolls a recurring task forward by one occurrence and counts it', () => {
    const response = makeResponse([
      makeTask('daily', {
        dueDate: DUE_DATE,
        startDate: DUE_DATE - 3_600_000,
        recurrence: dailyRecurrence,
      }),
    ]);
    const projected = overlayLocalTaskCompletions(response, [
      newLocalTaskCompletion('daily', 'device-a', true, 100),
    ]);
    const task = taskOf(projected, 'daily');

    expect(task?.isCompleted).toBe(false);
    expect(task?.status).toBe('incomplete');
    expect(task?.dueDate).toBe(DUE_DATE + DAY_MS);
    expect(task?.startDate).toBe(DUE_DATE - 3_600_000 + DAY_MS);
    expect(task?.recurrence?.completedCount).toBe(1);
    expect(taskOf(response, 'daily')?.recurrence?.completedCount).toBe(0);
  });

  it('replaces the pending intent of one task and keeps creation order stable', () => {
    const base = newLocalTaskCompletion('task-a', 'device-a', true, 1_000);
    const conflicted = retryLocalTaskCompletion(base, 409, 2_000);
    const replaced = replaceLocalTaskCompletion(
      { ...conflicted, attemptCount: 3, blocked: true, nextRetryAt: 7_000, lastErrorCode: 'x' },
      false,
      10_000,
    );

    expect(replaced.completed).toBe(false);
    expect(replaced.createdAt).toBe(1_000);
    expect(replaced.notBefore).toBe(16_000);
    expect(replaced.operationId).toBe('local-task:task-a:restore:0');
    expect(replaced.revisionAttempt).toBe(0);
    expect(replaced.attemptCount).toBe(0);
    expect(replaced.nextRetryAt).toBe(0);
    expect(replaced.blocked).toBe(false);
    expect(replaced.lastErrorCode).toBeNull();

    const records = [
      newLocalTaskCompletion('later', 'device-a', true, 300),
      newLocalTaskCompletion('first', 'device-a', true, 100),
      newLocalTaskCompletion('middle', 'device-a', true, 200),
    ];
    expect(sortLocalTaskCompletions(records).map((record) => record.taskId)).toEqual([
      'first',
      'middle',
      'later',
    ]);
    expect(records.map((record) => record.taskId)).toEqual(['later', 'first', 'middle']);
  });
});
