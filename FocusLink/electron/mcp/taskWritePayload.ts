// `/v1/projects` 与 `POST /v1/tasks` 的输入翻译层。
//
// 2026-11-04：外部助手能改会话字段，却建不了清单/任务（本地自动化接口只有 GET /v1/tasks），
// 于是关联任务这一步必须点界面。这里只做参数校验与规范化，写入仍交给
// `electron/tasks/localProvider.ts` 的 `createProject` / `create`，不复制任务模型。
import { SessionWriteError } from './sessionWritePayload.js';

export interface ProjectCreateInput {
  name: string;
  color: string | null;
  icon: string | null;
}

export interface TaskCreateInput {
  title: string;
  projectId: string | null;
  parentId: string | null;
  dueDate: number | null;
  priority: number | null;
}

function has(payload: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function requiredText(payload: Record<string, unknown>, key: string, maxLength: number): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SessionWriteError(400, 'INVALID_ARGUMENT', `${key} is required`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new SessionWriteError(
      400,
      'INVALID_ARGUMENT',
      `${key} must be at most ${maxLength} characters`,
    );
  }
  return text;
}

function optionalText(payload: Record<string, unknown>, key: string): string | null {
  if (!has(payload, key) || payload[key] === null) return null;
  const value = payload[key];
  if (typeof value !== 'string') {
    throw new SessionWriteError(400, 'INVALID_ARGUMENT', `${key} must be a string or null`);
  }
  const text = value.trim();
  return text === '' ? null : text;
}

function optionalInteger(payload: Record<string, unknown>, key: string): number | null {
  if (!has(payload, key) || payload[key] === null) return null;
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new SessionWriteError(400, 'INVALID_ARGUMENT', `${key} must be an integer or null`);
  }
  return value;
}

/** 清单创建：名称必填，颜色/图标可选（颜色交给 shared/taskProjectPolicy 归一化）。 */
export function parseProjectCreate(payload: Record<string, unknown>): ProjectCreateInput {
  return {
    name: requiredText(payload, 'name', 60),
    color: optionalText(payload, 'color'),
    icon: optionalText(payload, 'icon'),
  };
}

/** 任务创建：标题必填；清单省略时落到收件箱，与界面「行内添加」一致。 */
export function parseTaskCreate(payload: Record<string, unknown>): TaskCreateInput {
  const dueDate = optionalInteger(payload, 'dueDate');
  return {
    title: requiredText(payload, 'title', 200),
    projectId: optionalText(payload, 'projectId'),
    parentId: optionalText(payload, 'parentId'),
    dueDate: dueDate !== null && dueDate < 0 ? null : dueDate,
    priority: optionalInteger(payload, 'priority'),
  };
}
