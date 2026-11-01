/**
 * 历史账本的自动化读写仓储。
 *
 * 只操作既有生产表 `focus_sessions` / `focus_segments` / `pause_events`，
 * 不新建第二套账本。所有写函数都是「裸写」：事务边界由调用方（AutomationStore）
 * 统一开启，保证账本、版本、幂等回执、审计与提交事件同时落盘。
 */
import type Database from 'better-sqlite3';

import type { FocusSegment, FocusSession, PauseEvent, SessionStatus } from '@shared/types';
import { mapPauseRow, mapSegmentRow, mapSessionRow } from '../db/rows.js';
import type { PauseRow, SegmentRow, SessionRow } from '../db/rows.js';
import type { TimelineLedger } from '@shared/automation/timeline';

export function readSession(database: Database.Database, sessionId: string): FocusSession | null {
  const row = database.prepare('SELECT * FROM focus_sessions WHERE id = ?').get(sessionId) as
    SessionRow | undefined;
  return row ? mapSessionRow(row) : null;
}

export function readSegments(database: Database.Database, sessionId: string): FocusSegment[] {
  const rows = database
    .prepare('SELECT * FROM focus_segments WHERE session_id = ? ORDER BY started_at ASC')
    .all(sessionId) as SegmentRow[];
  return rows.map(mapSegmentRow);
}

export function readPauses(database: Database.Database, sessionId: string): PauseEvent[] {
  const rows = database
    .prepare('SELECT * FROM pause_events WHERE session_id = ? ORDER BY pause_started_at ASC')
    .all(sessionId) as PauseRow[];
  return rows.map(mapPauseRow);
}

/** 与界面统计同口径：区间相交而不是只看 started_at 落点。 */
export function listSessionsInRange(
  database: Database.Database,
  start: number,
  end: number,
): FocusSession[] {
  const rows = database
    .prepare(
      `SELECT * FROM focus_sessions
       WHERE started_at <= ?
         AND COALESCE(ended_at, started_at + wall_elapsed_ms) >= ?
       ORDER BY started_at ASC`,
    )
    .all(end, start) as SessionRow[];
  return rows.map(mapSessionRow);
}

export function listSessionSpans(
  database: Database.Database,
  start: number,
  end: number,
): Array<{ id: string; startedAt: number; endedAt: number; status: SessionStatus }> {
  const rows = database
    .prepare(
      `SELECT id, started_at, COALESCE(ended_at, started_at + wall_elapsed_ms) AS ended,
              status
       FROM focus_sessions
       WHERE started_at <= ?
         AND COALESCE(ended_at, started_at + wall_elapsed_ms) >= ?
       ORDER BY started_at ASC`,
    )
    .all(end, start) as Array<{
    id: string;
    started_at: number;
    ended: number;
    status: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended,
    status: row.status as SessionStatus,
  }));
}

export interface RecordRowInput {
  session: FocusSession;
  segments: readonly FocusSegment[];
  pauses: readonly PauseEvent[];
}

const INSERT_SESSION_SQL = `INSERT INTO focus_sessions
  (id, title, status, started_at, ended_at, active_elapsed_ms, pause_elapsed_ms,
   wall_elapsed_ms, default_task_id, default_task_source, default_task_title, note,
   tomatodo_subject, tomatodo_record_name, created_at, updated_at)
 VALUES (@id, @title, @status, @startedAt, @endedAt, @activeElapsedMs, @pauseElapsedMs,
   @wallElapsedMs, @defaultTaskId, @defaultTaskSource, @defaultTaskTitle, @note,
   @tomatodoSubject, @tomatodoRecordName, @createdAt, @updatedAt)`;

const INSERT_SEGMENT_SQL = `INSERT INTO focus_segments
  (id, session_id, task_id, task_source, title, started_at, ended_at,
   active_elapsed_ms, note, cloud_focus_id, tomatodo_subject, tomatodo_record_name,
   created_at, updated_at)
 VALUES (@id, @sessionId, @taskId, @taskSource, @title, @startedAt, @endedAt,
   @activeElapsedMs, @note, @cloudFocusId, @tomatodoSubject, @tomatodoRecordName,
   @createdAt, @updatedAt)`;

const INSERT_PAUSE_SQL = `INSERT INTO pause_events
  (id, session_id, segment_id, pause_started_at, pause_ended_at, duration_ms,
   reason, created_at, updated_at)
 VALUES (@id, @sessionId, @segmentId, @pauseStartedAt, @pauseEndedAt, @durationMs,
   @reason, @createdAt, @updatedAt)`;

function segmentParams(segment: FocusSegment): Record<string, unknown> {
  return {
    ...segment,
    cloudFocusId: segment.cloudFocusId ?? null,
    tomatodoSubject: segment.tomatodoSubject ?? null,
    tomatodoRecordName: segment.tomatodoRecordName ?? null,
  };
}

/** 裸插入一条完整历史记录；调用方持有事务。 */
export function insertRecordRows(database: Database.Database, input: RecordRowInput): void {
  database.prepare(INSERT_SESSION_SQL).run({
    ...input.session,
    tomatodoSubject: input.session.tomatodoSubject ?? null,
    tomatodoRecordName: input.session.tomatodoRecordName ?? null,
  });
  const insertSegment = database.prepare(INSERT_SEGMENT_SQL);
  for (const segment of input.segments) insertSegment.run(segmentParams(segment));
  const insertPause = database.prepare(INSERT_PAUSE_SQL);
  for (const pause of input.pauses) insertPause.run(pause);
}

/**
 * 用新时间线整体替换已结束会话的片段与暂停。
 * 原行被删除前不落任何外部副作用；修正链由 AutomationStore 的审计表承担。
 */
export function replaceTimelineRows(
  database: Database.Database,
  sessionId: string,
  ledger: TimelineLedger,
  segments: readonly FocusSegment[],
  pauses: readonly PauseEvent[],
  updatedAt: number,
): void {
  database.prepare('DELETE FROM pause_events WHERE session_id = ?').run(sessionId);
  database.prepare('DELETE FROM focus_segments WHERE session_id = ?').run(sessionId);
  database
    .prepare(
      `UPDATE focus_sessions SET
         started_at = ?, ended_at = ?, active_elapsed_ms = ?, pause_elapsed_ms = ?,
         wall_elapsed_ms = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      ledger.startedAt,
      ledger.endedAt,
      ledger.activeElapsedMs,
      ledger.pauseElapsedMs,
      ledger.wallElapsedMs,
      updatedAt,
      sessionId,
    );
  const insertSegment = database.prepare(INSERT_SEGMENT_SQL);
  for (const segment of segments) insertSegment.run(segmentParams(segment));
  const insertPause = database.prepare(INSERT_PAUSE_SQL);
  for (const pause of pauses) insertPause.run(pause);
}

export interface SessionMetadataPatch {
  title?: string | null;
  note?: string | null;
  defaultTaskId?: string | null;
  defaultTaskSource?: string | null;
  defaultTaskTitle?: string | null;
  tomatodoSubject?: string | null;
  tomatodoRecordName?: string | null;
}

export function updateSessionMetadataRows(
  database: Database.Database,
  sessionId: string,
  patch: SessionMetadataPatch,
  updatedAt: number,
): void {
  const assignments: string[] = [];
  const params: Record<string, unknown> = { id: sessionId, updatedAt };
  const map: Array<[keyof SessionMetadataPatch, string]> = [
    ['title', 'title'],
    ['note', 'note'],
    ['defaultTaskId', 'default_task_id'],
    ['defaultTaskSource', 'default_task_source'],
    ['defaultTaskTitle', 'default_task_title'],
    ['tomatodoSubject', 'tomatodo_subject'],
    ['tomatodoRecordName', 'tomatodo_record_name'],
  ];
  for (const [key, column] of map) {
    if (!(key in patch)) continue;
    assignments.push(`${column} = @${key}`);
    params[key] = patch[key] ?? null;
  }
  assignments.push('updated_at = @updatedAt');
  database
    .prepare(`UPDATE focus_sessions SET ${assignments.join(', ')} WHERE id = @id`)
    .run(params);
}

export function setSessionStatusRows(
  database: Database.Database,
  sessionId: string,
  status: SessionStatus,
  updatedAt: number,
): void {
  database
    .prepare('UPDATE focus_sessions SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, updatedAt, sessionId);
}

/** 会话是否仍处于进行中（含实时会话落库前的 active 行）。 */
export function isSessionActive(session: FocusSession): boolean {
  return session.status === 'active' || session.endedAt === null;
}
