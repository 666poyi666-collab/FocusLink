import { describe, expect, it } from 'vitest';
import type { Task } from '../shared/types';
import { filterTaskTree, sortTaskTree } from '../src/features/tasks/taskTreeModel';

function task(id: string, input: Partial<Task> = {}): Task {
  return {
    id,
    source: 'ticktick',
    externalId: id,
    projectId: 'project-1',
    title: id,
    status: 'pending',
    isCompleted: false,
    completedAt: null,
    priority: null,
    dueDate: null,
    tags: [],
    content: null,
    ...input,
  };
}

describe('task tree sorting', () => {
  it('makes true an alias of smart and actually compares due-date values', () => {
    const source = [
      task('later', { dueDate: Date.parse('2026-08-20T00:00:00Z') }),
      task('none'),
      task('earlier', { dueDate: Date.parse('2026-07-20T00:00:00Z') }),
    ];

    expect(filterTaskTree(source, { sort: true }).tasks.map((item) => item.id)).toEqual([
      'earlier',
      'later',
      'none',
    ]);
    expect(filterTaskTree(source, { sort: 'due' }).tasks.map((item) => item.id)).toEqual([
      'earlier',
      'later',
      'none',
    ]);
  });

  it('sorts Chinese titles with numeric segments naturally', () => {
    const source = [task('c', { title: '任务 10' }), task('a', { title: '任务 2' })];
    expect(sortTaskTree(source, 'title').map((item) => item.title)).toEqual(['任务 2', '任务 10']);
  });

  it('sorts completed tasks newest first and leaves missing timestamps last', () => {
    const source = [
      task('old', { isCompleted: true, status: 'completed', completedAt: 100 }),
      task('unknown', { isCompleted: true, status: 'completed', completedAt: null }),
      task('new', { isCompleted: true, status: 'completed', completedAt: 300 }),
    ];
    expect(sortTaskTree(source, 'completed').map((item) => item.id)).toEqual([
      'new',
      'old',
      'unknown',
    ]);
  });

  it('applies the selected sort recursively without mutating the source tree', () => {
    const source = [
      task('parent', {
        children: [task('child-b', { title: '乙' }), task('child-a', { title: '甲' })],
      }),
    ];
    const sorted = sortTaskTree(source, 'title');

    expect(sorted[0].children?.map((item) => item.title)).toEqual(['甲', '乙']);
    expect(source[0].children?.map((item) => item.title)).toEqual(['乙', '甲']);
  });

  it('assembles a flat list of tasks with parentId into a nested tree', () => {
    const flat = [
      task('chapter-1', { title: '第一章第一节', parentId: null }),
      task('cycle-1', { title: '循环1', parentId: 'chapter-1', isCompleted: true }),
      task('cycle-2', { title: '循环2', parentId: 'chapter-1', isCompleted: false }),
    ];

    const result = filterTaskTree(flat, { showCompleted: true });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('chapter-1');
    expect(result.tasks[0].children).toHaveLength(2);
    expect(result.tasks[0].children?.map((c) => c.id)).toEqual(['cycle-1', 'cycle-2']);
  });

  it('handles cycle dependencies defensively and avoids infinite recursion', () => {
    const cyclic = [task('task-a', { parentId: 'task-b' }), task('task-b', { parentId: 'task-a' })];
    const result = filterTaskTree(cyclic, { showCompleted: true });
    expect(result.tasks.length).toBeGreaterThan(0);
    // Neither should cause a stack overflow
  });
});
