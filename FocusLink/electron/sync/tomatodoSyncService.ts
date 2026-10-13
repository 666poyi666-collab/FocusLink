// 番茄 Todo 同步服务 - 独立并行同步通道
// 在专注结束后，把一次专注会话写成番茄 Todo 的一条记录：
// 记录名 = 自定义标题 > 学科名，学科按「手动 > 自动关键词 > 兜底」解析，时长取界面显示的整数分钟。
// 不侵入现有 syncService（dida 专用单目标队列），与之并行运行
//
// 数据流：FocusSession + 其 segments → pickTomatodoSessionSourceSegment → buildTomatodoSessionRecord
// 删除联动：删除本地 segment 时调用 deleteTomatodoRecordForSegment
import {
  findTaskCache,
  getSegment,
  getSession,
  getSetting,
  listSegments,
  setSessionTomatodoRecordName,
  setSessionTomatodoSubject,
  setSetting,
} from '../db/index.js';
import { logger } from '../logger.js';
import {
  addTomatodoSessionRecord,
  deleteTomatodoRecordBySessionId,
  getTomatodoSessionRecordState,
  isTomatodoRunningAsync,
  listPendingTomatodoRecords,
  resolveTomatodoDbPath,
  updateTomatodoSessionRecordNames,
} from '../integrations/tomatodo/localDb.js';
import type { PendingTomatodoRecord } from '../integrations/tomatodo/localDb.js';
import {
  deleteTomatodoRecordThroughBridge,
  updateTomatodoRecordNameThroughBridge,
  writeTomatodoRecordsThroughBridge,
  writeTomatodoRecordThroughBridge,
} from '../integrations/tomatodo/cloudBridge.js';
import { ensureTomatodoBridge } from '../integrations/tomatodo/bridgeLifecycle.js';
import { getSettings } from '../settingsStore.js';
import {
  buildTomatodoSessionRecord,
  inferTomatodoSubject,
  isTomatodoCloudUploadEligible,
  isTomatodoSubject,
  normalizeTomatodoRecordName,
  pickTomatodoSessionSourceSegment,
  resolveSessionRecordName,
  shouldSyncSegmentToTomatodo,
  shouldSyncSessionToTomatodo,
  TOMATODO_FALLBACK_SUBJECT,
  tomatodoRecordMinutes,
} from '../../shared/tomatodoPolicy.js';
import type { FocusSegment, FocusSession, TomatodoConfig, TomatodoSubject } from '@shared/types';

export interface TomatodoSyncSegmentResult {
  segmentId: string;
  ok: boolean;
  /** true = marker 已存在，幂等跳过 */
  skipped: boolean;
  /** true = 本次新写入了一条 PCRecord */
  synced: boolean;
  /** 已经存在于番茄 Todo 本地库。 */
  localWritten: boolean;
  /** 番茄 Todo 云接口已确认上传。 */
  cloudSynced: boolean;
  /** 电脑版已把记录交给在线手机同步通道。 */
  phoneSynced: boolean;
  syncState:
    | 'skipped'
    | 'local-pending'
    | 'cloud-pending'
    /** @deprecated use 'confirmation-pending'; kept for IPC consumers that still expect the old name */
    | 'phone-pending'
    | 'confirmation-pending'
    | 'cloud-synced'
    | 'failed';
  subject: TomatodoSubject;
  minutes: number;
  recordId?: number;
  error?: string;
}

export interface TomatodoSyncSessionResult {
  sessionId: string;
  ok: boolean;
  /** 符合同步条件的段数（已结束且有专注时长） */
  total: number;
  /** 本次新写入 */
  synced: number;
  /** marker 已存在，跳过 */
  skipped: number;
  /** 不符合条件或失败 */
  failed: number;
  results: TomatodoSyncSegmentResult[];
  dbPath: string;
}

/**
 * 会话级待传队列。2026-10-13 起一条番茄记录对应一次专注会话，队列里存 session id。
 * 形状仍是扁平 `string[]`：FL-SYNC-015 的结论不变 —— 队列不区分「写入/改名/手机投递」原因。
 */
const TOMATODO_DURABLE_QUEUE_KEY = 'tomatodo.pendingSessionIdsV161';
let tomatodoOperationTail: Promise<void> = Promise.resolve();

function withTomatodoOperationLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = tomatodoOperationTail.then(operation, operation);
  tomatodoOperationTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function readDurablePendingSessionIds(): string[] {
  try {
    const raw = getSetting(TOMATODO_DURABLE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(parsed.filter((value): value is string => typeof value === 'string' && !!value)),
    ];
  } catch {
    return [];
  }
}

function writeDurablePendingSessionIds(sessionIds: readonly string[]): void {
  setSetting(TOMATODO_DURABLE_QUEUE_KEY, JSON.stringify([...new Set(sessionIds.filter(Boolean))]));
}

function enqueueDurableTomatodoSessions(sessionIds: readonly string[]): void {
  if (sessionIds.length === 0) return;
  writeDurablePendingSessionIds([...readDurablePendingSessionIds(), ...sessionIds]);
}

function completeDurableTomatodoSessions(sessionIds: readonly string[]): void {
  if (sessionIds.length === 0) return;
  const completed = new Set(sessionIds);
  writeDurablePendingSessionIds(
    readDurablePendingSessionIds().filter((sessionId) => !completed.has(sessionId)),
  );
}

/** 读取番茄 Todo 设置；未启用时返回 null */
function getTomatodoConfig(): TomatodoConfig | null {
  const settings = getSettings();
  if (!settings.tomatodo?.enabled) return null;
  return settings.tomatodo;
}

/**
 * 构造自动匹配候选文本。FocusSegment.title 是最可靠的任务快照；任务缓存存在时再补充
 * 最新标题、正文和标签，以兼容“任务标题/任务内容”里写学科的工作流。
 */
function getSubjectCandidateTexts(segment: FocusSegment): Array<string | null | undefined> {
  // segment.title 已由 resolveSegmentSubject 作为第一个候选处理；这里补充缓存任务文本。
  const candidates: Array<string | null | undefined> = [];
  if (!segment.taskId) return candidates;
  try {
    const task = findTaskCache(segment.taskId, segment.taskSource ?? undefined);
    if (task) {
      candidates.push(task.title, task.content, task.tags);
    }
  } catch (err) {
    // 自动分类不能因缓存读取失败阻断专注记录同步；仍可退回 segment.title / 默认分类。
    logger.warn('tomatodoSync', 'failed to load task text for subject matching', {
      segmentId: segment.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return candidates;
}

type TomatodoSubjectSource = 'manual' | 'auto' | 'fallback';

/**
 * 解析一次会话的番茄学科。
 *
 * 手动值优先看会话（v1.6.1 之后的新位置），再兼容片段上的旧手动值；
 * 都没有时用会话标题 + 来源片段的标题/任务文本自动匹配，最后兜底「学习」。
 * 注意：默认学科配置刻意不参与兜底 —— 兜底恒为「学习」，见 resolveSegmentSubject 的历史约定。
 */
function getSubjectResolutionForSession(
  session: FocusSession,
  source: FocusSegment | null,
): { subject: TomatodoSubject; source: TomatodoSubjectSource } {
  const manual = session.tomatodoSubject ?? source?.tomatodoSubject ?? null;
  if ((manual as string | null) === '杂') {
    return { subject: '学习', source: 'manual' };
  }
  if (manual && isTomatodoSubject(manual)) {
    return { subject: manual, source: 'manual' };
  }
  const candidates = source ? getSubjectCandidateTexts(source) : [];
  const inferred = inferTomatodoSubject(session.title, source?.title, ...candidates);
  if (inferred) return { subject: inferred, source: 'auto' };
  return { subject: TOMATODO_FALLBACK_SUBJECT, source: 'fallback' };
}

interface ExistingRecordUpdateResult {
  ok: boolean;
  foundCount: number;
  updatedCount: number;
  error?: string;
}

/** 一次专注会话在番茄 Todo 侧的完整写入口径。 */
interface SessionRecordPlan {
  sessionId: string;
  session: FocusSession;
  /** 会话下所有片段（诊断用）。 */
  segments: FocusSegment[];
  /** 已结束且有专注时长的片段 —— 只有它们参与这条记录。 */
  eligible: FocusSegment[];
  /** 决定记录名与学科来源的片段。 */
  source: FocusSegment;
  subject: TomatodoSubject;
  /** 最终写入 PCRecord.name 的字符串。 */
  recordName: string;
  dbPath: string;
}

type SessionRecordPlanResult =
  { ok: true; plan: SessionRecordPlan } | { ok: false; error: string; skipped: boolean };

/**
 * 把一次会话折算成「一条番茄记录」的全部输入。
 *
 * 时长与起点都取会话本身：FocusLink 界面显示的会话时长是整数分钟，
 * 番茄记录必须写同一个数，否则两边各显示一个数字
 * （2026-10-13 用户实测「番茄 7 分钟 / FocusLink 8 分钟」即由小数截断造成）。
 */
function buildSessionRecordPlan(
  sessionId: string,
  config: TomatodoConfig,
  options: { requireEnded?: boolean } = {},
): SessionRecordPlanResult {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: 'session_not_found', skipped: false };

  const segments = listSegments(sessionId);
  const eligible = segments.filter((segment) => shouldSyncSegmentToTomatodo(segment));
  if (eligible.length === 0) {
    return { ok: false, error: 'session_has_no_eligible_segment', skipped: true };
  }
  if ((options.requireEnded ?? true) && !shouldSyncSessionToTomatodo(session)) {
    return { ok: false, error: 'session_not_ended_or_no_elapsed', skipped: true };
  }

  const source = pickTomatodoSessionSourceSegment(eligible);
  if (!source) {
    return { ok: false, error: 'session_has_no_eligible_segment', skipped: true };
  }

  const { subject } = getSubjectResolutionForSession(session, source);
  return {
    ok: true,
    plan: {
      sessionId,
      session,
      segments,
      eligible,
      source,
      subject,
      recordName: resolveSessionRecordName(session, subject),
      dbPath: resolveTomatodoDbPath(config.dbPath),
    },
  };
}

/**
 * 写入（或就地更新）一次会话的番茄记录；调用方必须持有服务级操作锁。
 *
 * 番茄 Todo 正在运行时只能走它自己的 addRecord/updateRecord/cloudSync API，
 * 直接改 JSON 会被回写覆盖；未运行时安全写本地并保持 isSynced=0，待它下次启动后上传。
 */
async function writeSessionRecordUnlocked(
  sessionId: string,
): Promise<{ result: TomatodoSyncSegmentResult; recordFound: boolean }> {
  const config = getTomatodoConfig();
  const empty: TomatodoSyncSegmentResult = {
    segmentId: '',
    ok: false,
    skipped: false,
    synced: false,
    subject: '学习',
    minutes: 0,
    localWritten: false,
    cloudSynced: false,
    phoneSynced: false,
    syncState: 'failed',
  };

  if (!config) {
    return {
      recordFound: false,
      result: {
        ...empty,
        ok: true,
        skipped: true,
        syncState: 'skipped',
        error: 'tomatodo_disabled',
      },
    };
  }

  const planned = buildSessionRecordPlan(sessionId, config);
  if (!planned.ok) {
    return {
      recordFound: false,
      result: {
        ...empty,
        ok: planned.skipped,
        skipped: planned.skipped,
        syncState: planned.skipped ? 'skipped' : 'failed',
        error: planned.error,
      },
    };
  }

  const { plan } = planned;
  const base: TomatodoSyncSegmentResult = {
    ...empty,
    segmentId: plan.source.id,
    subject: plan.subject,
    minutes: tomatodoRecordMinutes(plan.session.activeElapsedMs),
  };
  const record = buildTomatodoSessionRecord({
    sessionId,
    subject: plan.subject,
    recordName: plan.recordName,
    startedAt: plan.session.startedAt,
    activeElapsedMs: plan.session.activeElapsedMs,
  });

  // 在任何外部调用前先持久化意图。即使客户端正在运行但桥不可用，重启后仍可补传。
  enqueueDurableTomatodoSessions([sessionId]);

  if (await isTomatodoRunningAsync()) {
    const bridge = await writeTomatodoRecordThroughBridge(record, { syncToPhone: true });
    if (!bridge.available) {
      return {
        recordFound: false,
        result: {
          ...base,
          error:
            '番茄 Todo 正在运行，但本地同步桥不可用；请关闭番茄 Todo 后重试，或以云同步桥模式启动。',
        },
      };
    }
    const phoneSyncConfirmed = bridge.phoneSyncConfirmed ?? true;
    if (bridge.uploadConfirmed && phoneSyncConfirmed) {
      completeDurableTomatodoSessions([sessionId]);
    }
    return {
      recordFound: bridge.recordFound,
      result: {
        ...base,
        ok: bridge.ok,
        skipped: bridge.skipped,
        synced: bridge.localWritten && !bridge.skipped,
        localWritten: bridge.localWritten,
        // 对外的 cloudSynced 表示番茄 Todo 上传接口已确认，不表示独立云端回读。
        cloudSynced: bridge.uploadConfirmed,
        phoneSynced: phoneSyncConfirmed,
        syncState: bridge.ok
          ? bridge.uploadConfirmed
            ? phoneSyncConfirmed
              ? 'cloud-synced'
              : 'confirmation-pending'
            : 'cloud-pending'
          : 'failed',
        recordId: bridge.recordId,
        error: bridge.error ?? bridge.cloudError ?? bridge.phoneSyncError,
      },
    };
  }

  // 番茄 Todo 未运行时安全写入本地库，并保持 isSynced=0，待它下次启动后上传。
  const existing = getTomatodoSessionRecordState(plan.dbPath, sessionId);
  if (existing.exists) {
    const update = updateTomatodoSessionRecordNames(plan.dbPath, [
      { sessionId, subject: plan.subject, recordName: plan.recordName },
    ]);
    const state = getTomatodoSessionRecordState(plan.dbPath, sessionId);
    if (state.cloudSynced) completeDurableTomatodoSessions([sessionId]);
    return {
      recordFound: true,
      result: {
        ...base,
        ok: update.ok,
        skipped: update.ok,
        localWritten: true,
        cloudSynced: state.cloudSynced,
        syncState: state.cloudSynced ? 'cloud-synced' : 'local-pending',
        recordId: state.recordId,
        error: update.error,
      },
    };
  }

  const result = addTomatodoSessionRecord(plan.dbPath, {
    sessionId,
    subject: plan.subject,
    recordName: plan.recordName,
    startedAt: plan.session.startedAt,
    activeElapsedMs: plan.session.activeElapsedMs,
  });

  return {
    recordFound: false,
    result: {
      ...base,
      ok: result.ok,
      skipped: result.skipped,
      synced: result.ok && !result.skipped,
      localWritten: result.ok,
      syncState: result.ok ? 'local-pending' : 'failed',
      recordId: result.recordId,
      error: result.error,
    },
  };
}

/**
 * 兼容入口：同步某片段所在会话的番茄记录。
 * 记录粒度自 2026-10-13 起是「一次会话一条」，因此这个入口写的是整条会话。
 */
export function syncSegmentToTomatodo(segmentId: string): Promise<TomatodoSyncSegmentResult> {
  return withTomatodoOperationLock(async () => {
    const segment = getSegment(segmentId);
    if (!segment) {
      return {
        segmentId,
        ok: false,
        skipped: false,
        synced: false,
        localWritten: false,
        cloudSynced: false,
        phoneSynced: false,
        syncState: 'failed' as const,
        subject: '学习' as const,
        minutes: 0,
        error: 'segment_not_found',
      };
    }
    const { result } = await writeSessionRecordUnlocked(segment.sessionId);
    return result;
  });
}

/**
 * 同步一次会话到番茄 Todo；调用方必须持有服务级操作锁。
 *
 * 粒度是会话不是片段：一次专注只产生一条番茄记录，时长取会话累计专注时长。
 */
async function syncSessionToTomatodoUnlocked(
  sessionId: string,
): Promise<TomatodoSyncSessionResult> {
  const config = getTomatodoConfig();
  if (!config) {
    return {
      sessionId,
      ok: true,
      total: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      results: [],
      dbPath: '',
    };
  }

  const dbPath = resolveTomatodoDbPath(config.dbPath);
  const { result, recordFound } = await writeSessionRecordUnlocked(sessionId);

  const synced = result.synced ? 1 : 0;
  const skipped = result.ok && result.skipped ? 1 : 0;
  const failed = result.ok ? 0 : 1;

  logger.info('tomatodoSync', 'session synced', {
    sessionId,
    total: 1,
    synced,
    skipped,
    failed,
    recordFound,
    subject: result.subject,
    minutes: result.minutes,
    syncState: result.syncState,
    dbPath,
  });

  return {
    sessionId,
    ok: result.ok,
    total: 1,
    synced,
    skipped,
    failed,
    results: [result],
    dbPath,
  };
}

export function syncSessionToTomatodo(sessionId: string): Promise<TomatodoSyncSessionResult> {
  return withTomatodoOperationLock(() => syncSessionToTomatodoUnlocked(sessionId));
}

export interface TomatodoSubjectSetResult {
  /** false 只表示外部记录更新失败或 segment 不存在；本地手动选择仍会保留。 */
  ok: boolean;
  updatedCount: number;
  externalFoundCount: number;
  externalUpdatedCount: number;
  error?: string;
}

function parseManualSubject(subject: string | null): TomatodoSubject | null {
  if (subject === null) return null;
  if (subject === '杂') return '学习';
  if (!isTomatodoSubject(subject)) {
    throw new Error('无效的番茄 Todo 学科分类');
  }
  return subject;
}

/**
 * 把会话当前的「学科 + 标题」推向番茄 Todo。
 *
 * 本地选择永远保留；外部更新失败时留下 durable 重试意图，
 * 不让旧的 isSynced=1 掩盖新的待上传内容（FL-SYNC-015 的不变量）。
 * 必须由已持有服务级操作锁的调用者使用。
 */
async function applySessionAssignmentUpdate(sessionId: string): Promise<TomatodoSubjectSetResult> {
  const config = getTomatodoConfig();
  const dbPath = config ? resolveTomatodoDbPath(config.dbPath) : null;
  const session = getSession(sessionId);
  if (!session) {
    return {
      ok: false,
      updatedCount: 0,
      externalFoundCount: 0,
      externalUpdatedCount: 0,
      error: 'session_not_found_after_update',
    };
  }
  const source = pickTomatodoSessionSourceSegment(
    listSegments(sessionId).filter((segment) => shouldSyncSegmentToTomatodo(segment)),
  );
  const { subject } = getSubjectResolutionForSession(session, source);
  const recordName = resolveSessionRecordName(session, subject);
  // A failed bridge update must not disappear merely because the existing record still carries
  // isSynced=1 for its previous subject. Remember that marker-backed intent so the background
  // retry can reconcile the subject once a verified bridge is available again.
  const markerExistedBeforeUpdate = dbPath
    ? getTomatodoSessionRecordState(dbPath, sessionId).exists
    : false;
  let external: ExistingRecordUpdateResult;
  let shouldRetryMarkerBackedUpdate = false;
  if (config && (await isTomatodoRunningAsync())) {
    const bridge = await updateTomatodoRecordNameThroughBridge(sessionId, recordName, {
      syncToPhone: true,
    });
    external = {
      ok: bridge.available && bridge.ok,
      foundCount: bridge.recordFound ? 1 : 0,
      updatedCount: bridge.localChanged ? 1 : 0,
      error: bridge.error ?? bridge.cloudError,
    };
    shouldRetryMarkerBackedUpdate =
      (!bridge.available || !bridge.ok || bridge.phoneSyncConfirmed === false) &&
      (bridge.recordFound || markerExistedBeforeUpdate);
  } else if (dbPath) {
    const result = updateTomatodoSessionRecordNames(dbPath, [{ sessionId, subject, recordName }]);
    external = {
      ok: result.ok,
      foundCount: result.foundKeys.length,
      updatedCount: result.updatedCount,
      error: result.error,
    };
    shouldRetryMarkerBackedUpdate = !external.ok && markerExistedBeforeUpdate;
  } else {
    external = { ok: true, foundCount: 0, updatedCount: 0 };
  }
  if (shouldRetryMarkerBackedUpdate) {
    enqueueDurableTomatodoSessions([sessionId]);
  }
  if (!external.ok) {
    logger.warn(
      'tomatodoSync',
      'manual tomatodo assignment saved locally but external record update failed',
      { sessionId, error: external.error },
    );
  }
  return {
    ok: external.ok,
    updatedCount: 1,
    externalFoundCount: external.foundCount,
    externalUpdatedCount: external.updatedCount,
    error: external.error,
  };
}

/**
 * 保存一次会话的手动学科分类；已写入的番茄记录会就地改名并重新排队上云，
 * 功能禁用或记录尚未写入时只保存本地选择。
 */
async function setTomatodoSubjectForSessionUnlocked(
  sessionId: string,
  subject: string | null,
): Promise<TomatodoSubjectSetResult> {
  try {
    const manualSubject = parseManualSubject(subject);
    if (!getSession(sessionId)) {
      return {
        ok: false,
        updatedCount: 0,
        externalFoundCount: 0,
        externalUpdatedCount: 0,
        error: 'session_not_found',
      };
    }
    setSessionTomatodoSubject(sessionId, manualSubject);
    return await applySessionAssignmentUpdate(sessionId);
  } catch (err) {
    return {
      ok: false,
      updatedCount: 0,
      externalFoundCount: 0,
      externalUpdatedCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function setTomatodoSubjectForSession(
  sessionId: string,
  subject: string | null,
): Promise<TomatodoSubjectSetResult> {
  return withTomatodoOperationLock(() => setTomatodoSubjectForSessionUnlocked(sessionId, subject));
}

/** 兼容入口：按片段 id 找到所属会话后保存手动学科分类。 */
export function setTomatodoSubjectForSegment(
  segmentId: string,
  subject: string | null,
): Promise<TomatodoSubjectSetResult> {
  return withTomatodoOperationLock(async () => {
    const segment = getSegment(segmentId);
    if (!segment) {
      return {
        ok: false,
        updatedCount: 0,
        externalFoundCount: 0,
        externalUpdatedCount: 0,
        error: 'segment_not_found',
      };
    }
    return setTomatodoSubjectForSessionUnlocked(segment.sessionId, subject);
  });
}

/** 批量保存手动分类：按会话去重，逐个会话更新本地选择与已存在的番茄记录。 */
async function setTomatodoSubjectsForSessionsUnlocked(
  sessionIds: string[],
  subject: string | null,
): Promise<TomatodoSubjectSetResult> {
  const uniqueIds = [...new Set(sessionIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { ok: true, updatedCount: 0, externalFoundCount: 0, externalUpdatedCount: 0 };
  }
  let updatedCount = 0;
  let externalFoundCount = 0;
  let externalUpdatedCount = 0;
  let error: string | undefined;
  try {
    const manualSubject = parseManualSubject(subject);
    for (const sessionId of uniqueIds) {
      updatedCount += setSessionTomatodoSubject(sessionId, manualSubject);
    }
    for (const sessionId of uniqueIds) {
      const item = await applySessionAssignmentUpdate(sessionId);
      externalFoundCount += item.externalFoundCount;
      externalUpdatedCount += item.externalUpdatedCount;
      if (!item.ok) error ??= item.error;
    }
  } catch (err) {
    return {
      ok: false,
      updatedCount,
      externalFoundCount,
      externalUpdatedCount,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (error) {
    logger.warn('tomatodoSync', 'manual subject batch saved locally but external update failed', {
      sessionIds: uniqueIds,
      error,
    });
  }
  return { ok: !error, updatedCount, externalFoundCount, externalUpdatedCount, error };
}

/** 兼容入口：片段 id 批量 → 所属会话去重后保存手动学科分类。 */
export function setTomatodoSubjectsForSegments(
  segmentIds: string[],
  subject: string | null,
): Promise<TomatodoSubjectSetResult> {
  return withTomatodoOperationLock(async () => {
    const sessionIds = segmentIds
      .map((segmentId) => getSegment(segmentId)?.sessionId)
      .filter((id): id is string => Boolean(id));
    return setTomatodoSubjectsForSessionsUnlocked(sessionIds, subject);
  });
}

/**
 * 归一化用户输入的自定义标题；null 或空白表示清除自定义标题，
 * 清除后写入番茄 Todo 的记录名回落到学科名（旧行为）。
 */
function parseRecordName(recordName: string | null): string | null {
  if (recordName === null) return null;
  return normalizeTomatodoRecordName(recordName);
}

/**
 * 保存一次会话的番茄 Todo 自定义记录标题。
 * 与手动学科共用同一套语义：本地选择一定保留；已存在的 marker 记录就地改名并重新排队上云；
 * 外部更新失败时留下 durable 重试意图，不容许旧的 isSynced=1 掩盖新的待上传内容。
 */
async function setTomatodoRecordNameForSessionUnlocked(
  sessionId: string,
  recordName: string | null,
): Promise<TomatodoSubjectSetResult> {
  try {
    const manualRecordName = parseRecordName(recordName);
    if (!getSession(sessionId)) {
      return {
        ok: false,
        updatedCount: 0,
        externalFoundCount: 0,
        externalUpdatedCount: 0,
        error: 'session_not_found',
      };
    }
    setSessionTomatodoRecordName(sessionId, manualRecordName);
    return await applySessionAssignmentUpdate(sessionId);
  } catch (err) {
    return {
      ok: false,
      updatedCount: 0,
      externalFoundCount: 0,
      externalUpdatedCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function setTomatodoRecordNameForSession(
  sessionId: string,
  recordName: string | null,
): Promise<TomatodoSubjectSetResult> {
  return withTomatodoOperationLock(() =>
    setTomatodoRecordNameForSessionUnlocked(sessionId, recordName),
  );
}

/** 兼容入口：按片段 id 找到所属会话后保存自定义记录标题。 */
export function setTomatodoRecordNameForSegment(
  segmentId: string,
  recordName: string | null,
): Promise<TomatodoSubjectSetResult> {
  return withTomatodoOperationLock(async () => {
    const segment = getSegment(segmentId);
    if (!segment) {
      return {
        ok: false,
        updatedCount: 0,
        externalFoundCount: 0,
        externalUpdatedCount: 0,
        error: 'segment_not_found',
      };
    }
    return setTomatodoRecordNameForSessionUnlocked(segment.sessionId, recordName);
  });
}

/** 会话级删除：清掉一次专注在番茄 Todo 里的那条记录（删除联动）。 */
async function deleteTomatodoSessionRecordUnlocked(
  sessionId: string,
): Promise<{ ok: boolean; deletedCount: number }> {
  // 即使用户刚关闭同步，也要清理此前已写入的 marker，避免本地记录删除后番茄 Todo 留下孤儿记录。
  // “关闭”只禁止新增/更新，不应阻断删除联动。
  const config = getSettings().tomatodo;
  const dbPath = resolveTomatodoDbPath(config.dbPath);
  if (await isTomatodoRunningAsync()) {
    const bridge = await deleteTomatodoRecordThroughBridge(sessionId);
    if (bridge.available) {
      if (bridge.ok) completeDurableTomatodoSessions([sessionId]);
      return { ok: bridge.ok, deletedCount: bridge.deletedCount };
    }
    return { ok: false, deletedCount: 0 };
  }
  const result = deleteTomatodoRecordBySessionId(dbPath, sessionId);
  if (result.ok) completeDurableTomatodoSessions([sessionId]);
  return { ok: result.ok, deletedCount: result.deletedCount };
}

/** 删除番茄 Todo 中某会话对应的记录（删除联动）。 */
export function deleteTomatodoRecordForSession(sessionId: string): Promise<{
  ok: boolean;
  deletedCount: number;
}> {
  return withTomatodoOperationLock(() => deleteTomatodoSessionRecordUnlocked(sessionId));
}

/** 兼容入口：删除某片段所在会话的番茄记录。 */
export function deleteTomatodoRecordForSegment(segmentId: string): Promise<{
  ok: boolean;
  deletedCount: number;
}> {
  return withTomatodoOperationLock(async () => {
    const segment = getSegment(segmentId);
    if (!segment) return { ok: true, deletedCount: 0 };
    return deleteTomatodoSessionRecordUnlocked(segment.sessionId);
  });
}

export type TomatodoSyncState =
  'not-written' | 'local-pending' | 'confirmation-pending' | 'expired-history' | 'cloud-synced';

/** 查询某会话的番茄 Todo 同步状态（供 UI 展示）。一次专注 = 一条番茄记录。 */
export function getTomatodoSyncStatus(sessionId: string): {
  enabled: boolean;
  dbPath: string;
  sessionId: string;
  subject: TomatodoSubject;
  source: TomatodoSubjectSource;
  /** 最终写入 PCRecord.name 的字符串：自定义标题优先，否则等于 subject。 */
  recordName: string;
  /** 用户自定义标题；null 表示未设置（记录名 == 学科名）。 */
  customRecordName: string | null;
  /** 将写入番茄 Todo 的整数分钟（与界面显示一致）。 */
  minutes: number;
  writtenLocally: boolean;
  cloudSynced: boolean;
  recordId?: number;
  state: TomatodoSyncState;
  /** 兼容旧渲染层：会话下每个片段都指向同一条会话级记录。 */
  segments: Array<{
    segmentId: string;
    /** 兼容旧渲染层；现在只在番茄 Todo 云端已确认时为 true。 */
    synced: boolean;
    writtenLocally: boolean;
    cloudSynced: boolean;
    state: TomatodoSyncState;
    subject: TomatodoSubject;
    source: TomatodoSubjectSource;
    recordName: string;
    customRecordName: string | null;
  }>;
} {
  const config = getTomatodoConfig();
  if (!config) {
    return {
      enabled: false,
      dbPath: '',
      sessionId,
      subject: TOMATODO_FALLBACK_SUBJECT,
      source: 'fallback',
      recordName: TOMATODO_FALLBACK_SUBJECT,
      customRecordName: null,
      minutes: 0,
      writtenLocally: false,
      cloudSynced: false,
      state: 'not-written',
      segments: [],
    };
  }
  const dbPath = resolveTomatodoDbPath(config.dbPath);
  const session = getSession(sessionId);
  const segments = listSegments(sessionId);
  const durablePendingIds = new Set(readDurablePendingSessionIds());
  const sourceSegment = pickTomatodoSessionSourceSegment(
    segments.filter((segment) => shouldSyncSegmentToTomatodo(segment)),
  );
  const resolution = session
    ? getSubjectResolutionForSession(session, sourceSegment)
    : { subject: TOMATODO_FALLBACK_SUBJECT, source: 'fallback' as TomatodoSubjectSource };
  const customRecordName = normalizeTomatodoRecordName(session?.tomatodoRecordName) ?? null;
  const recordName = session
    ? resolveSessionRecordName(session, resolution.subject)
    : resolution.subject;
  const recordState = getTomatodoSessionRecordState(dbPath, sessionId);
  // A durable intent can represent a newer assignment than the still-synced external record.
  // Until that intent is replayed, presenting the old isSynced=1 as current would be false.
  const cloudSynced = recordState.cloudSynced && !durablePendingIds.has(sessionId);
  const startedAt = session?.startedAt ?? segments[0]?.startedAt ?? Date.now();
  const state: TomatodoSyncState = cloudSynced
    ? 'cloud-synced'
    : !isTomatodoCloudUploadEligible(startedAt) &&
        (recordState.exists || durablePendingIds.has(sessionId))
      ? 'expired-history'
      : durablePendingIds.has(sessionId)
        ? 'confirmation-pending'
        : recordState.exists
          ? 'local-pending'
          : 'not-written';
  const minutes = session ? tomatodoRecordMinutes(session.activeElapsedMs) : 0;
  return {
    enabled: true,
    dbPath,
    sessionId,
    subject: resolution.subject,
    source: resolution.source,
    recordName,
    customRecordName,
    minutes,
    writtenLocally: recordState.exists,
    cloudSynced,
    recordId: recordState.recordId,
    state,
    segments: segments.map((segment) => ({
      segmentId: segment.id,
      synced: cloudSynced,
      writtenLocally: recordState.exists,
      cloudSynced,
      state,
      subject: resolution.subject,
      source: resolution.source,
      recordName,
      customRecordName,
    })),
  };
}

export interface PendingUploadResult {
  ok: boolean;
  total: number;
  uploaded: number;
  failed: number;
  expired: number;
  error?: string;
}

export interface TomatodoUploadQueueSummary {
  total: number;
  uploadable: number;
  expired: number;
}

export interface PendingTomatodoUploadOptions {
  /** User-initiated only. Background retries must never launch an external application. */
  ensureBridge?: boolean;
}

const TOMATODO_CLOUD_CONFIRMATION_GRACE_MS = 2000;
const TOMATODO_CLOUD_CONFIRMATION_POLL_MS = 100;

/**
 * TomaToDo may finish its own automatic upload just after the bridge call returns a transient
 * failure. Give the external source of truth a short grace window so a manual click does not show
 * “still pending” while the JSON has already been confirmed as isSynced=1.
 */
async function reconcileTomatodoCloudConfirmation(
  dbPath: string,
  sessionIds: readonly string[],
  initiallyConfirmed: readonly string[],
): Promise<string[]> {
  const confirmed = new Set(initiallyConfirmed);
  if (confirmed.size >= sessionIds.length) return [...confirmed];
  const deadline = Date.now() + TOMATODO_CLOUD_CONFIRMATION_GRACE_MS;
  while (true) {
    for (const sessionId of sessionIds) {
      if (confirmed.has(sessionId)) continue;
      try {
        if (getTomatodoSessionRecordState(dbPath, sessionId).cloudSynced) confirmed.add(sessionId);
      } catch {
        // Atomic replacement can make a single read race with TomaToDo; retry inside the grace.
      }
    }
    if (confirmed.size >= sessionIds.length || Date.now() >= deadline) return [...confirmed];
    await new Promise((resolve) => setTimeout(resolve, TOMATODO_CLOUD_CONFIRMATION_POLL_MS));
  }
}

/**
 * 上传番茄 Todo 本地库中所有待同步（isSynced=0）的 FocusLink 记录到云端。
 * 一次专注会话对应一条记录，因此只有会话级 marker 才能上传；
 * v1.6.1 之前的片段级记录没有会话口径，只作为本地历史保留，不参与重试。
 * 仅在番茄 Todo 桌面端运行时有效（需要 CDP 桥）。
 */
async function uploadPendingTomatodoRecordsUnlocked(
  options: PendingTomatodoUploadOptions,
): Promise<PendingUploadResult> {
  const config = getTomatodoConfig();
  if (!config) {
    return { ok: true, total: 0, uploaded: 0, failed: 0, expired: 0 };
  }
  const dbPath = resolveTomatodoDbPath(config.dbPath);
  const pendingBySessionId = new Map<string, PendingTomatodoRecord>();
  for (const record of listPendingTomatodoRecords(dbPath)) {
    if (record.sessionId) pendingBySessionId.set(record.sessionId, record);
  }

  const inputs: Array<{
    sessionId: string;
    record: ReturnType<typeof buildTomatodoSessionRecord>;
  }> = [];
  // 上传的永远是「会话当前口径」而不是落库时的快照：这样用户在等待期间改标题或学科，
  // 点一次立即上传即可把新名字带上去，而不是把旧名字再传一遍。
  const pushUploadable = (sessionId: string): boolean => {
    const planned = buildSessionRecordPlan(sessionId, config);
    if (!planned.ok) return false;
    inputs.push({
      sessionId,
      record: buildTomatodoSessionRecord({
        sessionId,
        subject: planned.plan.subject,
        recordName: planned.plan.recordName,
        startedAt: planned.plan.session.startedAt,
        activeElapsedMs: planned.plan.session.activeElapsedMs,
      }),
    });
    return true;
  };

  for (const sessionId of pendingBySessionId.keys()) pushUploadable(sessionId);

  const durableIds = readDurablePendingSessionIds();
  const invalidDurableIds: string[] = [];
  for (const sessionId of durableIds) {
    if (pendingBySessionId.has(sessionId)) continue;
    if (!pushUploadable(sessionId)) invalidDurableIds.push(sessionId);
  }
  // 会话已被删除、尚未结束或没有任何可计入时长的片段时，重试永远不可能成功，只清掉重试意图。
  completeDurableTomatodoSessions(invalidDurableIds);

  if (inputs.length === 0) {
    return { ok: true, total: 0, uploaded: 0, failed: 0, expired: 0 };
  }

  const uploadableInputs = inputs.filter((input) =>
    isTomatodoCloudUploadEligible(input.record.createDate),
  );
  const expiredInputs = inputs.filter(
    (input) => !isTomatodoCloudUploadEligible(input.record.createDate),
  );
  const expiredSessionIds = new Set(expiredInputs.map((input) => input.sessionId));
  const expired = expiredInputs.length;
  // These records remain in TomaToDo's local history, but retrying can never succeed because the
  // external API rejects them permanently. Remove only FocusLink's durable retry intent.
  completeDurableTomatodoSessions(expiredInputs.map((input) => input.sessionId));
  if (uploadableInputs.length === 0) {
    return {
      ok: true,
      total: inputs.length,
      uploaded: 0,
      failed: 0,
      expired,
      error: `${expired} 条历史记录已超过番茄 To-do 的 7 天上传窗口；记录仍保留在本机，已停止自动重试`,
    };
  }

  let bridgeConnected = false;
  if (options.ensureBridge) {
    const bridgeStatus = await ensureTomatodoBridge();
    if (!bridgeStatus.connected) {
      return {
        ok: false,
        total: inputs.length,
        uploaded: 0,
        failed: uploadableInputs.length,
        expired,
        error: bridgeStatus.error ?? '番茄 Todo 同步桥不可用。',
      };
    }
    bridgeConnected = true;
  }

  if (!bridgeConnected && !(await isTomatodoRunningAsync())) {
    // Durable 队列中可能有“客户端运行但桥不可用”时尚未写入 JSON 的会话。
    // 客户端现已关闭，可以安全落到本地库；保留 durable id，待下次运行后上云确认。
    for (const sessionId of durableIds) {
      if (
        pendingBySessionId.has(sessionId) ||
        invalidDurableIds.includes(sessionId) ||
        expiredSessionIds.has(sessionId)
      )
        continue;
      await writeSessionRecordUnlocked(sessionId);
    }
    return {
      ok: false,
      total: inputs.length,
      uploaded: 0,
      failed: 0,
      expired,
      error: '番茄 Todo 未运行；记录已安全写入本地待传队列，将在下次启动后上传。',
    };
  }

  const bridge = await writeTomatodoRecordsThroughBridge(
    uploadableInputs.map((input) => input.record),
    {
      syncToPhone: true,
    },
  );
  if (!bridge.available) {
    return {
      ok: false,
      total: inputs.length,
      uploaded: 0,
      failed: uploadableInputs.length,
      expired,
      error: '番茄 Todo 同步桥不可用。请确保番茄 Todo 已启动。',
    };
  }

  // 只有桥明确回报「上传已确认」的会话才算已确认；其余会话交给下面的有界宽限读回。
  // 番茄 Todo 可能在桥返回瞬态失败之后自己把 isSynced 落成 1，所以宽限读回必须真的发生：
  // 若把「全部待上传会话」同时当作 initiallyConfirmed，宽限窗口会在第一行就短路返回，
  // 于是桥报失败的会话也会被算成「上传已确认」并清掉 durable 重试意图。
  const uploadableSessionIds = uploadableInputs.map((input) => input.sessionId);
  const bridgeCloudConfirmedSessionIds = uploadableInputs
    .filter((_, index) => bridge.results[index]?.uploadConfirmed)
    .map((input) => input.sessionId);
  const bridgePhoneConfirmedSessionIds = new Set(
    uploadableInputs
      .filter((_, index) => bridge.results[index]?.phoneSyncConfirmed ?? true)
      .map((input) => input.sessionId),
  );
  const cloudConfirmedSessionIds = await reconcileTomatodoCloudConfirmation(
    dbPath,
    uploadableSessionIds,
    bridgeCloudConfirmedSessionIds,
  );
  const uploadedSessionIds = cloudConfirmedSessionIds.filter((sessionId) =>
    bridgePhoneConfirmedSessionIds.has(sessionId),
  );
  completeDurableTomatodoSessions(uploadedSessionIds);
  const uploaded = uploadedSessionIds.length;
  const failed = Math.max(0, uploadableInputs.length - uploaded);

  logger.info('tomatodoSync', 'pending upload completed', {
    total: inputs.length,
    uploaded,
    failed,
    expired,
  });

  return {
    ok: failed === 0,
    total: inputs.length,
    uploaded,
    failed,
    expired,
    error: failed > 0 ? `${failed} 条仍待云端确认，已保留并将在后台自动重试` : undefined,
  };
}

export function uploadPendingTomatodoRecords(
  options: PendingTomatodoUploadOptions = {},
): Promise<PendingUploadResult> {
  return withTomatodoOperationLock(() => uploadPendingTomatodoRecordsUnlocked(options));
}

/** 返回当前待上云的 FocusLink 记录数（供 UI 展示）。 */
export function getPendingTomatodoCount(): number {
  return getPendingTomatodoSummary().uploadable;
}

export function getPendingTomatodoSummary(now = Date.now()): TomatodoUploadQueueSummary {
  const config = getTomatodoConfig();
  if (!config) return { total: 0, uploadable: 0, expired: 0 };
  const dbPath = resolveTomatodoDbPath(config.dbPath);
  const pending = new Map<string, number>();
  for (const record of listPendingTomatodoRecords(dbPath)) {
    // 片段级历史记录不计入待传队列：它们没有会话口径，永远不会被重试上传。
    if (record.sessionId) {
      pending.set(record.sessionId, record.startDate + Math.round(record.time * 60_000));
    }
  }
  for (const sessionId of readDurablePendingSessionIds()) {
    if (pending.has(sessionId)) continue;
    const planned = buildSessionRecordPlan(sessionId, config);
    if (!planned.ok) continue;
    pending.set(
      sessionId,
      planned.plan.session.startedAt +
        tomatodoRecordMinutes(planned.plan.session.activeElapsedMs) * 60_000,
    );
  }
  let uploadable = 0;
  let expired = 0;
  for (const createDate of pending.values()) {
    if (isTomatodoCloudUploadEligible(createDate, now)) uploadable += 1;
    else expired += 1;
  }
  return { total: pending.size, uploadable, expired };
}
