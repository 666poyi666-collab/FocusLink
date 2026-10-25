import type { SyncV2ClientErrorCode } from '@shared/sync/v2ClientError';

/**
 * A single pure retry policy for the mobile canonical Sync v2 loop.
 *
 * The old behaviour retried every failure after a fixed 30 s with no ceiling:
 * a throttled or broken cloud was hammered forever, and a permanent contract
 * mismatch looked identical to a flaky network. This module separates the two
 * questions the caller actually needs answered:
 *   1. is this failure worth retrying at all (code based, never message based)
 *   2. how long to wait before the next attempt (exponential, server hint aware)
 *
 * The policy is intentionally deterministic: no random jitter, so a durable
 * retry timestamp can be asserted in tests and replayed on every device.
 */
export const MOBILE_V2_RETRY_BASE_MS = 15_000;
export const MOBILE_V2_RETRY_CAP_MS = 15 * 60_000;
/** A mutation that keeps failing is parked at the cap, never silently dropped. */
export const MOBILE_V2_RETRY_MAX_ATTEMPTS = 12;
const RETRY_AFTER_MIN_MS = 1_000;
const RETRY_AFTER_MAX_MS = 5 * 60_000;

export interface MobileV2RetryDecision {
  code: SyncV2ClientErrorCode;
  /** 1-based: the attempt that just failed. */
  attempt: number;
  retryable: boolean;
  /** The attempt budget is spent; waiting continues at the cap. */
  exhausted: boolean;
  delayMs: number;
}

const RETRYABLE_CODES: readonly SyncV2ClientErrorCode[] = [
  'network_error',
  'timeout',
  'rate_limited',
  'server_error',
  'sync_failed',
];

export function isRetryableMobileV2Failure(code: SyncV2ClientErrorCode): boolean {
  return RETRYABLE_CODES.includes(code);
}

/**
 * Exponential backoff: 15 s, 30 s, 60 s, … capped at 15 min.
 * A server `Retry-After` is a floor (never a shortening of our own backoff) and
 * is clamped to 1 s … 5 min so a bogus header cannot pin the device for a week.
 */
export function mobileV2RetryDelayMs(attempt: number, retryAfterMs: number | null = null): number {
  const safeAttempt = Number.isSafeInteger(attempt) && attempt > 0 ? Math.min(attempt, 64) : 1;
  const backoff = Math.min(
    MOBILE_V2_RETRY_CAP_MS,
    MOBILE_V2_RETRY_BASE_MS * 2 ** (safeAttempt - 1),
  );
  if (retryAfterMs === null || !Number.isSafeInteger(retryAfterMs) || retryAfterMs <= 0) {
    return backoff;
  }
  const hinted = Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, retryAfterMs));
  return Math.min(MOBILE_V2_RETRY_CAP_MS, Math.max(backoff, hinted));
}

export function decideMobileV2Retry(input: {
  code: SyncV2ClientErrorCode;
  /** Highest attempt count already recorded for the claimed outbox rows. */
  attemptCount?: number;
  /** HTTP `Retry-After` forwarded by the transport, if the server sent one. */
  retryAfterMs?: number | null;
}): MobileV2RetryDecision {
  const attemptCount =
    Number.isSafeInteger(input.attemptCount) && (input.attemptCount ?? 0) > 0
      ? Number(input.attemptCount)
      : 0;
  const attempt = attemptCount + 1;
  const retryable = isRetryableMobileV2Failure(input.code);
  const exhausted = attempt > MOBILE_V2_RETRY_MAX_ATTEMPTS;
  return {
    code: input.code,
    attempt,
    retryable,
    exhausted,
    // A terminal failure is parked at the cap instead of being retried on the
    // network cadence; only an explicit user action or a new pairing clears it.
    delayMs: retryable
      ? mobileV2RetryDelayMs(attempt, input.retryAfterMs ?? null)
      : MOBILE_V2_RETRY_CAP_MS,
  };
}

/** Human copy for the retry wait; used by both the ledger notice and settings. */
export function describeMobileV2RetryWait(delayMs: number): string {
  const safe = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
  if (safe < 60_000) return `约 ${Math.max(1, Math.round(safe / 1_000))} 秒后自动重试`;
  return `约 ${Math.max(1, Math.round(safe / 60_000))} 分钟后自动重试`;
}
