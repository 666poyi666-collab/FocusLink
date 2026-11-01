/**
 * 自动化服务测试库：真实 SQLite 内存库 + 生产 schema + 生产幂等迁移。
 *
 * 不用 mock 数据库：版本推进、事务回滚、幂等回执和提交事件都依赖真实 SQL 语义，
 * mock 出来的「事务」会让并发与回滚断言失去意义。
 */
import Database from 'better-sqlite3';

import { SCHEMA_SQL } from '../../electron/db/schema';

export function createAutomationTestDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(SCHEMA_SQL);
  const addColumn = (table: string, column: string, type: string) => {
    const rows = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) return;
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  addColumn('focus_sessions', 'default_task_title', 'TEXT');
  addColumn('focus_sessions', 'tomatodo_subject', 'TEXT');
  addColumn('focus_sessions', 'tomatodo_record_name', 'TEXT');
  addColumn('focus_segments', 'cloud_focus_id', 'TEXT');
  addColumn('focus_segments', 'tomatodo_subject', 'TEXT');
  addColumn('focus_segments', 'tomatodo_record_name', 'TEXT');
  return database;
}

export interface SeedSessionInput {
  id: string;
  startedAt: number;
  endedAt: number;
  status?: 'finished' | 'aborted' | 'active';
  title?: string | null;
}

/** 直接写一条已结束会话，用于重叠/修正类断言。 */
export function seedSession(database: Database.Database, input: SeedSessionInput): void {
  const wall = Math.max(0, input.endedAt - input.startedAt);
  database
    .prepare(
      `INSERT INTO focus_sessions
        (id, title, status, started_at, ended_at, active_elapsed_ms, pause_elapsed_ms,
         wall_elapsed_ms, default_task_id, default_task_source, default_task_title, note,
         tomatodo_subject, tomatodo_record_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      input.id,
      input.title ?? null,
      input.status ?? 'finished',
      input.startedAt,
      input.endedAt,
      wall,
      wall,
      input.startedAt,
      input.startedAt,
    );
  database
    .prepare(
      `INSERT INTO focus_segments
        (id, session_id, task_id, task_source, title, started_at, ended_at,
         active_elapsed_ms, note, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      `${input.id}-s0`,
      input.id,
      input.startedAt,
      input.endedAt,
      wall,
      input.startedAt,
      input.startedAt,
    );
}
