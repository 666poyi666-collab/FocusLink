import { describe, expect, it } from 'vitest';
import type {
  TaskSnapshotPayload,
  TaskSnapshotResponse,
} from '../shared/sync/taskSnapshotProtocol';
import {
  deleteTaskSnapshotTask,
  updateTaskSnapshotTask,
} from '../src/mobile/taskSnapshotMutations';
import {
  localTaskEditIssue,
  mergeLocalTaskEdit,
  newLocalTaskEdit,
  overlayLocalTaskEdits,
  retryLocalTaskEdit,
} from '../src/mobile/localTaskEdits';

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

const snapshot: TaskSnapshotPayload = {
  publishedAt: 10,
  projects: [{ id: 'local-inbox', source: 'local', name: '收件箱', color: '#16899f' }],
  tasks: [makeTask('parent'), { ...makeTask('child', { parentId: 'parent' }) }],
};

const response: TaskSnapshotResponse = {
  protocolVersion: 1,
  revision: 4,
  sourceDeviceId: 'device-a',
  snapshot,
  serverTime: 11,
};

describe('local task edit queue', () => {
  it('merges repeated edits of the same task into one final intent', () => {
    const first = newLocalTaskEdit('parent', 'unpaired', { title: '新标题' }, false, 100);
    const merged = mergeLocalTaskEdit(first, { priority: 3 });
    expect(merged.patch).toEqual({ title: '新标题', priority: 3 });
    expect(merged.deleted).toBe(false);
    expect(mergeLocalTaskEdit(merged, null).deleted).toBe(true);
  });

  it('overlays a pending edit and a pending delete on the confirmed snapshot', () => {
    const edited = overlayLocalTaskEdits(response, [
      newLocalTaskEdit('parent', 'unpaired', { title: '改过的标题' }, false, 100),
      newLocalTaskEdit('child', 'unpaired', {}, true, 200),
    ]);
    expect(edited.revision).toBe(4);
    expect(edited.snapshot?.tasks.find((task) => task.id === 'parent')?.title).toBe('改过的标题');
    expect(edited.snapshot?.tasks.some((task) => task.id === 'child')).toBe(false);
  });

  it('backoff grows, a 4xx blocks the record, and blocked records stop overlaying', () => {
    const base = newLocalTaskEdit('parent', 'unpaired', { title: 'x' }, false, 0);
    const retried = retryLocalTaskEdit(base, null, 1_000);
    expect(retried.nextRetryAt).toBeGreaterThan(1_000);
    expect(retried.blocked).toBe(false);
    const blocked = retryLocalTaskEdit(base, 409, 2_000);
    expect(blocked.blocked).toBe(true);
    expect(localTaskEditIssue(blocked)).toBe('http_409');
    const overlaid = overlayLocalTaskEdits(response, [blocked]);
    expect(overlaid.snapshot?.tasks.find((task) => task.id === 'parent')?.title).toBe('parent');
  });

  it('rejects edits to imported tasks and empty titles, and cascades deletes', () => {
    const imported: TaskSnapshotPayload = {
      ...snapshot,
      tasks: [{ ...makeTask('remote'), source: 'dida' as never }],
    };
    expect(() => updateTaskSnapshotTask(imported, 'remote', { title: 'x' }, 5)).toThrow();
    expect(() => updateTaskSnapshotTask(snapshot, 'parent', { title: '   ' }, 5)).toThrow();
    expect(() => updateTaskSnapshotTask(snapshot, 'parent', { priority: 9 }, 5)).toThrow();
    const removed = deleteTaskSnapshotTask(snapshot, 'parent', 6);
    expect(removed.removedTaskCount).toBe(2);
    expect(removed.snapshot.tasks).toHaveLength(0);
  });
});
