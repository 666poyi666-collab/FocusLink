import type {
  SyncV2AckStatus,
  SyncV2Conflict,
  SyncV2Mutation,
  SyncV2Payload,
} from '@shared/sync/v2Protocol';

/**
 * Local materialized Sync v2 conflict. The cloud keeps no conflict row for an
 * ordinary revision divergence, so this record carries the remote revision and
 * fingerprint the divergence was computed from; that pair is the only valid
 * base for a resolution mutation.
 */
export interface MobileV2ConflictRecord extends SyncV2Conflict {
  remoteRevision: number | null;
  remoteFingerprint: string | null;
}

export type MobileV2ConflictSide = 'local' | 'remote';

export interface MobileV2ConflictDifference {
  field: string;
  label: string;
  localValue: string;
  remoteValue: string;
}

export interface MobileV2ConflictPresentation {
  conflictId: string;
  entityTypeLabel: string;
  headline: string;
  reasonLabel: string;
  createdAt: number;
  differences: MobileV2ConflictDifference[];
  resolvable: boolean;
  blockedReason: string | null;
  localMissing: boolean;
  remoteMissing: boolean;
}

export interface MobileV2ConflictCheckpoint {
  boundDeviceId: string;
  accountGeneration: number;
}

export type MobileV2ConflictResolution =
  { ok: true; opId: string; mutation: SyncV2Mutation } | { ok: false; reason: string };

export type MobileV2ConflictResolutionOutcome = SyncV2AckStatus | 'queued' | 'missing';

const ENTITY_TYPE_LABELS: Record<string, string> = {
  focus_ledger_v2: '专注账本',
  focus_metadata_v2: '会话信息',
  focus_ledger_correction_v2: '账本修正',
  focus_guard_rule_v1: '不做手机控规则',
  focus_guard_state_v1: '不做手机控状态',
  focus_guard_completion_v1: '不做手机控完成记录',
  focus_guard_config_v1: '不做手机控配置',
};

const REASON_LABELS: Record<string, string> = {
  revision_rollback: '云端版本比本机已确认的还旧',
  same_revision_fingerprint_mismatch: '同一个版本号下两边内容不一致',
  payload: '两边都改了这一场，云端版本不同',
  deleted: '一边删除了这条记录，另一边还留着',
  remote_conflict: '云端与本机版本分叉',
};

const LEDGER_FIELDS = [
  { key: 'status', label: '结束状态', format: formatLedgerStatus },
  { key: 'startedAt', label: '开始时间', format: formatMoment },
  { key: 'endedAt', label: '结束时间', format: formatMoment },
  { key: 'activeElapsedMs', label: '专注时长', format: formatDuration },
  { key: 'pausedElapsedMs', label: '暂停时长', format: formatDuration },
  { key: 'wallElapsedMs', label: '实际时长', format: formatDuration },
  { key: 'segments', label: '分段数', format: formatCollectionSize },
  { key: 'pauses', label: '暂停次数', format: formatCollectionSize },
] as const;

const METADATA_FIELDS = [
  { key: 'title', label: '标题', format: formatText },
  { key: 'note', label: '备注', format: formatText },
  { key: 'subject', label: '科目', format: formatText },
  { key: 'tags', label: '标签', format: formatTags },
  { key: 'taskAssociation', label: '关联任务', format: formatTaskAssociation },
] as const;

export function normalizeMobileV2ConflictRecord(value: unknown): MobileV2ConflictRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.conflictId !== 'string' || record.conflictId.length === 0) return null;
  if (typeof record.entityType !== 'string' || typeof record.entityId !== 'string') return null;
  return {
    conflictId: record.conflictId,
    entityType: record.entityType as SyncV2Conflict['entityType'],
    entityId: record.entityId,
    base: (record.base as SyncV2Payload | null | undefined) ?? null,
    local: (record.local as SyncV2Payload | null | undefined) ?? null,
    remote: (record.remote as SyncV2Payload | null | undefined) ?? null,
    fields: asStringArray(record.fields),
    sourceDeviceIds: asStringArray(record.sourceDeviceIds),
    status: record.status === 'resolved' ? 'resolved' : 'open',
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    resolvedAt: typeof record.resolvedAt === 'number' ? record.resolvedAt : null,
    resolutionOpId: typeof record.resolutionOpId === 'string' ? record.resolutionOpId : null,
    remoteRevision: asFiniteNumber(record.remoteRevision),
    remoteFingerprint:
      typeof record.remoteFingerprint === 'string' && record.remoteFingerprint.length > 0
        ? record.remoteFingerprint
        : null,
  };
}

export function presentMobileV2Conflicts(
  records: readonly MobileV2ConflictRecord[],
): MobileV2ConflictPresentation[] {
  return records
    .filter((record) => record.status === 'open')
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
    .map((record) => presentMobileV2Conflict(record));
}

export function presentMobileV2Conflict(
  record: MobileV2ConflictRecord,
): MobileV2ConflictPresentation {
  const blockedReason = mobileV2ConflictBlockedReason(record);
  return {
    conflictId: record.conflictId,
    entityTypeLabel: ENTITY_TYPE_LABELS[record.entityType] ?? record.entityType,
    headline: conflictHeadline(record),
    reasonLabel:
      record.fields
        .map((field) => REASON_LABELS[field])
        .filter(Boolean)
        .join('、') || REASON_LABELS.remote_conflict,
    createdAt: record.createdAt,
    differences: describeMobileV2ConflictDifferences(record),
    resolvable: blockedReason === null,
    blockedReason,
    localMissing: record.local === null,
    remoteMissing: record.remote === null,
  };
}

/**
 * A conflict can be decided only when the remote revision is known and both
 * sides still describe the same entity type; otherwise the payload would be
 * rejected as conflict_entity_mismatch and the local row would stay open.
 */
export function mobileV2ConflictBlockedReason(record: MobileV2ConflictRecord): string | null {
  if (record.status !== 'open') return '这条冲突已经处理过，刷新后确认即可。';
  if (record.remoteRevision === null) return '本机还没拿到云端版本号，先刷新一次账本再选。';
  if (record.local !== null && !payloadMatchesEntityType(record.entityType, record.local)) {
    return '本机这份记录的类型和云端不一致，无法自动提交，请刷新后重试。';
  }
  if (record.remote !== null && !payloadMatchesEntityType(record.entityType, record.remote)) {
    return '云端这份记录的类型和本机不一致，无法自动提交，请刷新后重试。';
  }
  return null;
}

export function describeMobileV2ConflictDifferences(
  record: MobileV2ConflictRecord,
): MobileV2ConflictDifference[] {
  const rows: MobileV2ConflictDifference[] = [];
  if (record.local === null || record.remote === null) {
    rows.push({
      field: 'presence',
      label: '记录状态',
      localValue: record.local === null ? '本机已删除' : '本机保留',
      remoteValue: record.remote === null ? '云端已删除' : '云端保留',
    });
  }
  const local = asRecord(record.local);
  const remote = asRecord(record.remote);
  if (record.entityType === 'focus_ledger_v2') {
    for (const field of LEDGER_FIELDS) {
      appendDifference(rows, field, local?.[field.key], remote?.[field.key]);
    }
    return rows;
  }
  if (record.entityType === 'focus_metadata_v2') {
    for (const field of METADATA_FIELDS) {
      appendDifference(rows, field, local?.[field.key], remote?.[field.key]);
    }
    return rows;
  }
  if (local && remote) {
    rows.push({
      field: 'payload',
      label: '加密内容',
      localValue: '本机密文',
      remoteValue: '云端密文',
    });
  }
  return rows;
}

export function mobileV2ConflictResolutionOpId(
  conflictId: string,
  side: MobileV2ConflictSide,
): string {
  return `resolve:${conflictId}:${side}`;
}

/** Finds the conflict a resolution ACK belongs to without parsing free-form ids. */
export function findMobileV2ConflictForResolutionOpId(
  records: readonly MobileV2ConflictRecord[],
  opId: string,
): MobileV2ConflictRecord | null {
  for (const record of records) {
    if (record.status !== 'open') continue;
    if (
      mobileV2ConflictResolutionOpId(record.conflictId, 'local') === opId ||
      mobileV2ConflictResolutionOpId(record.conflictId, 'remote') === opId
    ) {
      return record;
    }
  }
  return null;
}

export function buildMobileV2ConflictResolution(input: {
  conflict: MobileV2ConflictRecord;
  side: MobileV2ConflictSide;
  checkpoint: MobileV2ConflictCheckpoint;
}): MobileV2ConflictResolution {
  const { conflict, side, checkpoint } = input;
  const blockedReason = mobileV2ConflictBlockedReason(conflict);
  if (blockedReason !== null) return { ok: false, reason: blockedReason };
  const payload = side === 'remote' ? conflict.remote : conflict.local;
  const opId = mobileV2ConflictResolutionOpId(conflict.conflictId, side);
  return {
    ok: true,
    opId,
    mutation: {
      opId,
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      kind: payload === null ? 'delete' : 'put',
      baseRevision: conflict.remoteRevision ?? 0,
      baseFingerprint: conflict.remoteFingerprint,
      payload,
      deviceId: checkpoint.boundDeviceId,
      accountGeneration: checkpoint.accountGeneration,
    },
  };
}

export function normalizeMobileV2ConflictResolutionOutcome(
  value: unknown,
): MobileV2ConflictResolutionOutcome {
  if (
    value === 'applied' ||
    value === 'duplicate' ||
    value === 'conflict' ||
    value === 'rejected'
  ) {
    return value;
  }
  return value === undefined || value === null ? 'missing' : 'queued';
}

export function describeMobileV2ConflictResolution(
  outcome: MobileV2ConflictResolutionOutcome,
  errorCode: string | null = null,
): string {
  switch (outcome) {
    case 'applied':
      return '已按你的选择收敛：云端接受这次版本，本机记录同步完成。';
    case 'duplicate':
      return '这次选择此前已提交过，云端确认是同一个版本，不用再重复。';
    case 'conflict':
      return '云端在你选择的同时又改了这条，冲突还在；刷新后按新的差异再选一次。';
    case 'rejected':
      return `云端拒绝了这次选择${errorCode ? `（${errorCode}）` : ''}；本机记录没有改动。`;
    case 'queued':
      return '选择已排队，连上云端后自动提交。';
    default:
      return '还没拿到云端的处理回执；同步跑完后再看结果。';
  }
}

function appendDifference(
  rows: MobileV2ConflictDifference[],
  field: { key: string; label: string; format: (value: unknown) => string },
  local: unknown,
  remote: unknown,
): void {
  if (sameValue(local, remote)) return;
  rows.push({
    field: field.key,
    label: field.label,
    localValue: field.format(local),
    remoteValue: field.format(remote),
  });
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function conflictHeadline(record: MobileV2ConflictRecord): string {
  const metadata = asRecord(record.local) ?? asRecord(record.remote) ?? asRecord(record.base);
  const title = metadata ? formatText(metadata.title) : '无标题';
  const subject = metadata ? formatText(metadata.subject) : '';
  const label = ENTITY_TYPE_LABELS[record.entityType] ?? record.entityType;
  return subject && subject !== '未填写'
    ? `${title} · ${subject} · ${label}`
    : `${title} · ${label}`;
}

function payloadMatchesEntityType(
  entityType: SyncV2Conflict['entityType'],
  payload: unknown,
): boolean {
  const record = asRecord(payload);
  if (!record) return false;
  if (entityType === 'focus_ledger_v2') {
    return (
      typeof record.sessionId === 'string' &&
      typeof record.startedAt === 'number' &&
      typeof record.activeElapsedMs === 'number' &&
      (record.status === 'finished' || record.status === 'aborted')
    );
  }
  if (entityType === 'focus_metadata_v2') {
    return (
      typeof record.sessionId === 'string' &&
      typeof record.updatedAt === 'number' &&
      typeof record.updatedByDeviceId === 'string'
    );
  }
  if (entityType === 'focus_ledger_correction_v2') {
    return typeof record.correctionId === 'string' && typeof record.before === 'object';
  }
  return typeof record.ciphertext === 'string';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatLedgerStatus(value: unknown): string {
  if (value === 'aborted') return '中途结束';
  return '正常结束';
}

function formatMoment(value: unknown): string {
  const moment = asFiniteNumber(value);
  if (moment === null) return '未记录';
  return new Date(moment).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDuration(value: unknown): string {
  const ms = asFiniteNumber(value);
  if (ms === null) return '未记录';
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

function formatCollectionSize(value: unknown): string {
  if (!Array.isArray(value)) return '未记录';
  return `${value.length} 条`;
}

function formatText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return '未填写';
  return value;
}

function formatTags(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '无标签';
  const names = value
    .map((tag) => (asRecord(tag) && typeof tag.name === 'string' ? tag.name : null))
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join('、') : '无标签';
}

function formatTaskAssociation(value: unknown): string {
  const record = asRecord(value);
  if (!record) return '未关联';
  const title = typeof record.title === 'string' && record.title.length > 0 ? record.title : null;
  const taskId = typeof record.taskId === 'string' ? record.taskId : null;
  if (!taskId) return '未关联';
  return title ?? taskId;
}
