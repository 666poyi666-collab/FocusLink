import { describe, expect, it } from 'vitest';
import type { Task } from '../shared/types';
import { assembleTaskTree, getSubtaskProgress } from '../shared/taskTreeUtils';

function makeTask(id: string, parentId: string | null = null, isCompleted = false): Task {
  return {
    id,
    source: 'local',
    externalId: id,
    projectId: 'local-inbox',
    title: `Task ${id}`,
    status: isCompleted ? 'completed' : 'incomplete',
    isCompleted,
    completedAt: isCompleted ? Date.now() : null,
    priority: null,
    dueDate: null,
    tags: [],
    content: null,
    parentId,
  };
}

describe('taskTreeUtils', () => {
  it('returns empty array for empty input', () => {
    expect(assembleTaskTree([])).toEqual([]);
  });

  it('assembles a parent with 10 subtasks into a single root node with 10 children', () => {
    const tasks: Task[] = [
      makeTask('math-1.1', null, false),
      ...Array.from({ length: 10 }, (_, i) => makeTask(`cycle-${i + 1}`, 'math-1.1', i < 7)),
    ];

    const tree = assembleTaskTree(tasks);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('math-1.1');
    expect(tree[0].children).toHaveLength(10);
    expect(tree[0].children?.[0].id).toBe('cycle-1');
    expect(tree[0].children?.[6].isCompleted).toBe(true);
    expect(tree[0].children?.[7].isCompleted).toBe(false);

    const progress = getSubtaskProgress(tree[0]);
    expect(progress).toEqual({ completed: 7, total: 10 });
  });

  it('handles multi-level hierarchy (parent -> child -> grandchild)', () => {
    const tasks: Task[] = [
      makeTask('root', null),
      makeTask('child', 'root'),
      makeTask('grandchild', 'child'),
    ];

    const tree = assembleTaskTree(tasks);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children?.[0].children).toHaveLength(1);
    expect(tree[0].children?.[0].children?.[0].id).toBe('grandchild');
  });

  it('keeps orphan tasks as root nodes when parent is not in the list', () => {
    const tasks: Task[] = [makeTask('orphan', 'missing-parent'), makeTask('normal', null)];

    const tree = assembleTaskTree(tasks);
    expect(tree).toHaveLength(2);
    expect(tree.map((t) => t.id)).toEqual(['orphan', 'normal']);
  });

  it('safely breaks direct and indirect cycles', () => {
    const cyclicTasks: Task[] = [makeTask('a', 'b'), makeTask('b', 'c'), makeTask('c', 'a')];

    const tree = assembleTaskTree(cyclicTasks);
    expect(tree.length).toBeGreaterThan(0);
    // Tree construction must terminate without stack overflow
  });

  it('is idempotent when re-assembling an already assembled tree', () => {
    const tasks: Task[] = [
      makeTask('parent', null),
      makeTask('c1', 'parent', true),
      makeTask('c2', 'parent', false),
    ];
    const tree1 = assembleTaskTree(tasks);
    expect(tree1).toHaveLength(1);
    expect(tree1[0].children).toHaveLength(2);

    const tree2 = assembleTaskTree(tree1);
    expect(tree2).toHaveLength(1);
    expect(tree2[0].id).toBe('parent');
    expect(tree2[0].children).toHaveLength(2);
    expect(tree2[0].children?.[0].id).toBe('c1');
    expect(tree2[0].children?.[1].id).toBe('c2');
  });
});
