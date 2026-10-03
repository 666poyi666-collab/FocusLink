import type { Task } from '@shared/types';

export type TaskSort = 'manual' | 'name' | 'date' | 'date-desc' | 'priority';
export const TASK_SORT_OPTIONS: ReadonlyArray<[TaskSort, string]> = [
  ['manual', '自定义顺序'],
  ['name', '名称顺序'],
  ['date', '日期从早到晚'],
  ['date-desc', '日期从晚到早'],
  ['priority', '优先级'],
];
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export function sortTasks(tasks: readonly Task[], mode: TaskSort): Task[] {
  const manual = (a: Task, b: Task) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  const named = (a: Task, b: Task) => collator.compare(a.title, b.title);
  const date = (task: Task) => task.dueDate ?? task.startDate ?? null;
  return [...tasks].sort((a, b) => {
    if (mode === 'manual') return manual(a, b);
    if (mode === 'name') return named(a, b) || manual(a, b);
    if (mode === 'priority') return (b.priority ?? 0) - (a.priority ?? 0) || named(a, b);
    const first = date(a);
    const second = date(b);
    if (first === null || second === null)
      return first === second ? named(a, b) : first === null ? 1 : -1;
    return (first - second) * (mode === 'date-desc' ? -1 : 1) || named(a, b);
  });
}
export function readTaskSort(key: string, fallback: TaskSort): TaskSort {
  try {
    const value = localStorage.getItem(key);
    return TASK_SORT_OPTIONS.some(([mode]) => mode === value) ? (value as TaskSort) : fallback;
  } catch {
    return fallback;
  }
}

/** Reorder the currently displayed sibling group while preserving hidden roots and all children. */
export function moveVisibleTask(
  tasks: readonly Task[],
  visibleIds: readonly string[],
  sourceId: string,
  targetId: string,
  after: boolean,
): Task[] | null {
  const visible = [...visibleIds];
  const source = tasks.find((task) => task.id === sourceId);
  const target = tasks.find((task) => task.id === targetId);
  if (
    !source ||
    !target ||
    sourceId === targetId ||
    !visible.includes(sourceId) ||
    !visible.includes(targetId) ||
    new Set(visible).size !== visible.length ||
    (source.parentId ?? null) !== (target.parentId ?? null) ||
    Boolean(source.isCompleted) !== Boolean(target.isCompleted)
  )
    return null;
  visible.splice(visible.indexOf(sourceId), 1);
  visible.splice(visible.indexOf(targetId) + (after ? 1 : 0), 0, sourceId);
  const ordered = sortTasks(tasks, 'manual');
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (visible.some((id) => !byId.has(id))) return null;
  let index = 0;
  const result = ordered.map((task) =>
    visibleIds.includes(task.id) ? byId.get(visible[index++])! : task,
  );
  return result.map((task, position) => ({ ...task, sortOrder: position + 1 }));
}
