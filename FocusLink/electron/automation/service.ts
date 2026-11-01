/**
 * 本地自动化业务服务。
 *
 * 调用链唯一：界面 / 快捷键 / HTTP / CLI → 本服务 → 计时控制器 / SQLite / 既有同步队列。
 * 本服务不复制计时状态机、不复制账本、不复制番茄桥；它只做四件事：
 * 1. 在共享调度内重核预期版本，拒绝旧请求覆盖新操作；
 * 2. 把账本变更、版本推进、幂等回执、审计与提交事件放进同一个 SQLite 事务；
 * 3. 读取时走白名单投影，与界面使用同一份数据；
 * 4. 第三方投递只报告分阶段真实结果，不把上传成功说成手机可见。
 */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

import {
  AUTOMATION_PLAN_TTL_MS,
  AUTOMATION_PROTOCOL_VERSION,
  AUTOMATION_DEFAULT_LIMIT,
  AUTOMATION_MAX_LIMIT,
  buildCapabilitiesView,
  buildAutomationSchema,
  isRetryableErrorCode,
  scopeAllows,
  type AutomationCapabilitiesView,
  type AutomationCommand,
  type AutomationCommandEnvelope,
  type AutomationCommandResult,
  type AutomationCommandType,
  type AutomationErrorCode,
  type AutomationErrorPayload,
  type AutomationDoctorView,
  type AutomationRecordCreateInput,
  type AutomationRecordListPage,
  type AutomationRecordPatch,
  type AutomationScope,
  type AutomationSchemaView,
  type AutomationSessionView,
  type AutomationStateView,
  type AutomationSummaryBucket,
  type AutomationSummaryView,
  type AutomationTaskView,
  type AutomationTimerState,
  type AutomationTomatodoPreview,
  type AutomationTomatodoSyncResult,
} from '@shared/automation/contract';
import {
  buildTimelineLedger,
  canonicalTomatodoPlanPayload,
  formatControlVersion,
  spansOverlap,
  tomatodoProjectedEndAt,
  type TimelineLedger,
} from '@shared/automation/timeline';
import {
  TOMATODO_CLOUD_UPLOAD_WINDOW_MS,
  isTomatodoSubject,
  normalizeTomatodoRecordName,
  tomatodoRecordMinutes,
} from '@shared/tomatodoPolicy';
import type {
  FocusSegment,
  FocusSession,
  PauseEvent,
  TimerSnapshot,
  TomatodoSubject,
} from '@shared/types';

import { projectLiveSession } from '../sessions/liveSessionProjection.js';
import {
  insertRecordRows,
  isSessionActive,
  listSessionSpans,
  listSessionsInRange,
  readPauses,
  readSegments,
  readSession,
  replaceTimelineRows,
  setSessionStatusRows,
  updateSessionMetadataRows,
} from './recordRepository.js';
import { AutomationStore, type CorrectionRow, type OperationRecord } from './store.js';
import { TOMATODO_DOMAIN, runExclusive, sessionDomain } from './scheduler.js';

export interface AutomationTimer {
  getSnapshot(): TimerSnapshot;
  onSnapshot(listener: (snapshot: TimerSnapshot) => void): () => void;
  toggle(): Promise<TimerSnapshot>;
  pause(): Promise<TimerSnapshot>;
  resume(): Promise<TimerSnapshot>;
  stop(): Promise<TimerSnapshot>;
  /** 可选：实时模式下真正的中止出口；缺省时中止退化为 stop + 账本标记 aborted。 */
  abort?(): Promise<TimerSnapshot>;
  startWithTask(
    taskId: string,
    taskSource: 'local' | 'ticktick',
    taskTitle?: string,
  ): Promise<TimerSnapshot>;
}

export interface AutomationTomatodoStatus {
  enabled: boolean;
  autoSyncEnabled: boolean;
  minutes: number;
  subject: string;
  recordName: string;
  writtenLocally: boolean;
  cloudSynced: boolean;
  state: string;
}

export interface AutomationTomatodoSyncOutcome {
  ok: boolean;
  synced: number;
  skipped: number;
  failed: number;
  phoneSynced: boolean;
  cloudSynced: boolean;
  error?: string;
}

export interface AutomationTomatodoPort {
  status(sessionId: string): AutomationTomatodoStatus;
  sync(sessionId: string): Promise<AutomationTomatodoSyncOutcome>;
}

export interface AutomationServiceOptions {
  database: Database.Database;
  timer: AutomationTimer;
  tomatodo: AutomationTomatodoPort;
  now?: () => number;
  /** 连接 scope：切换账号后版本与回执分区，旧账号结果不得进入新账号。 */
  scope?: () => string;
  /** 连接代际：进入 controlVersion，旧代际的控制命令必然冲突。 */
  generation?: () => number;
  appVersion?: () => string;
  /** 可选：跨设备同步的会话状态，缺省时如实返回 unknown。 */
  focuslinkCloudState?: (sessionId: string) => 'unknown' | 'queued' | 'confirmed' | 'absent';
}

const CONTROL_REVISION_KEY = 'automation.controlRevision';
const SESSION_ENTITY = 'session';
const MAX_EVENT_WAIT_MS = 20_000;

interface AutomationCommandFailure {
  code: AutomationErrorCode;
  message: string;
  current?: AutomationErrorPayload['current'];
}

export class CommandFailure extends Error {
  constructor(readonly failure: AutomationCommandFailure) {
    super(failure.message);
    this.name = 'CommandFailure';
  }
}

export function commandFailure(
  code: AutomationErrorCode,
  message: string,
  current?: AutomationErrorPayload['current'],
): CommandFailure {
  return new CommandFailure({ code, message, current });
}

/** 学科只能是既有受控取值；未识别的字符串一律显式拒绝，不静默落库。 */
function toTomatodoSubject(value: string | null | undefined): TomatodoSubject | null {
  if (value === null || value === undefined) return null;
  if (!isTomatodoSubject(value)) {
    throw commandFailure('INVALID_ARGUMENT', 'tomatodoSubject is not a supported subject');
  }
  return value;
}

function toRecordName(value: string | null | undefined): string | null {
  return normalizeTomatodoRecordName(value) ?? null;
}

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function toTaskView(
  taskId: string | null,
  taskSource: string | null,
  taskTitle: string | null,
): AutomationTaskView | null {
  if (!taskId || !taskSource) return null;
  if (taskSource !== 'local' && taskSource !== 'ticktick') return null;
  return { taskId, taskSource, taskTitle: taskTitle ?? taskId };
}

export class AutomationService {
  private readonly store: AutomationStore;
  private readonly now: () => number;
  private readonly scope: () => string;
  private readonly generation: () => number;
  private readonly appVersion: () => string;
  private controlRevision = 0;
  private materialKey: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private eventWaiters = new Set<() => void>();
  private started = false;

  constructor(private readonly options: AutomationServiceOptions) {
    this.store = new AutomationStore(options.database);
    this.now = options.now ?? (() => Date.now());
    this.scope = options.scope ?? (() => 'local');
    this.generation = options.generation ?? (() => 0);
    this.appVersion = options.appVersion ?? (() => '0.0.0');
  }

  start(): void {
    if (this.started) return;
    this.store.ensureSchema();
    const stored = this.store.readMeta(CONTROL_REVISION_KEY);
    this.controlRevision = Number(stored ?? 0) || 0;
    const snapshot = this.options.timer.getSnapshot();
    this.materialKey = `${snapshot.state}:${snapshot.sessionId ?? ''}`;
    this.unsubscribe = this.options.timer.onSnapshot((next) => this.observe(next));
    this.started = true;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.started = false;
    this.wakeAll();
  }

  // ---- 提交事件 -----------------------------------------------------------

  private observe(snapshot: TimerSnapshot): void {
    const key = `${snapshot.state}:${snapshot.sessionId ?? ''}`;
    if (this.materialKey === null) {
      this.materialKey = key;
      return;
    }
    if (key === this.materialKey) return;
    this.materialKey = key;
    this.controlRevision += 1;
    this.store.writeMeta(CONTROL_REVISION_KEY, String(this.controlRevision));
  }

  private appendChange(
    domain: string,
    entityType: string,
    entityId: string,
    version: number,
  ): number {
    const seq = this.store.appendChange({
      scope: this.scope(),
      domain,
      entityType,
      entityId,
      entityVersion: version,
      now: this.now(),
    });
    this.store.pruneChanges(this.scope(), this.store.changeRetention());
    this.wakeAll();
    return seq;
  }

  private wakeAll(): void {
    for (const wake of [...this.eventWaiters]) wake();
    this.eventWaiters.clear();
  }

  private waitForChange(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.eventWaiters.delete(wake);
        resolve();
      }, timeoutMs);
      const wake = () => {
        clearTimeout(timer);
        resolve();
      };
      this.eventWaiters.add(wake);
    });
  }

  listEvents(
    cursor: number | null,
    limit: number,
  ): {
    protocolVersion: number;
    changeSeq: number;
    items: Array<{
      changeSeq: number;
      domain: string;
      entityType: string;
      entityId: string;
      entityVersion: number;
      observedAt: number;
    }>;
    resyncRequired: boolean;
  } {
    const scope = this.scope();
    const latest = this.store.latestChangeSeq(scope);
    if (cursor === null) {
      return {
        protocolVersion: AUTOMATION_PROTOCOL_VERSION,
        changeSeq: latest,
        items: [],
        resyncRequired: false,
      };
    }
    const min = this.store.minChangeSeq(scope);
    if (min > 0 && cursor < min - 1) {
      return {
        protocolVersion: AUTOMATION_PROTOCOL_VERSION,
        changeSeq: latest,
        items: [],
        resyncRequired: true,
      };
    }
    const rows = this.store.listChangesAfter(scope, cursor, limit);
    return {
      protocolVersion: AUTOMATION_PROTOCOL_VERSION,
      changeSeq: latest,
      items: rows.map((row) => ({
        changeSeq: row.changeSeq,
        domain: row.domain,
        entityType: row.entityType,
        entityId: row.entityId,
        entityVersion: row.entityVersion,
        observedAt: row.createdAt,
      })),
      resyncRequired: false,
    };
  }

  async waitForEvents(cursor: number, limit: number, timeoutMs = MAX_EVENT_WAIT_MS) {
    const immediate = this.listEvents(cursor, limit);
    if (immediate.items.length > 0 || immediate.resyncRequired) return immediate;
    await this.waitForChange(Math.min(timeoutMs, MAX_EVENT_WAIT_MS));
    return this.listEvents(cursor, limit);
  }

  // ---- 读取 ---------------------------------------------------------------

  private toSessionView(
    session: FocusSession,
    segments: readonly FocusSegment[],
    pauses: readonly PauseEvent[],
    source: 'ledger' | 'live',
  ): AutomationSessionView {
    return {
      sessionId: session.id,
      title: session.title,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      activeElapsedMs: session.activeElapsedMs,
      pauseElapsedMs: session.pauseElapsedMs,
      wallElapsedMs: session.wallElapsedMs,
      task: toTaskView(session.defaultTaskId, session.defaultTaskSource, session.defaultTaskTitle),
      tomatodoSubject: session.tomatodoSubject ?? null,
      tomatodoRecordName: session.tomatodoRecordName ?? null,
      recordVersion: this.store.readVersion(this.scope(), SESSION_ENTITY, session.id),
      segments: segments.map((segment) => ({
        segmentId: segment.id,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt ?? segment.startedAt,
        activeElapsedMs: segment.activeElapsedMs,
        title: segment.title,
        task: toTaskView(segment.taskId, segment.taskSource, segment.title),
      })),
      pauses: pauses.map((pause) => ({
        pauseId: pause.id,
        startedAt: pause.pauseStartedAt,
        endedAt: pause.pauseEndedAt ?? pause.pauseStartedAt,
        durationMs: pause.durationMs,
      })),
      source,
    };
  }

  currentControlVersion(): string {
    const snapshot = this.options.timer.getSnapshot();
    return formatControlVersion({
      sessionId: snapshot.sessionId,
      revision: this.controlRevision,
      generation: this.generation(),
    });
  }

  readState(): AutomationStateView {
    const snapshot = this.options.timer.getSnapshot();
    const observedAt = this.now();
    let activeSession: AutomationSessionView | null = null;
    if (snapshot.sessionId) {
      const local = readSession(this.options.database, snapshot.sessionId);
      if (local) {
        activeSession = this.toSessionView(
          local,
          readSegments(this.options.database, local.id),
          readPauses(this.options.database, local.id),
          'ledger',
        );
      } else {
        const projected = projectLiveSession(snapshot, () => false);
        if (projected) {
          activeSession = this.toSessionView(
            projected.session,
            projected.segments,
            projected.pauses,
            'live',
          );
        }
      }
    }
    return {
      protocolVersion: AUTOMATION_PROTOCOL_VERSION,
      observedAt,
      freshness: snapshot.state === 'running' || snapshot.state === 'paused' ? 'live' : 'ledger',
      timer: {
        state: snapshot.state as AutomationTimerState,
        sessionId: snapshot.sessionId,
        controlVersion: this.currentControlVersion(),
        activeElapsedMs: snapshot.activeElapsedMs,
        pauseElapsedMs: snapshot.pauseElapsedMs,
        wallElapsedMs: snapshot.wallElapsedMs,
        currentTask: toTaskView(
          snapshot.currentTaskId,
          snapshot.currentTaskSource,
          snapshot.currentTaskTitle,
        ),
      },
      activeSession,
      changeSeq: this.store.latestChangeSeq(this.scope()),
    };
  }

  readRecord(sessionId: string): AutomationSessionView {
    const session = readSession(this.options.database, sessionId);
    if (!session) {
      const projected = projectLiveSession(this.options.timer.getSnapshot(), () => false);
      if (projected && projected.session.id === sessionId) {
        return this.toSessionView(projected.session, projected.segments, projected.pauses, 'live');
      }
      throw commandFailure('NOT_FOUND', 'Session was not found');
    }
    return this.toSessionView(
      session,
      readSegments(this.options.database, sessionId),
      readPauses(this.options.database, sessionId),
      'ledger',
    );
  }

  readRecords(query: {
    dayStart: number;
    dayEndExclusive: number;
    localDate: string;
    timezone: string;
    limit?: number;
    after?: { startedAt: number; sessionId: string } | null;
  }): AutomationRecordListPage {
    const limit = Math.min(
      Math.max(1, query.limit ?? AUTOMATION_DEFAULT_LIMIT),
      AUTOMATION_MAX_LIMIT,
    );
    const sessions = listSessionsInRange(
      this.options.database,
      query.dayStart,
      Math.max(query.dayStart, query.dayEndExclusive - 1),
    ).sort((left, right) => right.startedAt - left.startedAt);

    let items = sessions;
    if (query.after) {
      const after = query.after;
      items = sessions.filter(
        (session) =>
          session.startedAt < after.startedAt ||
          (session.startedAt === after.startedAt && session.id < after.sessionId),
      );
    }
    const page = items
      .slice(0, limit)
      .map((session) =>
        this.toSessionView(
          session,
          readSegments(this.options.database, session.id),
          readPauses(this.options.database, session.id),
          'ledger',
        ),
      );
    const totalActiveElapsedMs = sessions.reduce((sum, s) => sum + s.activeElapsedMs, 0);
    const totalPauseElapsedMs = sessions.reduce((sum, s) => sum + s.pauseElapsedMs, 0);
    const last = items[limit - 1];
    return {
      protocolVersion: AUTOMATION_PROTOCOL_VERSION,
      timezone: query.timezone,
      date: query.localDate,
      observedAt: this.now(),
      changeSeq: this.store.latestChangeSeq(this.scope()),
      items: page,
      nextCursor: items.length > limit && last ? `${last.startedAt}|${last.id}` : null,
      totalActiveElapsedMs,
      totalPauseElapsedMs,
    };
  }

  readSummary(query: {
    from: string;
    to: string;
    timezone: string;
    rangeStart: number;
    rangeEndExclusive: number;
  }): AutomationSummaryView {
    const sessions = listSessionsInRange(
      this.options.database,
      query.rangeStart,
      Math.max(query.rangeStart, query.rangeEndExclusive - 1),
    );
    const byTask = new Map<string, AutomationSummaryBucket>();
    const byDay = new Map<string, AutomationSummaryBucket>();
    let activeElapsedMs = 0;
    let pauseElapsedMs = 0;
    let wallElapsedMs = 0;

    for (const session of sessions) {
      activeElapsedMs += session.activeElapsedMs;
      pauseElapsedMs += session.pauseElapsedMs;
      wallElapsedMs += session.wallElapsedMs;
      const dayKey = this.localDateOf(session.startedAt, query.timezone);
      const day = byDay.get(dayKey) ?? {
        key: dayKey,
        label: dayKey,
        activeElapsedMs: 0,
        pauseElapsedMs: 0,
        sessionCount: 0,
      };
      day.activeElapsedMs += session.activeElapsedMs;
      day.pauseElapsedMs += session.pauseElapsedMs;
      day.sessionCount += 1;
      byDay.set(dayKey, day);

      for (const segment of readSegments(this.options.database, session.id)) {
        const key = segment.taskId ?? session.defaultTaskId ?? 'unlinked';
        const label =
          segment.title ??
          (segment.taskId ? segment.taskId : (session.defaultTaskTitle ?? '未关联'));
        const bucket = byTask.get(key) ?? {
          key,
          label,
          activeElapsedMs: 0,
          pauseElapsedMs: 0,
          sessionCount: 0,
        };
        bucket.activeElapsedMs += segment.activeElapsedMs;
        byTask.set(key, bucket);
      }
      const unlinked = byTask.get('unlinked');
      if (unlinked && session.pauseElapsedMs > 0) unlinked.pauseElapsedMs += session.pauseElapsedMs;
    }

    const sortBuckets = (map: Map<string, AutomationSummaryBucket>) =>
      [...map.values()].sort((left, right) => right.activeElapsedMs - left.activeElapsedMs);

    return {
      protocolVersion: AUTOMATION_PROTOCOL_VERSION,
      timezone: query.timezone,
      from: query.from,
      to: query.to,
      observedAt: this.now(),
      changeSeq: this.store.latestChangeSeq(this.scope()),
      activeElapsedMs,
      pauseElapsedMs,
      wallElapsedMs,
      sessionCount: sessions.length,
      byTask: sortBuckets(byTask),
      byDay: [...byDay.values()].sort((left, right) => left.key.localeCompare(right.key)),
    };
  }

  private localDateOf(epochMs: number, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(epochMs));
    return parts;
  }

  capabilities(scopes: readonly AutomationScope[]): AutomationCapabilitiesView {
    return buildCapabilitiesView(scopes);
  }

  schema(): AutomationSchemaView {
    return buildAutomationSchema();
  }

  doctor(): AutomationDoctorView {
    const checks: AutomationDoctorView['checks'] = [];
    try {
      this.store.latestChangeSeq(this.scope());
      checks.push({ id: 'ledger', status: 'ok', code: null });
    } catch {
      checks.push({ id: 'ledger', status: 'fail', code: 'INTERNAL_ERROR' });
    }
    try {
      this.options.timer.getSnapshot();
      checks.push({ id: 'timer', status: 'ok', code: null });
    } catch {
      checks.push({ id: 'timer', status: 'fail', code: 'INTERNAL_ERROR' });
    }
    const tomatodo = this.options.tomatodo.status('__doctor__');
    checks.push({
      id: 'tomatodo-bridge',
      status: tomatodo.enabled ? 'ok' : 'warn',
      code: tomatodo.enabled ? null : 'TOMATODO_BRIDGE_UNAVAILABLE',
    });
    return {
      protocolVersion: AUTOMATION_PROTOCOL_VERSION,
      product: 'FocusLink',
      version: this.appVersion(),
      ok: checks.every((check) => check.status !== 'fail'),
      checks,
    };
  }

  getOperation(operationId: string): {
    protocolVersion: number;
    operationId: string;
    status: string;
    errorCode: string | null;
    result: AutomationCommandResult | null;
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
  } {
    const record = this.store.readOperation(operationId);
    if (!record) throw commandFailure('OPERATION_UNKNOWN', 'Operation was not found');
    let result: AutomationCommandResult | null = null;
    if (record.resultJson) {
      try {
        result = JSON.parse(record.resultJson) as AutomationCommandResult;
      } catch {
        result = null;
      }
    }
    return {
      protocolVersion: AUTOMATION_PROTOCOL_VERSION,
      operationId: record.operationId,
      status: record.status,
      errorCode: record.errorCode,
      result,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      completedAt: record.completedAt,
    };
  }

  // ---- 番茄计划 -----------------------------------------------------------

  buildTomatodoPreview(sessionId: string): AutomationTomatodoPreview {
    const session = readSession(this.options.database, sessionId);
    if (!session) throw commandFailure('NOT_FOUND', 'Session was not found');
    if (isSessionActive(session))
      throw commandFailure('RECORD_NOT_FINISHED', 'Active sessions cannot be exported');
    const status = this.options.tomatodo.status(sessionId);
    const minutes = tomatodoRecordMinutes(session.activeElapsedMs);
    const subject = session.tomatodoSubject ?? status.subject;
    const recordName = session.tomatodoRecordName ?? subject;
    const recordVersion = this.store.readVersion(this.scope(), SESSION_ENTITY, sessionId);
    const now = this.now();
    const payload = {
      sessionId,
      recordVersion,
      subject,
      recordName,
      minutes,
      startedAt: session.startedAt,
    };
    const payloadDigest = digest(canonicalTomatodoPlanPayload(payload));
    const planId = `tp-${payloadDigest.slice(0, 40)}`;
    const expiresAt = now + AUTOMATION_PLAN_TTL_MS;
    this.store.putPlan({
      planId,
      scope: this.scope(),
      sessionId,
      recordVersion,
      payloadDigest,
      payloadJson: JSON.stringify(payload),
      createdAt: now,
      expiresAt,
    });
    return {
      protocolVersion: AUTOMATION_PROTOCOL_VERSION,
      planId,
      sessionId,
      recordVersion,
      subject,
      recordName,
      minutes,
      startedAt: session.startedAt,
      projectedEndAt: tomatodoProjectedEndAt(session.startedAt, minutes),
      payloadDigest,
      expiresAt,
      withinCloudWindow: now - session.startedAt <= TOMATODO_CLOUD_UPLOAD_WINDOW_MS,
      alreadyWritten: status.writtenLocally,
      requiresApproval: true,
    };
  }

  // ---- 命令执行 -----------------------------------------------------------

  async execute(
    envelope: AutomationCommandEnvelope,
    grantedScopes: readonly AutomationScope[],
  ): Promise<AutomationCommandResult> {
    const required = this.requiredScope(envelope.command.type);
    if (!scopeAllows(grantedScopes, required)) {
      throw commandFailure('SCOPE_DENIED', `${required} scope is required`);
    }
    const requestHash = digest(
      canonicalJson({ type: envelope.command.type, command: envelope.command }),
    );
    const scope = this.scope();
    // 先清理过期回执正文与过期计划：旧 operationId 只能得到 OPERATION_EXPIRED，
    // 绝不允许在保留期结束后被当成一次新操作重新执行。
    this.store.purgeExpiredResults(this.now());
    this.store.deleteExpiredPlans(this.now());

    const existing = this.store.readOperation(envelope.operationId);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw commandFailure(
          'OPERATION_ID_REUSED',
          'operationId was reused with a different payload',
        );
      }
      if (existing.resultJson) {
        const replayed = JSON.parse(existing.resultJson) as AutomationCommandResult;
        return { ...replayed, status: 'duplicate' };
      }
      if (existing.status !== 'accepted') {
        throw commandFailure(
          'OPERATION_EXPIRED',
          'Operation result has expired; send a new operationId',
        );
      }
    } else {
      const reservedSessionId =
        envelope.command.type === 'records.create'
          ? (envelope.command.input.sessionId ?? `rec-${crypto.randomUUID()}`)
          : null;
      const inserted = this.store.reserveOperation({
        operationId: envelope.operationId,
        scope,
        commandType: envelope.command.type,
        sourceClient: envelope.sourceClient,
        requestHash,
        reservedSessionId,
        now: this.now(),
      });
      if (!inserted) {
        const raced = this.store.readOperation(envelope.operationId);
        if (raced?.resultJson) {
          const replayed = JSON.parse(raced.resultJson) as AutomationCommandResult;
          return { ...replayed, status: 'duplicate' };
        }
      }
    }

    const reservation = this.store.readOperation(envelope.operationId);
    if (!reservation) throw commandFailure('INTERNAL_ERROR', 'Operation reservation failed');
    if (reservation.scope !== scope) {
      throw commandFailure('CONNECTION_CHANGED', 'Connection scope changed before this write');
    }

    try {
      const result = await this.dispatch(envelope, reservation, scope);
      return result;
    } catch (error) {
      if (error instanceof CommandFailure) {
        const payload: AutomationErrorPayload = {
          code: error.failure.code,
          message: error.failure.message,
          retryable: isRetryableErrorCode(error.failure.code),
          current: error.failure.current ?? null,
        };
        const status =
          payload.code === 'VERSION_CONFLICT' ||
          payload.code === 'STATE_CONFLICT' ||
          payload.code === 'OVERLAPPING_RECORD' ||
          payload.code === 'RECORD_NOT_FINISHED' ||
          payload.code === 'PLAN_STALE' ||
          payload.code === 'OPERATION_EXPIRED' ||
          payload.code === 'OPERATION_ID_REUSED' ||
          payload.code === 'CONNECTION_CHANGED'
            ? 'conflict'
            : 'rejected';
        const result: AutomationCommandResult = {
          protocolVersion: AUTOMATION_PROTOCOL_VERSION,
          status,
          operationId: envelope.operationId,
          commandType: envelope.command.type,
          targetId: null,
          recordVersion: null,
          controlVersion: this.currentControlVersion(),
          changeSeq: null,
          data: null,
          error: payload,
        };
        if (payload.retryable) {
          // 可重试错误不写终态：保留 accepted 预留，调用方可用同一 operationId 重放。
          return { ...result, status: 'accepted' };
        }
        this.store.completeOperation({
          operationId: envelope.operationId,
          status,
          targetId: null,
          resultJson: JSON.stringify(result),
          errorCode: payload.code,
          now: this.now(),
        });
        return result;
      }
      const message = error instanceof Error ? error.message : 'Unknown failure';
      const payload: AutomationErrorPayload = {
        code: 'INTERNAL_ERROR',
        message,
        retryable: true,
        current: null,
      };
      return {
        protocolVersion: AUTOMATION_PROTOCOL_VERSION,
        status: 'accepted',
        operationId: envelope.operationId,
        commandType: envelope.command.type,
        targetId: null,
        recordVersion: null,
        controlVersion: this.currentControlVersion(),
        changeSeq: null,
        data: null,
        error: payload,
      };
    }
  }

  private requiredScope(type: AutomationCommandType): AutomationScope {
    if (type.startsWith('focus.')) return 'focus:control';
    if (type.startsWith('records.')) return 'records:write';
    return 'tomatodo:write';
  }

  private async dispatch(
    envelope: AutomationCommandEnvelope,
    reservation: OperationRecord,
    scope: string,
  ): Promise<AutomationCommandResult> {
    switch (envelope.command.type) {
      case 'focus.start':
      case 'focus.pause':
      case 'focus.resume':
      case 'focus.finish':
      case 'focus.abort':
        return this.runControl(envelope, envelope.command, scope);
      case 'records.create':
        return this.runRecordCreate(envelope, envelope.command, reservation, scope);
      case 'records.update':
        return this.runRecordUpdate(envelope, envelope.command, scope);
      case 'tomatodo.sync':
        return this.runTomatodoSync(envelope, envelope.command, scope);
      default:
        throw commandFailure('UNSUPPORTED_COMMAND', 'command.type is not supported');
    }
  }

  private assertNotExpired(expiresAt: number): void {
    if (expiresAt <= this.now()) {
      throw commandFailure('OPERATION_EXPIRED', 'Command has expired');
    }
  }

  private async runControl(
    envelope: AutomationCommandEnvelope,
    command: Extract<AutomationCommand, { type: `focus.${string}` }>,
    scope: string,
  ): Promise<AutomationCommandResult> {
    return runExclusive('timer', async () => {
      this.assertNotExpired(command.expiresAt);
      const before = this.options.timer.getSnapshot();
      const controlVersion = this.currentControlVersion();
      if (controlVersion !== command.expectedControlVersion) {
        throw commandFailure('VERSION_CONFLICT', 'Control version changed', {
          recordVersion: null,
          controlVersion,
          state: before.state,
          sessionId: before.sessionId,
        });
      }
      if (before.state !== command.expectedState) {
        throw commandFailure('STATE_CONFLICT', 'Timer state changed', {
          recordVersion: null,
          controlVersion,
          state: before.state,
          sessionId: before.sessionId,
        });
      }
      let after: TimerSnapshot;
      switch (command.type) {
        case 'focus.start':
          after = command.task
            ? await this.options.timer.startWithTask(
                command.task.taskId,
                command.task.taskSource,
                command.task.taskTitle,
              )
            : await this.options.timer.toggle();
          break;
        case 'focus.pause':
          after = await this.options.timer.pause();
          break;
        case 'focus.resume':
          after = await this.options.timer.resume();
          break;
        case 'focus.abort':
          after = this.options.timer.abort
            ? await this.options.timer.abort()
            : await this.options.timer.stop();
          break;
        default:
          after = await this.options.timer.stop();
          break;
      }
      // 后置条件：控制器自己也有「上一次操作正在确认」的串行闸门，
      // 人工动作可能插在版本校验与执行之间。结果不是本次要求的迁移时如实报冲突，
      // 绝不把没生效的动作写成 applied。
      const expectedOutcomes: Record<string, string[]> = {
        'focus.start': ['running', 'paused'],
        'focus.pause': ['paused'],
        'focus.resume': ['running'],
        'focus.finish': ['finished', 'idle'],
        'focus.abort': ['finished', 'idle'],
      };
      const outcomes = expectedOutcomes[command.type] ?? [];
      const sessionKept = command.type === 'focus.start' || after.sessionId === before.sessionId;
      if (!outcomes.includes(after.state) || !sessionKept) {
        throw commandFailure('STATE_CONFLICT', 'Timer state did not change as requested', {
          recordVersion: null,
          controlVersion: this.currentControlVersion(),
          state: after.state,
          sessionId: after.sessionId,
        });
      }
      const targetId = after.sessionId ?? before.sessionId;
      const observedControl = this.currentControlVersion();
      const now = this.now();
      const outcome = this.store.transaction(() => {
        // 中止是「已结束但被标记为中止」，与结束共用同一状态机出口，
        // 差别只在账本状态；外部队列照样能看到这条已结束记录。
        if (targetId && command.type === 'focus.abort') {
          setSessionStatusRows(this.options.database, targetId, 'aborted', now);
        }
        const recordVersion = targetId
          ? this.store.bumpVersion(scope, SESSION_ENTITY, targetId, now)
          : 0;
        const changeSeq = targetId
          ? this.appendChange('timer', SESSION_ENTITY, targetId, recordVersion)
          : null;
        return { recordVersion, changeSeq };
      });
      const result: AutomationCommandResult = {
        protocolVersion: AUTOMATION_PROTOCOL_VERSION,
        status: 'applied',
        operationId: envelope.operationId,
        commandType: command.type,
        targetId,
        recordVersion: targetId ? outcome.recordVersion : null,
        controlVersion: observedControl,
        changeSeq: outcome.changeSeq,
        data: this.readState(),
        error: null,
      };
      this.store.completeOperation({
        operationId: envelope.operationId,
        status: 'applied',
        targetId,
        resultJson: JSON.stringify(result),
        errorCode: null,
        now,
      });
      return result;
    });
  }

  private collectorFailure(
    code: AutomationErrorCode,
    message: string,
    sessionId?: string,
  ): CommandFailure {
    return commandFailure(code, message, {
      recordVersion: sessionId
        ? this.store.readVersion(this.scope(), SESSION_ENTITY, sessionId)
        : null,
      controlVersion: this.currentControlVersion(),
      state: this.options.timer.getSnapshot().state,
      sessionId: sessionId ?? null,
    });
  }

  private async runRecordCreate(
    envelope: AutomationCommandEnvelope,
    command: Extract<AutomationCommand, { type: 'records.create' }>,
    reservation: OperationRecord,
    scope: string,
  ): Promise<AutomationCommandResult> {
    this.assertNotExpired(command.expiresAt);
    const sessionId = reservation.reservedSessionId ?? `rec-${crypto.randomUUID()}`;
    const input: AutomationRecordCreateInput = command.input;
    const ledgerResult = buildTimelineLedger({
      sessionId,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      items: input.timeline,
    });
    if (!ledgerResult.ok) {
      throw this.collectorFailure(ledgerResult.code, ledgerResult.message);
    }
    const ledger = ledgerResult.ledger;

    return runExclusive(sessionDomain(sessionId), async () => {
      const now = this.now();
      const outcome = this.store.transaction(() => {
        const duplicate = readSession(this.options.database, sessionId);
        if (duplicate) {
          // 同一 operationId 重放已在入口处返回原结果；走到这里说明 sessionId 被别的记录占用。
          if (reservation.targetId !== sessionId) {
            throw commandFailure('VERSION_CONFLICT', 'sessionId is already used');
          }
          return {
            recordVersion: this.store.readVersion(scope, SESSION_ENTITY, sessionId),
            seq: null,
          };
        }
        const overlapping = listSessionSpans(
          this.options.database,
          ledger.startedAt,
          ledger.endedAt,
        ).filter((span) =>
          spansOverlap(span, { startedAt: ledger.startedAt, endedAt: ledger.endedAt }),
        );
        if (overlapping.length > 0) {
          throw commandFailure('OVERLAPPING_RECORD', 'Record overlaps an existing session', {
            recordVersion: this.store.readVersion(scope, SESSION_ENTITY, overlapping[0]!.id),
            controlVersion: this.currentControlVersion(),
            state: this.options.timer.getSnapshot().state,
            sessionId: overlapping[0]!.id,
          });
        }
        const session: FocusSession = {
          id: sessionId,
          title: input.title ?? null,
          status: 'finished',
          startedAt: ledger.startedAt,
          endedAt: ledger.endedAt,
          activeElapsedMs: ledger.activeElapsedMs,
          pauseElapsedMs: ledger.pauseElapsedMs,
          wallElapsedMs: ledger.wallElapsedMs,
          defaultTaskId: input.defaultTask?.taskId ?? null,
          defaultTaskSource: input.defaultTask?.taskSource ?? null,
          defaultTaskTitle: input.defaultTask?.taskTitle ?? null,
          note: input.note ?? null,
          createdAt: now,
          updatedAt: now,
          tomatodoSubject: toTomatodoSubject(input.tomatodoSubject),
          tomatodoRecordName: toRecordName(input.tomatodoRecordName),
        };
        const segments: FocusSegment[] = ledger.segments.map((segment) => ({
          id: segment.segmentId,
          sessionId,
          taskId: segment.task?.taskId ?? null,
          taskSource: segment.task?.taskSource ?? null,
          title: segment.title ?? segment.task?.taskTitle ?? null,
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
          activeElapsedMs: segment.activeElapsedMs,
          note: null,
          cloudFocusId: null,
          tomatodoSubject: null,
          tomatodoRecordName: null,
          createdAt: now,
          updatedAt: now,
        }));
        const pauses: PauseEvent[] = ledger.pauses.map((pause) => ({
          id: pause.pauseId,
          sessionId,
          segmentId: null,
          pauseStartedAt: pause.startedAt,
          pauseEndedAt: pause.endedAt,
          durationMs: pause.durationMs,
          reason: pause.reason ?? null,
          createdAt: now,
          updatedAt: now,
        }));
        insertRecordRows(this.options.database, { session, segments, pauses });
        const recordVersion = this.store.bumpVersion(scope, SESSION_ENTITY, sessionId, now);
        const seq = this.appendChange('records', SESSION_ENTITY, sessionId, recordVersion);
        return { recordVersion, seq };
      });

      const result: AutomationCommandResult = {
        protocolVersion: AUTOMATION_PROTOCOL_VERSION,
        status: 'applied',
        operationId: envelope.operationId,
        commandType: 'records.create',
        targetId: sessionId,
        recordVersion: outcome.recordVersion,
        controlVersion: this.currentControlVersion(),
        changeSeq: outcome.seq,
        data: this.readRecord(sessionId),
        error: null,
      };
      this.store.completeOperation({
        operationId: envelope.operationId,
        status: 'applied',
        targetId: sessionId,
        resultJson: JSON.stringify(result),
        errorCode: null,
        now,
      });
      return result;
    });
  }

  private async runRecordUpdate(
    envelope: AutomationCommandEnvelope,
    command: Extract<AutomationCommand, { type: 'records.update' }>,
    scope: string,
  ): Promise<AutomationCommandResult> {
    this.assertNotExpired(command.expiresAt);
    const sessionId = command.sessionId;
    return runExclusive(sessionDomain(sessionId), async () => {
      const now = this.now();
      const outcome = this.store.transaction(() => {
        const session = readSession(this.options.database, sessionId);
        if (!session) throw commandFailure('NOT_FOUND', 'Session was not found');
        const current = this.store.readVersion(scope, SESSION_ENTITY, sessionId);
        if (current !== command.expectedRecordVersion) {
          throw commandFailure('VERSION_CONFLICT', 'Record version changed', {
            recordVersion: current,
            controlVersion: this.currentControlVersion(),
            state: this.options.timer.getSnapshot().state,
            sessionId,
          });
        }
        const patch: AutomationRecordPatch = command.patch;
        const metadata: Parameters<typeof updateSessionMetadataRows>[2] = {};
        if ('title' in patch) metadata.title = patch.title ?? null;
        if ('note' in patch) metadata.note = patch.note ?? null;
        if ('defaultTask' in patch) {
          metadata.defaultTaskId = patch.defaultTask?.taskId ?? null;
          metadata.defaultTaskSource = patch.defaultTask?.taskSource ?? null;
          metadata.defaultTaskTitle = patch.defaultTask?.taskTitle ?? null;
        }
        if ('tomatodoSubject' in patch) {
          metadata.tomatodoSubject = toTomatodoSubject(patch.tomatodoSubject);
        }
        if ('tomatodoRecordName' in patch) {
          metadata.tomatodoRecordName = toRecordName(patch.tomatodoRecordName);
        }
        let ledger: TimelineLedger | null = null;
        if (patch.timeline) {
          if (isSessionActive(session)) {
            throw commandFailure(
              'RECORD_NOT_FINISHED',
              'Active sessions only accept timer control and task association',
              {
                recordVersion: current,
                controlVersion: this.currentControlVersion(),
                state: this.options.timer.getSnapshot().state,
                sessionId,
              },
            );
          }
          const built = buildTimelineLedger({
            sessionId,
            startedAt: patch.timeline.startedAt,
            endedAt: patch.timeline.endedAt,
            items: patch.timeline.timeline,
          });
          if (!built.ok) throw commandFailure(built.code, built.message);
          const nextLedger = built.ledger;
          ledger = nextLedger;
          const overlaps = listSessionSpans(
            this.options.database,
            nextLedger.startedAt,
            nextLedger.endedAt,
          ).filter(
            (span) =>
              span.id !== sessionId &&
              spansOverlap(span, {
                startedAt: nextLedger.startedAt,
                endedAt: nextLedger.endedAt,
              }),
          );
          if (overlaps.length > 0) {
            throw commandFailure('OVERLAPPING_RECORD', 'Record overlaps an existing session', {
              recordVersion: this.store.readVersion(scope, SESSION_ENTITY, overlaps[0]!.id),
              controlVersion: this.currentControlVersion(),
              state: this.options.timer.getSnapshot().state,
              sessionId: overlaps[0]!.id,
            });
          }
        }
        if (Object.keys(metadata).length > 0) {
          updateSessionMetadataRows(this.options.database, sessionId, metadata, now);
        }
        let correction: CorrectionRow | null = null;
        const activeLedger = ledger;
        if (activeLedger) {
          const segments: FocusSegment[] = activeLedger.segments.map((segment) => ({
            id: segment.segmentId,
            sessionId,
            taskId: segment.task?.taskId ?? session.defaultTaskId,
            taskSource: segment.task?.taskSource ?? session.defaultTaskSource,
            title: segment.title ?? session.defaultTaskTitle,
            startedAt: segment.startedAt,
            endedAt: segment.endedAt,
            activeElapsedMs: segment.activeElapsedMs,
            note: null,
            cloudFocusId: null,
            tomatodoSubject: null,
            tomatodoRecordName: null,
            createdAt: now,
            updatedAt: now,
          }));
          const pauses: PauseEvent[] = activeLedger.pauses.map((pause) => ({
            id: pause.pauseId,
            sessionId,
            segmentId: null,
            pauseStartedAt: pause.startedAt,
            pauseEndedAt: pause.endedAt,
            durationMs: pause.durationMs,
            reason: pause.reason ?? null,
            createdAt: now,
            updatedAt: now,
          }));
          replaceTimelineRows(
            this.options.database,
            sessionId,
            activeLedger,
            segments,
            pauses,
            now,
          );
          correction = {
            correctionId: `correction-${digest(`${sessionId}|${current}|${activeLedger.activeElapsedMs}|${now}`)}`,
            scope,
            sessionId,
            baseVersion: current,
            newVersion: current + 1,
            reason: patch.timeline!.reason,
            beforeDigest: digest(
              `${session.startedAt}|${session.endedAt}|${session.activeElapsedMs}|${session.pauseElapsedMs}`,
            ),
            afterDigest: digest(
              `${activeLedger.startedAt}|${activeLedger.endedAt}|${activeLedger.activeElapsedMs}|${activeLedger.pauseElapsedMs}`,
            ),
            createdBy: envelope.sourceClient,
            createdAt: now,
          };
          this.store.appendCorrection(correction);
        }
        const recordVersion = this.store.bumpVersion(scope, SESSION_ENTITY, sessionId, now);
        const seq = this.appendChange('records', SESSION_ENTITY, sessionId, recordVersion);
        return { recordVersion, seq };
      });

      const result: AutomationCommandResult = {
        protocolVersion: AUTOMATION_PROTOCOL_VERSION,
        status: 'applied',
        operationId: envelope.operationId,
        commandType: 'records.update',
        targetId: sessionId,
        recordVersion: outcome.recordVersion,
        controlVersion: this.currentControlVersion(),
        changeSeq: outcome.seq,
        data: this.readRecord(sessionId),
        error: null,
      };
      this.store.completeOperation({
        operationId: envelope.operationId,
        status: 'applied',
        targetId: sessionId,
        resultJson: JSON.stringify(result),
        errorCode: null,
        now,
      });
      return result;
    });
  }

  private async runTomatodoSync(
    envelope: AutomationCommandEnvelope,
    command: Extract<AutomationCommand, { type: 'tomatodo.sync' }>,
    scope: string,
  ): Promise<AutomationCommandResult> {
    this.assertNotExpired(command.expiresAt);
    const plan = this.store.readPlan(command.planId);
    if (!plan) throw commandFailure('PLAN_NOT_FOUND', 'Plan was not found');
    return runExclusive(TOMATODO_DOMAIN, async () => {
      const now = this.now();
      if (plan.scope !== scope || plan.sessionId !== command.sessionId) {
        throw commandFailure('PLAN_STALE', 'Plan belongs to another session or connection');
      }
      if (now > plan.expiresAt) {
        this.store.deletePlan(plan.planId);
        throw commandFailure('PLAN_STALE', 'Plan has expired');
      }
      const session = readSession(this.options.database, plan.sessionId);
      if (!session) throw commandFailure('NOT_FOUND', 'Session was not found');
      const recordVersion = this.store.readVersion(scope, SESSION_ENTITY, plan.sessionId);
      const status = this.options.tomatodo.status(plan.sessionId);
      const subject = session.tomatodoSubject ?? status.subject;
      const recordName = session.tomatodoRecordName ?? subject;
      const currentDigest = digest(
        canonicalTomatodoPlanPayload({
          sessionId: plan.sessionId,
          recordVersion,
          subject,
          recordName,
          minutes: tomatodoRecordMinutes(session.activeElapsedMs),
          startedAt: session.startedAt,
        }),
      );
      if (currentDigest !== plan.payloadDigest || recordVersion !== plan.recordVersion) {
        this.store.deletePlan(plan.planId);
        throw commandFailure('PLAN_STALE', 'Record changed after the plan was created', {
          recordVersion,
          controlVersion: this.currentControlVersion(),
          state: this.options.timer.getSnapshot().state,
          sessionId: plan.sessionId,
        });
      }
      const outcome = await this.options.tomatodo.sync(plan.sessionId);
      if (!outcome.ok && outcome.error && outcome.synced === 0 && outcome.skipped === 0) {
        if (outcome.error.startsWith('tomatodo_bridge') || outcome.error.includes('unavailable')) {
          throw commandFailure('TOMATODO_BRIDGE_UNAVAILABLE', 'TomaTodo bridge is unavailable');
        }
      }
      const afterStatus = this.options.tomatodo.status(plan.sessionId);
      const stages: AutomationTomatodoSyncResult['stages'] = {
        localCommitted: true,
        focuslinkCloudState: this.options.focuslinkCloudState?.(plan.sessionId) ?? 'unknown',
        tomatodoLocalWritten: afterStatus.writtenLocally,
        uploadConfirmed: afterStatus.cloudSynced,
        phoneDeliveryState: outcome.phoneSynced
          ? 'confirmed'
          : afterStatus.writtenLocally
            ? 'pending'
            : 'unknown',
        remoteReadbackSupported: false,
        remoteDeleteSupported: false,
      };
      const data: AutomationTomatodoSyncResult = {
        protocolVersion: AUTOMATION_PROTOCOL_VERSION,
        planId: plan.planId,
        sessionId: plan.sessionId,
        recordVersion,
        stages,
        note: 'uploadConfirmed 只代表番茄云接口已确认收下；手机可见性是独立阶段，未确认时为 pending。远端回读与远端删除在本客户端不可用。',
      };
      this.store.deletePlan(plan.planId);
      const result: AutomationCommandResult = {
        protocolVersion: AUTOMATION_PROTOCOL_VERSION,
        status: 'applied',
        operationId: envelope.operationId,
        commandType: 'tomatodo.sync',
        targetId: plan.sessionId,
        recordVersion,
        controlVersion: this.currentControlVersion(),
        changeSeq: null,
        data,
        error: null,
      };
      this.store.completeOperation({
        operationId: envelope.operationId,
        status: 'applied',
        targetId: plan.sessionId,
        resultJson: JSON.stringify(result),
        errorCode: null,
        now: this.now(),
      });
      return result;
    });
  }
}
