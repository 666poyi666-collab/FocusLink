// 本地任务 Provider - 在 tasks_cache 中管理本地任务（source='local'）
import crypto from 'node:crypto';
import {
  upsertTaskCache,
  upsertTaskCaches,
  listTaskCache,
  searchTaskCache,
  listLocalTaskProjects,
  upsertLocalTaskProject,
  deleteLocalTaskProjectAndMoveTasks,
  restoreLocalTaskProjectDeletion,
  removeStaleLocalTaskSnapshotRows,
  deleteTaskCacheSubtree,
  updateTaskSortOrders,
} from '../db/index.js';
import { logger } from '../logger.js';
import type { LocalTaskProject, Project, Task, TaskCache, TaskSource } from '@shared/types';
import type { SyncedTask, SyncedTaskProject } from '@shared/sync/taskSnapshotProtocol';
import {
  defaultTaskProjectColor,
  FOCUSLINK_INBOX_PROJECT_ID,
  isFocusLinkInboxProject,
  normalizeTaskProjectColor,
} from '@shared/taskProjectPolicy';
import {
  completeTaskRecurrence,
  parseStoredTaskRecurrence,
  restoreFinalTaskRecurrence,
} from '@shared/taskRecurrence';

const LOCAL_PROJECT_ID = FOCUSLINK_INBOX_PROJECT_ID;

export interface LocalTaskProjectDeletion {
  project: Project;
  previousProject: LocalTaskProject;
  movedTaskCount: number;
  /** Kept only for a publication-failure rollback; never returned to renderer/MCP. */
  previousTasks: TaskCache[];
}

function ensureInbox(): void {
  if (typeof listLocalTaskProjects !== 'function' || typeof upsertLocalTaskProject !== 'function') {
    return;
  }
  if (listLocalTaskProjects().some((project) => project.id === LOCAL_PROJECT_ID)) return;
  const now = Date.now();
  upsertLocalTaskProject({
    id: LOCAL_PROJECT_ID,
    name: '收件箱',
    color: normalizeTaskProjectColor(null),
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  });
}

function cacheToTask(c: TaskCache): Task {
  return {
    id: c.id,
    source: c.source,
    externalId: c.externalId,
    projectId: c.projectId,
    parentId: c.parentId ?? null,
    title: c.title,
    status: c.status,
    priority: c.priority,
    startDate: c.startDate ?? null,
    dueDate: c.dueDate,
    recurrence: parseStoredTaskRecurrence(c.recurrence),
    tags: c.tags ? JSON.parse(c.tags) : [],
    content: c.content,
    isCompleted: c.status === 'completed',
    completedAt: c.status === 'completed' ? c.updatedAt : null,
    sortOrder: c.sortOrder ?? null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export const LocalTaskProvider = {
  createProject(name: string, color?: string | null, icon?: string | null): Project {
    const title = name.trim();
    if (!title) throw new Error('清单名称不能为空');
    ensureInbox();
    const now = Date.now();
    const id = crypto.randomUUID();
    const projectColor = color
      ? normalizeTaskProjectColor(color)
      : defaultTaskProjectColor(
          listLocalTaskProjects().filter((project) => !isFocusLinkInboxProject(project.id)).length +
            1,
        );
    const projectIcon = icon && icon.trim() ? icon.trim() : null;
    upsertLocalTaskProject({
      id,
      name: title,
      color: projectColor,
      icon: projectIcon,
      sortOrder: listLocalTaskProjects().length,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id,
      source: 'local',
      externalId: id,
      name: title,
      color: projectColor,
      icon: projectIcon,
    };
  },
  updateProject(
    projectId: string,
    input: { name?: string; color?: string | null; icon?: string | null },
  ): Project {
    ensureInbox();
    const project = listLocalTaskProjects().find((candidate) => candidate.id === projectId);
    if (!project) throw new Error('FocusLink 清单不存在');
    const name = input.name === undefined ? project.name : input.name.trim();
    if (!name) throw new Error('清单名称不能为空');
    if (isFocusLinkInboxProject(projectId) && name !== project.name) {
      throw new Error('收件箱是系统清单，不能重命名');
    }
    const color =
      input.color === undefined ? project.color : normalizeTaskProjectColor(input.color);
    const icon =
      input.icon === undefined
        ? project.icon
        : input.icon && input.icon.trim()
          ? input.icon.trim()
          : null;
    const updatedAt = Date.now();
    upsertLocalTaskProject({ ...project, name, color, icon, updatedAt });
    logger.info('tasks:local', `updated local project: ${projectId}`);
    return { id: project.id, source: 'local', externalId: project.id, name, color, icon };
  },
  deleteProject(projectId: string): LocalTaskProjectDeletion {
    ensureInbox();
    if (isFocusLinkInboxProject(projectId)) throw new Error('收件箱不可删除');
    const project = listLocalTaskProjects().find((candidate) => candidate.id === projectId);
    if (!project) throw new Error('FocusLink 清单不存在');
    const previousTasks = listTaskCache('local').filter((task) => task.projectId === projectId);
    const now = Date.now();
    if (typeof deleteLocalTaskProjectAndMoveTasks === 'function') {
      deleteLocalTaskProjectAndMoveTasks(projectId, LOCAL_PROJECT_ID, now);
    } else {
      // Keep lightweight provider unit tests and older embedded builds usable while the
      // production SQLite path remains atomic through the function above.
      upsertTaskCaches(
        previousTasks.map((task) => ({ ...task, projectId: LOCAL_PROJECT_ID, updatedAt: now })),
      );
      // The old mock/database cannot delete rows; real databases always take the atomic path.
    }
    logger.info('tasks:local', `deleted local project and moved tasks to inbox: ${projectId}`, {
      movedTaskCount: previousTasks.length,
    });
    return {
      project: {
        id: project.id,
        source: 'local',
        externalId: project.id,
        name: project.name,
        color: project.color,
      },
      previousProject: project,
      movedTaskCount: previousTasks.length,
      previousTasks,
    };
  },
  rollbackProjectDeletion(deletion: LocalTaskProjectDeletion): void {
    if (typeof restoreLocalTaskProjectDeletion === 'function') {
      restoreLocalTaskProjectDeletion(deletion.previousProject, deletion.previousTasks);
      return;
    }
    upsertLocalTaskProject({
      ...deletion.previousProject,
    });
    upsertTaskCaches(deletion.previousTasks);
  },
  create(
    title: string,
    _projectId?: string,
    options?: { parentId?: string | null; dueDate?: number | null; priority?: number | null },
  ): Task {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new Error('任务标题不能为空');
    ensureInbox();
    const projectId = _projectId ?? LOCAL_PROJECT_ID;
    if (!listLocalTaskProjects().some((project) => project.id === projectId)) {
      throw new Error('FocusLink 清单不存在');
    }
    const all = listTaskCache('local');
    const parentId = options?.parentId ?? null;
    if (parentId) {
      const parent = all.find((task) => task.id === parentId);
      if (!parent) throw new Error('父任务不存在');
      // 产品约定只支持两层：子任务不能再挂子任务。
      if (parent.parentId) throw new Error('子任务下不能再建子任务');
    }
    // 新任务排在同组末尾：与列表底部的行内添加框位置一致，落点可预期。
    const maxOrder = all
      .filter((task) => task.projectId === projectId && (task.parentId ?? null) === parentId)
      .reduce((max, task) => Math.max(max, task.sortOrder ?? 0), 0);
    const now = Date.now();
    const id = crypto.randomUUID();
    const cache: TaskCache = {
      id,
      source: 'local' as TaskSource,
      externalId: id,
      projectId,
      parentId,
      title: normalizedTitle,
      status: 'incomplete',
      priority: options?.priority ?? null,
      startDate: null,
      dueDate: options?.dueDate ?? null,
      recurrence: null,
      tags: null,
      content: null,
      rawJson: null,
      lastSyncedAt: null,
      sortOrder: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    };
    upsertTaskCache(cache);
    logger.info('tasks:local', `created local task: ${normalizedTitle}`);
    return cacheToTask(cache);
  },

  list(): Task[] {
    return listTaskCache('local').map(cacheToTask);
  },

  listProjects(): Project[] {
    ensureInbox();
    return listLocalTaskProjects().map((project) => ({
      id: project.id,
      source: 'local',
      externalId: project.id,
      name: project.name,
      color: project.color,
      icon: project.icon ?? null,
    }));
  },

  importExternal(projects: readonly Project[], tasks: readonly Task[]): number {
    ensureInbox();
    const now = Date.now();
    const localProjectIds = new Map<string, string>();
    projects.forEach((project, index) => {
      const id = `local-project-${project.externalId || project.id}`;
      localProjectIds.set(`${project.source}:${project.id}`, id);
      upsertLocalTaskProject({
        id,
        name: project.name,
        color: project.color,
        sortOrder: index + 1,
        createdAt: now,
        updatedAt: now,
      });
    });
    const existing = new Map(
      this.list()
        .map((task) => [task.content?.match(/external:([^\n]+)/)?.[1], task.id] as const)
        .filter(([key]) => Boolean(key)),
    );
    let imported = 0;
    const visit = (task: Task, parentLocalId: string | null = null) => {
      const externalKey = `${task.source}:${task.externalId || task.id}`;
      let localId = existing.get(externalKey);
      if (!localId) {
        const id = crypto.randomUUID();
        localId = id;
        upsertTaskCache({
          id,
          source: 'local',
          externalId: id,
          projectId: localProjectIds.get(`${task.source}:${task.projectId}`) ?? LOCAL_PROJECT_ID,
          parentId: parentLocalId,
          title: task.title,
          status: task.isCompleted ? 'completed' : 'incomplete',
          priority: task.priority,
          startDate: task.startDate ?? null,
          dueDate: task.dueDate,
          recurrence: task.recurrence ? JSON.stringify(task.recurrence) : null,
          tags: JSON.stringify(task.tags),
          content: `${task.content ?? ''}${task.content ? '\n' : ''}external:${externalKey}`,
          rawJson: JSON.stringify({ importedFrom: externalKey }),
          lastSyncedAt: now,
          createdAt: task.createdAt ?? now,
          updatedAt: now,
        });
        existing.set(externalKey, localId);
        imported++;
      }
      for (const child of task.children ?? []) visit(child, localId ?? null);
    };
    tasks.forEach((task) => visit(task));
    return imported;
  },

  mergeCloudSnapshot(
    projects: readonly SyncedTaskProject[],
    tasks: readonly SyncedTask[],
    cloudPublishedAt = 0,
  ): number {
    ensureInbox();
    const now = Date.now();
    const currentProjects = new Map(
      listLocalTaskProjects().map((project) => [project.id, project] as const),
    );
    projects.forEach((project, index) => {
      const existing = currentProjects.get(project.id);
      if (existing && existing.updatedAt >= cloudPublishedAt) return;
      upsertLocalTaskProject({
        id: project.id,
        name: project.name,
        color: isFocusLinkInboxProject(project.id)
          ? normalizeTaskProjectColor(project.color)
          : project.color,
        sortOrder: index + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: cloudPublishedAt || now,
      });
    });
    // A task snapshot is a complete register, so absence is meaningful.  Only remove rows
    // that were not edited after the authority's publication hint; a local newer edit remains
    // eligible to be republished by the next desktop refresh.
    if (cloudPublishedAt > 0 && typeof removeStaleLocalTaskSnapshotRows === 'function') {
      removeStaleLocalTaskSnapshotRows(
        projects.filter((project) => project.source === 'local').map((project) => project.id),
        tasks.filter((task) => task.source === 'local').map((task) => task.id),
        LOCAL_PROJECT_ID,
        cloudPublishedAt,
      );
    }
    const current = new Map(listTaskCache('local').map((task) => [task.id, task]));
    let changed = 0;
    for (const task of tasks) {
      if (task.source !== 'local') continue;
      const existing = current.get(task.id);
      if (existing && (existing.updatedAt ?? 0) >= (task.updatedAt ?? 0)) continue;
      const startDate =
        task.startDate === undefined ? (existing?.startDate ?? null) : task.startDate;
      const recurrence =
        task.recurrence === undefined
          ? (existing?.recurrence ?? null)
          : task.recurrence
            ? JSON.stringify(task.recurrence)
            : null;
      upsertTaskCache({
        id: task.id,
        source: 'local',
        externalId: task.id,
        projectId: task.projectId,
        parentId: task.parentId,
        title: task.title,
        status: task.isCompleted ? 'completed' : (task.status ?? 'incomplete'),
        priority: task.priority,
        startDate,
        dueDate: task.dueDate,
        recurrence,
        tags: JSON.stringify(task.tags),
        content: existing?.content ?? null,
        rawJson: existing?.rawJson ?? null,
        lastSyncedAt: now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: task.updatedAt ?? now,
      });
      changed++;
    }
    return changed;
  },

  search(query: string): Task[] {
    if (!query.trim()) return this.list();
    return searchTaskCache(query, 'local').map(cacheToTask);
  },

  getById(id: string): Task | null {
    const all = listTaskCache('local');
    const c = all.find((t) => t.id === id || t.externalId === id);
    return c ? cacheToTask(c) : null;
  },

  moveTask(id: string, targetProjectId?: string | null): Task {
    ensureInbox();
    const projectId = targetProjectId ?? LOCAL_PROJECT_ID;
    if (!listLocalTaskProjects().some((project) => project.id === projectId)) {
      throw new Error('目标清单不存在');
    }
    const all = listTaskCache('local');
    const root = all.find((task) => task.id === id || task.externalId === id);
    if (!root) throw new Error(`本地任务不存在: ${id}`);
    const movingIds = new Set([root.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of all) {
        if (task.parentId && movingIds.has(task.parentId) && !movingIds.has(task.id)) {
          movingIds.add(task.id);
          changed = true;
        }
      }
    }
    const now = Date.now();
    const rows = all
      .filter((task) => movingIds.has(task.id))
      .map((task) => ({
        ...task,
        projectId,
        parentId: task.id === root.id && task.parentId ? null : task.parentId,
        updatedAt: now,
      }));
    upsertTaskCaches(rows);
    logger.info('tasks:local', `moved local task subtree: ${root.id}`, {
      projectId,
      count: rows.length,
    });
    return cacheToTask(rows.find((task) => task.id === root.id)!);
  },

  complete(id: string): Task {
    return this.setCompleted(id, true);
  },

  setCompleted(id: string, completed: boolean): Task {
    const all = listTaskCache('local');
    const c = all.find((t) => t.id === id || t.externalId === id);
    if (!c) throw new Error(`本地任务不存在: ${id}`);
    if ((c.status === 'completed') === completed) return cacheToTask(c);
    const changedAt = Date.now();
    const recurrence = parseStoredTaskRecurrence(c.recurrence);
    if (recurrence && completed) {
      const completion = completeTaskRecurrence(
        {
          startDate: c.startDate ?? null,
          dueDate: c.dueDate,
          recurrence,
        },
        changedAt,
      );
      c.startDate = completion.startDate;
      c.dueDate = completion.dueDate;
      c.recurrence = JSON.stringify(completion.recurrence);
      c.status = completion.exhausted ? 'completed' : 'incomplete';
    } else {
      if (recurrence && !completed && c.status === 'completed') {
        c.recurrence = JSON.stringify(restoreFinalTaskRecurrence(recurrence));
      }
      c.status = completed ? 'completed' : 'incomplete';
    }
    c.updatedAt = changedAt;
    upsertTaskCache(c);
    logger.info(
      'tasks:local',
      `${completed && c.status !== 'completed' ? 'advanced recurring' : completed ? 'completed' : 'reopened'} local task: ${c.title}`,
    );
    return cacheToTask(c);
  },

  /** 更新本地任务的可编辑字段。未传入的字段保持原值。 */
  update(
    id: string,
    patch: {
      title?: string;
      dueDate?: number | null;
      startDate?: number | null;
      priority?: number | null;
      tags?: string[] | null;
      content?: string | null;
      projectId?: string | null;
    },
  ): Task {
    const all = listTaskCache('local');
    const c = all.find((t) => t.id === id || t.externalId === id);
    if (!c) throw new Error(`本地任务不存在: ${id}`);
    const next: TaskCache = { ...c, updatedAt: Date.now() };
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new Error('任务标题不能为空');
      next.title = title;
    }
    if (patch.dueDate !== undefined) next.dueDate = patch.dueDate ?? null;
    if (patch.startDate !== undefined) next.startDate = patch.startDate ?? null;
    if (patch.priority !== undefined) next.priority = patch.priority ?? null;
    if (patch.content !== undefined) {
      const content = (patch.content ?? '').trim();
      next.content = content.length > 0 ? content : null;
    }
    if (patch.tags !== undefined) {
      const tags = (patch.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
      next.tags = tags.length > 0 ? JSON.stringify(Array.from(new Set(tags))) : null;
    }
    if (patch.projectId !== undefined) {
      const projectId = patch.projectId ?? LOCAL_PROJECT_ID;
      if (!listLocalTaskProjects().some((project) => project.id === projectId)) {
        throw new Error('FocusLink 清单不存在');
      }
      next.projectId = projectId;
    }
    upsertTaskCache(next);
    logger.info('tasks:local', `updated local task: ${next.title}`);
    return cacheToTask(next);
  },

  /** 删除任务及其全部子任务。 */
  remove(id: string): { removed: number } {
    const all = listTaskCache('local');
    const root = all.find((t) => t.id === id || t.externalId === id);
    if (!root) throw new Error(`本地任务不存在: ${id}`);
    const removed = deleteTaskCacheSubtree(root.id);
    logger.info('tasks:local', `deleted local task subtree: ${root.id}`, { removed });
    return { removed };
  },

  /** 把任务挂到另一个任务下（或移出子任务层级）。只允许两层。 */
  setParent(id: string, parentId: string | null): Task {
    const all = listTaskCache('local');
    const root = all.find((t) => t.id === id || t.externalId === id);
    if (!root) throw new Error(`本地任务不存在: ${id}`);
    if (parentId) {
      if (parentId === root.id) throw new Error('任务不能成为自己的子任务');
      const parent = all.find((task) => task.id === parentId);
      if (!parent) throw new Error('父任务不存在');
      // 环检测必须排在层级检查之前：把任务挂到自己的后代下时，
      // 「会形成环」比「后代自己已经有父任务」更准确地说出用户做错了什么。
      const descendants = new Set<string>();
      let changed = true;
      while (changed) {
        changed = false;
        for (const task of all) {
          if (!task.parentId) continue;
          if (task.parentId === root.id || descendants.has(task.parentId)) {
            if (!descendants.has(task.id)) {
              descendants.add(task.id);
              changed = true;
            }
          }
        }
      }
      if (descendants.has(parentId)) throw new Error('不能把任务移动到自己的子任务下');
      if (parent.parentId) throw new Error('子任务下不能再建子任务');
    }
    const next: TaskCache = { ...root, parentId: parentId ?? null, updatedAt: Date.now() };
    upsertTaskCache(next);
    logger.info('tasks:local', `reparented local task: ${next.id}`);
    return cacheToTask(next);
  },

  /** 按传入顺序重写手动排序位（拖拽重排后由渲染层提交整组顺序）。 */
  reorder(orderedIds: readonly string[]): void {
    updateTaskSortOrders(orderedIds.map((taskId, index) => ({ id: taskId, sortOrder: index + 1 })));
    logger.info('tasks:local', `reordered ${orderedIds.length} local tasks`);
  },
};
