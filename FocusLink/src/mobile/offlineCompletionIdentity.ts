import type { DeviceSyncSessionBundle } from '@shared/sync/deviceProtocol';
import { validateDeviceSyncBundle } from '@shared/sync/deviceProtocol';

/**
 * Completion identity for one offline session.
 *
 * A session can be ended more than once on the same device: a crashed commit
 * leaves the draft in IndexedDB while the native outbox already holds the first
 * payload. Both delivery channels derive their operation ids from the payload,
 * so a recomputed `endedAt` produces a second operation for the same entity and
 * the server rejects it as `revision_conflict`. The first completed payload is
 * therefore frozen per session id and reused by every later retry.
 */
export interface FrozenOfflineCompletion {
  sessionId: string;
  /** Mirrors `bundle.session.endedAt`; completed sessions normally carry a number. */
  endedAt: number | null;
  bundle: DeviceSyncSessionBundle;
  frozenAt: number;
}

/** Minimal queue projection the notice text depends on. */
export interface CompletionQueueRecord {
  state: 'pending' | 'uploading' | 'retry' | 'conflict' | 'rejected';
}

export type NativeCompletionOutcome =
  'queued' | 'duplicate' | 'unavailable' | 'identity-conflict' | 'stale-lease' | 'failed';

export interface FrozenCompletionResolution {
  freeze: FrozenOfflineCompletion;
  reused: boolean;
}

export interface NativeCompletionProbe {
  available: boolean;
  queued: boolean;
  error?: unknown;
}

/**
 * First completion wins. A retry that recomputed `endedAt` (because the draft
 * survived a failed commit) must keep the payload the native outbox and the
 * canonical outbox already recorded, otherwise the two channels disagree and
 * the entity never converges.
 */
export function resolveFrozenCompletion(input: {
  existing: FrozenOfflineCompletion | null;
  bundle: DeviceSyncSessionBundle;
  frozenAt: number;
}): FrozenCompletionResolution {
  const existing = input.existing;
  if (existing && isFrozenOfflineCompletion(existing)) {
    const stored = existing.bundle;
    if (
      existing.sessionId === input.bundle.session.id &&
      stored.session.id === existing.sessionId &&
      existing.endedAt === stored.session.endedAt &&
      validateDeviceSyncBundle(stored).ok
    ) {
      return { freeze: existing, reused: true };
    }
  }
  return {
    freeze: {
      sessionId: input.bundle.session.id,
      endedAt: input.bundle.session.endedAt,
      bundle: input.bundle,
      frozenAt: input.frozenAt,
    },
    reused: false,
  };
}

export function isFrozenOfflineCompletion(value: unknown): value is FrozenOfflineCompletion {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<FrozenOfflineCompletion>;
  return (
    typeof record.sessionId === 'string' &&
    record.sessionId.length > 0 &&
    (record.endedAt === null ||
      (typeof record.endedAt === 'number' && Number.isFinite(record.endedAt))) &&
    typeof record.frozenAt === 'number' &&
    Number.isFinite(record.frozenAt) &&
    !!record.bundle &&
    typeof record.bundle === 'object' &&
    record.bundle.session?.id === record.sessionId
  );
}

/**
 * The native bridge used to collapse "not running on Android", "the lease is
 * stale", and "this bundle id already exists with another payload" into
 * `false`, which was then reported to the user as a safe save. Keep the
 * distinctions; the caller decides what to tell the user.
 */
export function classifyNativeCompletion(probe: NativeCompletionProbe): NativeCompletionOutcome {
  if (probe.error !== undefined) {
    if (isNativeIdentityConflict(probe.error)) return 'identity-conflict';
    if (isNativeStaleLease(probe.error)) return 'stale-lease';
    return 'failed';
  }
  if (!probe.available) return 'unavailable';
  return probe.queued ? 'queued' : 'duplicate';
}

export function offlineCompletionNotice(input: {
  native: NativeCompletionOutcome;
  pending: CompletionQueueRecord | null;
}): string {
  const pending = input.pending;
  if (!pending) {
    if (input.native === 'queued') {
      return '原生后台已排队，但本机浏览器存储写入失败；草稿已保留，前台恢复后会重试';
    }
    if (input.native === 'duplicate') {
      return '原生后台已有同一会话记录，但本机浏览器存储写入失败；草稿已保留';
    }
    if (input.native === 'identity-conflict') {
      return '原生队列已有同一会话的另一份内容，且本机浏览器存储写入失败；草稿已保留';
    }
    return '离线会话尚未写入本机上传队列，草稿已保留；请留在本页重试结束';
  }
  if (pending.state === 'conflict' || pending.state === 'rejected') {
    return '离线会话已保存，但需要先处理同步冲突才能补传';
  }
  switch (input.native) {
    case 'queued':
      return '离线会话已安全保存；联网后自动补传';
    case 'duplicate':
      return '该会话此前已保存，本次未重复排队；联网后自动补传';
    case 'identity-conflict':
      return '该会话按最早一次结束保存，本次未重复写入；联网后自动补传';
    case 'unavailable':
      return '已保存到本机浏览器存储；联网后自动补传';
    case 'stale-lease':
      return '已保存到本机浏览器存储；账号连接已变化，补传需重新配对';
    default:
      return '已保存到本机浏览器存储；原生后台队列写入失败，前台恢复后重试';
  }
}

export function isNativeIdentityConflict(error: unknown): boolean {
  return /identity already exists/i.test(describeError(error));
}

export function isNativeStaleLease(error: unknown): boolean {
  if (error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError') {
    return true;
  }
  return /账号连接已变化|connection lease/i.test(describeError(error));
}

function describeError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; code?: unknown };
    if (typeof record.message === 'string') return record.message;
    if (typeof record.code === 'string') return record.code;
  }
  return '';
}
