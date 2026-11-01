/**
 * 自动化持久化：操作账本、实体版本、提交事件、番茄计划、修正审计。
 *
 * 全部表都是本功能的元数据表，不是第二份专注账本；账本本身仍在
 * `focus_sessions` / `focus_segments` / `pause_events`。
 *
 * 事务边界由本类统一提供：一次写命令的账本变更、版本推进、幂等回执、
 * 审计与提交事件必须在同一个 `transaction()` 内落盘，事务里不调用网络，
 * 也不碰番茄桥。
 */
import type Database from 'better-sqlite3';

import {
  AUTOMATION_CHANGE_RETENTION,
  AUTOMATION_OPERATION_RESULT_RETENTION_MS,
  type AutomationCommandType,
  type AutomationResultStatus,
} from '@shared/automation/contract';

export interface OperationRecord {
  operationId: string;
  scope: string;
  commandType: AutomationCommandType;
  sourceClient: string;
  targetId: string | null;
  requestHash: string;
  status: AutomationResultStatus;
  resultJson: string | null;
  errorCode: string | null;
  reservedSessionId: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface ChangeRow {
  changeSeq: number;
  domain: string;
  entityType: string;
  entityId: string;
  entityVersion: number;
  createdAt: number;
}

export interface TomatodoPlanRow {
  planId: string;
  scope: string;
  sessionId: string;
  recordVersion: number;
  payloadDigest: string;
  payloadJson: string;
  createdAt: number;
  expiresAt: number;
}

export interface CorrectionRow {
  correctionId: string;
  scope: string;
  sessionId: string;
  baseVersion: number;
  newVersion: number;
  reason: string;
  beforeDigest: string;
  afterDigest: string;
  createdBy: string;
  createdAt: number;
}

interface OperationRow {
  operation_id: string;
  scope: string;
  command_type: string;
  source_client: string;
  target_id: string | null;
  request_hash: string;
  status: string;
  result_json: string | null;
  error_code: string | null;
  reserved_session_id: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface ChangeLogRow {
  change_seq: number;
  domain: string;
  entity_type: string;
  entity_id: string;
  entity_version: number;
  created_at: number;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS automation_operations (
  operation_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  command_type TEXT NOT NULL,
  source_client TEXT NOT NULL,
  target_id TEXT,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT,
  reserved_session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_automation_operations_created
  ON automation_operations(created_at);

CREATE TABLE IF NOT EXISTS automation_entity_versions (
  scope TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS automation_change_log (
  change_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  domain TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automation_change_scope
  ON automation_change_log(scope, change_seq);

CREATE TABLE IF NOT EXISTS automation_tomatodo_plans (
  plan_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  session_id TEXT NOT NULL,
  record_version INTEGER NOT NULL,
  payload_digest TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automation_plans_expiry
  ON automation_tomatodo_plans(expires_at);

CREATE TABLE IF NOT EXISTS automation_corrections (
  correction_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  session_id TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  new_version INTEGER NOT NULL,
  reason TEXT NOT NULL,
  before_digest TEXT NOT NULL,
  after_digest TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automation_corrections_session
  ON automation_corrections(session_id, created_at);
`;

function toOperation(row: OperationRow): OperationRecord {
  return {
    operationId: row.operation_id,
    scope: row.scope,
    commandType: row.command_type as AutomationCommandType,
    sourceClient: row.source_client,
    targetId: row.target_id,
    requestHash: row.request_hash,
    status: row.status as AutomationResultStatus,
    resultJson: row.result_json,
    errorCode: row.error_code,
    reservedSessionId: row.reserved_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function toChange(row: ChangeLogRow): ChangeRow {
  return {
    changeSeq: row.change_seq,
    domain: row.domain,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityVersion: row.entity_version,
    createdAt: row.created_at,
  };
}

export class AutomationStore {
  constructor(private readonly database: Database.Database) {}

  ensureSchema(): void {
    this.database.exec(SCHEMA_SQL);
  }

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  // ---- 元数据 -------------------------------------------------------------

  readMeta(key: string): string | null {
    const row = this.database.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  writeMeta(key: string, value: string): void {
    this.database
      .prepare(
        `INSERT INTO app_meta(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  // ---- 操作账本 -----------------------------------------------------------

  readOperation(operationId: string): OperationRecord | null {
    const row = this.database
      .prepare('SELECT * FROM automation_operations WHERE operation_id = ?')
      .get(operationId) as OperationRow | undefined;
    return row ? toOperation(row) : null;
  }

  /** 插入预留行；已存在返回 false，由调用方判断是否为同文重放。 */
  reserveOperation(input: {
    operationId: string;
    scope: string;
    commandType: AutomationCommandType;
    sourceClient: string;
    requestHash: string;
    reservedSessionId: string | null;
    now: number;
  }): boolean {
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO automation_operations
          (operation_id, scope, command_type, source_client, target_id, request_hash,
           status, result_json, error_code, reserved_session_id, created_at, updated_at,
           completed_at)
         VALUES (?, ?, ?, ?, NULL, ?, 'accepted', NULL, NULL, ?, ?, ?, NULL)`,
      )
      .run(
        input.operationId,
        input.scope,
        input.commandType,
        input.sourceClient,
        input.requestHash,
        input.reservedSessionId,
        input.now,
        input.now,
      );
    return result.changes === 1;
  }

  completeOperation(input: {
    operationId: string;
    status: AutomationResultStatus;
    targetId: string | null;
    resultJson: string;
    errorCode: string | null;
    now: number;
  }): void {
    this.database
      .prepare(
        `UPDATE automation_operations SET
           status = ?, target_id = COALESCE(?, target_id), result_json = ?,
           error_code = ?, updated_at = ?, completed_at = ?
         WHERE operation_id = ?`,
      )
      .run(
        input.status,
        input.targetId,
        input.resultJson,
        input.errorCode,
        input.now,
        input.now,
        input.operationId,
      );
  }

  /**
   * 保留期过后只清空结果正文，保留 compressed tombstone：
   * 旧 operationId 仍然不能再执行一次，但也不会永久占用正文空间。
   */
  purgeExpiredResults(now: number): number {
    const result = this.database
      .prepare(
        `UPDATE automation_operations SET result_json = NULL
         WHERE result_json IS NOT NULL AND created_at < ?`,
      )
      .run(now - AUTOMATION_OPERATION_RESULT_RETENTION_MS);
    return result.changes;
  }

  // ---- 版本 ---------------------------------------------------------------

  readVersion(scope: string, entityType: string, entityId: string): number {
    const row = this.database
      .prepare(
        `SELECT version FROM automation_entity_versions
         WHERE scope = ? AND entity_type = ? AND entity_id = ?`,
      )
      .get(scope, entityType, entityId) as { version: number } | undefined;
    return Number(row?.version ?? 0);
  }

  /** 推进版本并返回新值。只在业务变更时调用，每秒累计显示不推进。 */
  bumpVersion(scope: string, entityType: string, entityId: string, now: number): number {
    const next = this.database
      .prepare(
        `INSERT INTO automation_entity_versions(scope, entity_type, entity_id, version, updated_at)
           VALUES (?, ?, ?, 1, ?)
           ON CONFLICT(scope, entity_type, entity_id)
           DO UPDATE SET version = version + 1, updated_at = excluded.updated_at
           RETURNING version`,
      )
      .get(scope, entityType, entityId, now) as { version: number } | undefined;
    return Number(next?.version ?? 1);
  }

  // ---- 提交事件 -----------------------------------------------------------

  appendChange(input: {
    scope: string;
    domain: string;
    entityType: string;
    entityId: string;
    entityVersion: number;
    now: number;
  }): number {
    const result = this.database
      .prepare(
        `INSERT INTO automation_change_log
          (scope, domain, entity_type, entity_id, entity_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.scope,
        input.domain,
        input.entityType,
        input.entityId,
        input.entityVersion,
        input.now,
      );
    return Number(result.lastInsertRowid);
  }

  latestChangeSeq(scope: string): number {
    const row = this.database
      .prepare('SELECT MAX(change_seq) AS seq FROM automation_change_log WHERE scope = ?')
      .get(scope) as { seq: number | null } | undefined;
    return Number(row?.seq ?? 0);
  }

  minChangeSeq(scope: string): number {
    const row = this.database
      .prepare('SELECT MIN(change_seq) AS seq FROM automation_change_log WHERE scope = ?')
      .get(scope) as { seq: number | null } | undefined;
    return Number(row?.seq ?? 0);
  }

  listChangesAfter(scope: string, cursor: number, limit: number): ChangeRow[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM automation_change_log
         WHERE scope = ? AND change_seq > ?
         ORDER BY change_seq ASC LIMIT ?`,
      )
      .all(scope, cursor, limit) as ChangeLogRow[];
    return rows.map(toChange);
  }

  pruneChanges(scope: string, keep: number): number {
    const latest = this.latestChangeSeq(scope);
    if (latest <= keep) return 0;
    const result = this.database
      .prepare('DELETE FROM automation_change_log WHERE scope = ? AND change_seq <= ?')
      .run(scope, latest - keep);
    return result.changes;
  }

  changeRetention(): number {
    return AUTOMATION_CHANGE_RETENTION;
  }

  // ---- 番茄计划 -----------------------------------------------------------

  putPlan(plan: TomatodoPlanRow): void {
    this.database
      .prepare(
        `INSERT INTO automation_tomatodo_plans
          (plan_id, scope, session_id, record_version, payload_digest, payload_json,
           created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(plan_id) DO UPDATE SET
           scope = excluded.scope, session_id = excluded.session_id,
           record_version = excluded.record_version, payload_digest = excluded.payload_digest,
           payload_json = excluded.payload_json, created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      )
      .run(
        plan.planId,
        plan.scope,
        plan.sessionId,
        plan.recordVersion,
        plan.payloadDigest,
        plan.payloadJson,
        plan.createdAt,
        plan.expiresAt,
      );
  }

  readPlan(planId: string): TomatodoPlanRow | null {
    const row = this.database
      .prepare('SELECT * FROM automation_tomatodo_plans WHERE plan_id = ?')
      .get(planId) as
      | {
          plan_id: string;
          scope: string;
          session_id: string;
          record_version: number;
          payload_digest: string;
          payload_json: string;
          created_at: number;
          expires_at: number;
        }
      | undefined;
    if (!row) return null;
    return {
      planId: row.plan_id,
      scope: row.scope,
      sessionId: row.session_id,
      recordVersion: row.record_version,
      payloadDigest: row.payload_digest,
      payloadJson: row.payload_json,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  deletePlan(planId: string): void {
    this.database.prepare('DELETE FROM automation_tomatodo_plans WHERE plan_id = ?').run(planId);
  }

  deleteExpiredPlans(now: number): number {
    return this.database
      .prepare('DELETE FROM automation_tomatodo_plans WHERE expires_at < ?')
      .run(now).changes;
  }

  // ---- 修正审计 -----------------------------------------------------------

  appendCorrection(correction: CorrectionRow): void {
    this.database
      .prepare(
        `INSERT INTO automation_corrections
          (correction_id, scope, session_id, base_version, new_version, reason,
           before_digest, after_digest, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        correction.correctionId,
        correction.scope,
        correction.sessionId,
        correction.baseVersion,
        correction.newVersion,
        correction.reason,
        correction.beforeDigest,
        correction.afterDigest,
        correction.createdBy,
        correction.createdAt,
      );
  }

  listCorrections(sessionId: string): CorrectionRow[] {
    const rows = this.database
      .prepare(`SELECT * FROM automation_corrections WHERE session_id = ? ORDER BY created_at ASC`)
      .all(sessionId) as Array<{
      correction_id: string;
      scope: string;
      session_id: string;
      base_version: number;
      new_version: number;
      reason: string;
      before_digest: string;
      after_digest: string;
      created_by: string;
      created_at: number;
    }>;
    return rows.map((row) => ({
      correctionId: row.correction_id,
      scope: row.scope,
      sessionId: row.session_id,
      baseVersion: row.base_version,
      newVersion: row.new_version,
      reason: row.reason,
      beforeDigest: row.before_digest,
      afterDigest: row.after_digest,
      createdBy: row.created_by,
      createdAt: row.created_at,
    }));
  }
}
