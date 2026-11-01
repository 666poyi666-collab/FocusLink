/**
 * SQLite 行到领域对象的纯映射。
 *
 * 单独成文件的原因：`electron/db/index.ts` 在模块顶层 import electron，无法在
 * 纯 Node 测试里加载；自动化层的记录仓储需要同一套映射，不能各写一份
 * （否则同一行在界面和接口里会读出两个值）。
 */
import type {
  FocusSegment,
  FocusSession,
  PauseEvent,
  SessionStatus,
  TaskSource,
  TomatodoSubject,
} from '@shared/types';

export interface SessionRow {
  id: string;
  title: string | null;
  status: string;
  started_at: number;
  ended_at: number | null;
  active_elapsed_ms: number;
  pause_elapsed_ms: number;
  wall_elapsed_ms: number;
  default_task_id: string | null;
  default_task_source: string | null;
  default_task_title: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
  tomatodo_subject: string | null;
  tomatodo_record_name: string | null;
}

export interface SegmentRow {
  id: string;
  session_id: string;
  task_id: string | null;
  task_source: string | null;
  title: string | null;
  started_at: number;
  ended_at: number | null;
  active_elapsed_ms: number;
  note: string | null;
  cloud_focus_id: string | null;
  tomatodo_subject: string | null;
  tomatodo_record_name: string | null;
  created_at: number;
  updated_at: number;
}

export interface PauseRow {
  id: string;
  session_id: string;
  segment_id: string | null;
  pause_started_at: number;
  pause_ended_at: number | null;
  duration_ms: number;
  reason: string | null;
  created_at: number;
  updated_at: number;
}

export function mapSessionRow(row: SessionRow): FocusSession {
  return {
    id: row.id,
    title: row.title,
    status: row.status as SessionStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    activeElapsedMs: row.active_elapsed_ms,
    pauseElapsedMs: row.pause_elapsed_ms,
    wallElapsedMs: row.wall_elapsed_ms,
    defaultTaskId: row.default_task_id,
    defaultTaskSource: (row.default_task_source as TaskSource | null) ?? null,
    defaultTaskTitle: row.default_task_title ?? null,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tomatodoSubject: (row.tomatodo_subject as TomatodoSubject | null) ?? null,
    tomatodoRecordName: row.tomatodo_record_name ?? null,
  };
}

export function mapSegmentRow(row: SegmentRow): FocusSegment {
  return {
    id: row.id,
    sessionId: row.session_id,
    taskId: row.task_id,
    taskSource: (row.task_source as TaskSource | null) ?? null,
    title: row.title,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    activeElapsedMs: row.active_elapsed_ms,
    note: row.note,
    cloudFocusId: row.cloud_focus_id,
    tomatodoSubject: (row.tomatodo_subject as TomatodoSubject | null) ?? null,
    tomatodoRecordName: row.tomatodo_record_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPauseRow(row: PauseRow): PauseEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    segmentId: row.segment_id,
    pauseStartedAt: row.pause_started_at,
    pauseEndedAt: row.pause_ended_at,
    durationMs: row.duration_ms,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
