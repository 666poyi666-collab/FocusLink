import type { SyncedTaskProject, TaskSnapshotPayload } from '@shared/sync/taskSnapshotProtocol';
import { fingerprintDeviceSyncValue } from '@shared/sync/deviceProtocol';
import {
  defaultTaskProjectColor,
  FOCUSLINK_INBOX_PROJECT_ID,
  isFocusLinkInboxProject,
  normalizeTaskProjectColor,
} from '@shared/taskProjectPolicy';

/** Stable across a response-loss retry, but changes with task intent or observed revision. */
export function mobileTaskCompletionOperationId(input: {
  deviceId: string;
  taskId: string;
  completed: boolean;
  expectedRevision: number;
}): string {
  return `mobile-task:${fingerprintDeviceSyncValue(input)}`;
}

export function createEmptyTaskSnapshot(publishedAt: number): TaskSnapshotPayload {
  return {
    publishedAt,
    projects: [
      {
        id: FOCUSLINK_INBOX_PROJECT_ID,
        source: 'local',
        name: '收件箱',
        color: defaultTaskProjectColor(0),
      },
    ],
    tasks: [],
  };
}

export function updateTaskSnapshotProject(
  snapshot: TaskSnapshotPayload,
  project: SyncedTaskProject,
  input: { name?: string; color?: string | null },
  publishedAt: number,
): TaskSnapshotPayload {
  if (project.source !== 'local') throw new Error('只能编辑 FocusLink 清单');
  if (isFocusLinkInboxProject(project.id)) throw new Error('收件箱不能重命名');
  if (!snapshot.projects.some((candidate) => candidate.id === project.id)) {
    throw new Error('FocusLink 清单不存在');
  }
  const name = input.name === undefined ? project.name : input.name.trim();
  if (!name) throw new Error('清单名称不能为空');
  return {
    ...snapshot,
    publishedAt,
    projects: snapshot.projects.map((candidate) =>
      candidate.id === project.id
        ? {
            ...candidate,
            name,
            color:
              input.color === undefined ? candidate.color : normalizeTaskProjectColor(input.color),
          }
        : candidate,
    ),
  };
}

/** Delete a user list while preserving every task/subtask in the canonical inbox. */
export function deleteTaskSnapshotProject(
  snapshot: TaskSnapshotPayload,
  project: SyncedTaskProject,
  publishedAt: number,
): { snapshot: TaskSnapshotPayload; movedTaskCount: number } {
  if (project.source !== 'local') throw new Error('只能删除 FocusLink 清单');
  if (isFocusLinkInboxProject(project.id)) throw new Error('收件箱不可删除');
  if (!snapshot.projects.some((candidate) => candidate.id === project.id)) {
    throw new Error('FocusLink 清单不存在');
  }
  const movedTaskCount = snapshot.tasks.filter((task) => task.projectId === project.id).length;
  const projects = snapshot.projects.filter((candidate) => candidate.id !== project.id);
  if (!projects.some((candidate) => isFocusLinkInboxProject(candidate.id))) {
    projects.unshift({
      id: FOCUSLINK_INBOX_PROJECT_ID,
      source: 'local',
      name: '收件箱',
      color: normalizeTaskProjectColor(null),
    });
  }
  return {
    movedTaskCount,
    snapshot: {
      ...snapshot,
      publishedAt,
      projects,
      tasks: snapshot.tasks.map((task) =>
        task.projectId === project.id
          ? { ...task, projectId: FOCUSLINK_INBOX_PROJECT_ID, updatedAt: publishedAt }
          : task,
      ),
    },
  };
}

export function moveTaskSnapshotSubtree(
  snapshot: TaskSnapshotPayload,
  taskId: string,
  targetProjectId: string | null | undefined,
  publishedAt: number,
): TaskSnapshotPayload {
  const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error('FocusLink 任务不存在');
  if (task.source !== 'local') throw new Error('导入任务需先转为 FocusLink 任务');
  const projectId = targetProjectId || FOCUSLINK_INBOX_PROJECT_ID;
  if (
    !isFocusLinkInboxProject(projectId) &&
    !snapshot.projects.some((project) => project.id === projectId)
  ) {
    throw new Error('目标清单不存在');
  }
  const movingIds = new Set([task.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of snapshot.tasks) {
      if (candidate.parentId && movingIds.has(candidate.parentId) && !movingIds.has(candidate.id)) {
        movingIds.add(candidate.id);
        changed = true;
      }
    }
  }
  return {
    ...snapshot,
    publishedAt,
    tasks: snapshot.tasks.map((candidate) =>
      movingIds.has(candidate.id)
        ? {
            ...candidate,
            projectId,
            parentId: candidate.id === task.id && candidate.parentId ? null : candidate.parentId,
            updatedAt: publishedAt,
          }
        : candidate,
    ),
  };
}

/** Update one local FocusLink task's editable fields; imported tasks stay read-only. */
export function updateTaskSnapshotTask(
  snapshot: TaskSnapshotPayload,
  taskId: string,
  patch: {
    title?: string;
    priority?: number | null;
    startDate?: number | null;
    dueDate?: number | null;
    tags?: string[];
    parentId?: string | null;
  },
  publishedAt: number,
): TaskSnapshotPayload {
  const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error('FocusLink 任务不存在');
  if (task.source !== 'local') throw new Error('导入任务需先转为 FocusLink 任务');
  let title = task.title;
  if (patch.title !== undefined) {
    title = patch.title.trim();
    if (!title) throw new Error('任务标题不能为空');
  }
  if (patch.priority !== undefined && patch.priority !== null) {
    if (!Number.isInteger(patch.priority) || patch.priority < 0 || patch.priority > 3) {
      throw new Error('优先级只能是 0–3');
    }
  }
  if (patch.parentId !== undefined && patch.parentId !== null) {
    if (patch.parentId === taskId) throw new Error('任务不能成为自己的子任务');
    const parent = snapshot.tasks.find((candidate) => candidate.id === patch.parentId);
    if (!parent) throw new Error('父任务不存在');
    if (parent.parentId) throw new Error('暂不支持三级子任务');
  }
  return {
    ...snapshot,
    publishedAt,
    tasks: snapshot.tasks.map((candidate) =>
      candidate.id === taskId
        ? {
            ...candidate,
            title,
            priority: patch.priority === undefined ? candidate.priority : patch.priority,
            startDate: patch.startDate === undefined ? candidate.startDate : patch.startDate,
            dueDate: patch.dueDate === undefined ? candidate.dueDate : patch.dueDate,
            tags:
              patch.tags === undefined
                ? candidate.tags
                : patch.tags.map((tag) => tag.trim()).filter(Boolean),
            parentId: patch.parentId === undefined ? candidate.parentId : patch.parentId,
            updatedAt: publishedAt,
          }
        : candidate,
    ),
  };
}

/** Delete a local FocusLink task together with its subtasks. */
export function deleteTaskSnapshotTask(
  snapshot: TaskSnapshotPayload,
  taskId: string,
  publishedAt: number,
): { snapshot: TaskSnapshotPayload; removedTaskCount: number } {
  const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error('FocusLink 任务不存在');
  if (task.source !== 'local') throw new Error('导入任务需先转为 FocusLink 任务');
  const removing = new Set([task.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of snapshot.tasks) {
      if (candidate.parentId && removing.has(candidate.parentId) && !removing.has(candidate.id)) {
        removing.add(candidate.id);
        changed = true;
      }
    }
  }
  return {
    removedTaskCount: removing.size,
    snapshot: {
      ...snapshot,
      publishedAt,
      tasks: snapshot.tasks.filter((candidate) => !removing.has(candidate.id)),
    },
  };
}
