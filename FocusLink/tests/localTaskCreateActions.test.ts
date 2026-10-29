import { describe, expect, it } from 'vitest';
import {
  completeLocalTaskCreate,
  editLocalTaskCreate,
  localTaskFromCreate,
  newLocalTaskCreate,
  overlayLocalTaskCreates,
} from '../src/mobile/localTaskQueue';
import type { TaskSnapshotResponse } from '../shared/sync/taskSnapshotProtocol';

/**
 * 还没同步出去的新任务也必须能继续操作：勾选、改字段、加子任务都先落在创建记录上，
 * 创建成功后按顺序补交，界面永远看到本机意图。
 */

describe('pending local task actions', () => {
  it('keeps a completed flag and renders it as a completed task', () => {
    const record = newLocalTaskCreate('task-a', 'account-1', '写周报', null, 100);
    expect(record.completed).toBe(false);
    expect(localTaskFromCreate(record).isCompleted).toBe(false);
    const completed = completeLocalTaskCreate(record, true);
    expect(completed.completed).toBe(true);
    const task = localTaskFromCreate(completed);
    expect(task.isCompleted).toBe(true);
    expect(task.status).toBe('completed');
  });

  it('merges pre-sync edits and projects them before the cloud saw them', () => {
    const record = newLocalTaskCreate('task-a', 'account-1', '旧标题', 'local-inbox', 100);
    const edited = editLocalTaskCreate(record, {
      title: '新标题',
      priority: 3,
      dueDate: 1_700_000_000_000,
      tags: ['#学习'],
    });
    expect(edited.title).toBe('新标题');
    expect(edited.patch).toEqual({ priority: 3, dueDate: 1_700_000_000_000, tags: ['#学习'] });
    const task = localTaskFromCreate(edited);
    expect(task.title).toBe('新标题');
    expect(task.priority).toBe(3);
    expect(task.tags).toEqual(['#学习']);
  });

  it('creates a subtask through the same queue with a parent id', () => {
    const record = newLocalTaskCreate('child-1', 'account-1', '子任务', null, 100, 'parent-1');
    expect(record.parentId).toBe('parent-1');
    expect(localTaskFromCreate(record).parentId).toBe('parent-1');
  });

  it('overlays pending creates with their local completion state', () => {
    const record = completeLocalTaskCreate(
      newLocalTaskCreate('task-a', 'account-1', '写周报', null, 100),
      true,
    );
    const remote: TaskSnapshotResponse = {
      protocolVersion: 1,
      revision: 3,
      sourceDeviceId: 'device-a',
      snapshot: null,
      serverTime: 1,
    };
    const overlayed = overlayLocalTaskCreates(remote, [record]);
    const task = overlayed.snapshot?.tasks.find((candidate) => candidate.id === 'task-a');
    expect(task?.isCompleted).toBe(true);
    expect(overlayed.revision).toBe(3);
  });

  it('rejects an empty title when editing before sync', () => {
    const record = newLocalTaskCreate('task-a', 'account-1', '写周报', null, 100);
    expect(() => editLocalTaskCreate(record, { title: '   ' })).toThrow();
  });
});
