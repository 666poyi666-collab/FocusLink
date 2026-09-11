import type { Task } from './types';

export interface SubtaskProgress {
  completed: number;
  total: number;
}

/**
 * 把带 parentId 的扁平任务集合组装为带 children 的树形任务集合。
 *
 * 特性：
 * 1. 采用 id / externalId 索引关联；
 * 2. 环形引用安全防护（防止循环引用导致递归栈溢出）；
 * 3. 父任务不在当前集合中的孤立子任务安全降级为顶层根节点，避免任务丢失；
 * 4. 保持任务原始顺序，不污染原数组（不可变组装）；
 * 5. 如果输入任务已经具有 children，则幂等归一化；空 children 清理为 undefined。
 */
export function assembleTaskTree<T extends Task>(tasks: readonly T[]): T[] {
  if (!tasks || tasks.length === 0) return [];
  if (tasks.length === 1 && (!tasks[0].children || tasks[0].children.length === 0)) {
    return [{ ...tasks[0], children: undefined }];
  }

  // 1. 扁平收集所有节点，防止传入已部分嵌套的数据时丢失子级
  const allTasksMap = new Map<string, T>();
  const allTasksList: T[] = [];
  const collect = (list: readonly T[]) => {
    for (const item of list) {
      if (!allTasksMap.has(item.id)) {
        allTasksMap.set(item.id, item);
        allTasksList.push(item);
      }
      if (item.externalId && !allTasksMap.has(item.externalId)) {
        allTasksMap.set(item.externalId, item);
      }
      if (item.children && item.children.length > 0) {
        collect(item.children as unknown as readonly T[]);
      }
    }
  };
  collect(tasks);

  // 2. 环形与有效父级解析
  const resolveParent = (task: T): T | null => {
    if (!task.parentId) return null;
    const parent = allTasksMap.get(task.parentId);
    if (!parent || parent === task || parent.id === task.id) return null;

    let cursor: T | undefined = parent;
    for (let depth = 0; cursor && depth <= allTasksMap.size; depth += 1) {
      if (cursor === task || cursor.id === task.id) return null; // 环形依赖
      cursor = cursor.parentId ? allTasksMap.get(cursor.parentId) : undefined;
    }
    return parent;
  };

  // 3. 构造全新副本并挂载
  const nodeMap = new Map<string, T>();
  for (const [id, t] of allTasksMap.entries()) {
    if (id === t.id) {
      nodeMap.set(t.id, { ...t, children: [] });
    }
  }

  // 先把所有属于子任务的节点挂载到对应的父节点上
  for (const item of allTasksList) {
    const node = nodeMap.get(item.id);
    if (!node) continue;
    const parent = resolveParent(item);
    if (parent) {
      const parentNode = nodeMap.get(parent.id);
      if (parentNode) {
        parentNode.children = parentNode.children ?? [];
        if (!parentNode.children.some((c) => c.id === node.id)) {
          parentNode.children.push(node);
        }
      }
    }
  }

  const roots: T[] = [];
  const addedToRoots = new Set<string>();

  // 按照输入顺序（优先 tasks，其次 allTasksList 中无有效父级的孤立项）排列根节点
  for (const item of allTasksList) {
    const node = nodeMap.get(item.id);
    if (!node) continue;
    const parent = resolveParent(item);
    if (!parent && !addedToRoots.has(node.id)) {
      roots.push(node);
      addedToRoots.add(node.id);
    }
  }

  // 4. 清理空 children 为 undefined，保持类型一致
  const finalize = (list: T[]): T[] => {
    return list.map((item) => {
      const children =
        item.children && item.children.length > 0
          ? finalize(item.children as unknown as T[])
          : undefined;
      return { ...item, children };
    });
  };

  return finalize(roots);
}

/**
 * 计算任务的子任务完成进度。
 * 仅统计直接子任务或递归子任务的已完成数量与总数量。
 */
export function getSubtaskProgress(task: { children?: readonly any[] }): SubtaskProgress {
  if (!task.children || task.children.length === 0) {
    return { completed: 0, total: 0 };
  }
  let completed = 0;
  let total = 0;
  const walk = (children: readonly any[]) => {
    for (const child of children) {
      total += 1;
      if (child.isCompleted === true || child.status === 'completed') {
        completed += 1;
      }
      if (child.children && child.children.length > 0) {
        walk(child.children);
      }
    }
  };
  walk(task.children);
  return { completed, total };
}
