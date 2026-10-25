/**
 * De-duplication policy for mobile ledger pulls.
 *
 * The ledger pull is expensive (two round trips plus an IndexedDB write phase)
 * and it is triggered from several independent places: the resume/connection
 * effect, the retry timer, native command completions and the manual refresh
 * button. Those triggers can fire within the same second — a foreground resume
 * bumps the connection epoch, the sync effect re-runs because the pull callback
 * itself was rebuilt, and a drained native command finishes right after that.
 *
 * The coalescer in `createMobileAccountRequestCoalescer` already shares one
 * in-flight pull per connection, so the only duplicate this module removes is
 * the *serial* one: a pull that starts right after another one already
 * finished with the same connection and, for resume-driven triggers, a pull
 * that starts so soon after the previous one that nothing new can be on the
 * server yet.
 *
 * Rules, deliberately narrow:
 * - A different connection always pulls; switching accounts must never be
 *   served from another account's freshness window.
 * - `manual` and `retry` are never dropped. A user refresh and the backoff
 *   timer are explicit, and an in-flight pull for the same connection is joined
 *   by the coalescer rather than duplicated.
 * - `foreground` is skipped while a pull is in flight, and skipped when the
 *   previous pull for the same connection started less than
 *   `MOBILE_LEDGER_PULL_FRESH_MS` ago. A resume storm is the noisy case here.
 * - `command` is only skipped while a pull is in flight. A finished native
 *   command means the ledger really changed, so a recent pull cannot be
 *   assumed to contain it.
 *
 * An `in-flight` skip is not a drop: the caller joins the running pull and
 * replays the trigger once it settles, so nothing that arrived during the
 * request is lost. Only the resume-shaped `fresh` skip discards a trigger.
 */

export type MobileLedgerPullReason = 'manual' | 'retry' | 'foreground' | 'command';

export interface MobileLedgerPullTrace {
  connectionKey: string;
  startedAt: number;
  /** `null` while the pull is still running. */
  finishedAt: number | null;
}

export type MobileLedgerPullSkipReason = 'in-flight' | 'fresh';

export interface MobileLedgerPullDecision {
  start: boolean;
  skipReason: MobileLedgerPullSkipReason | null;
}

/** A resume-driven pull this soon after the previous one is treated as duplicate. */
export const MOBILE_LEDGER_PULL_FRESH_MS = 1_500;

export interface DecideMobileLedgerPullInput {
  reason: MobileLedgerPullReason;
  connectionKey: string;
  now: number;
  trace: MobileLedgerPullTrace | null;
}

export function decideMobileLedgerPull(
  input: DecideMobileLedgerPullInput,
): MobileLedgerPullDecision {
  const { reason, connectionKey, now, trace } = input;
  if (!trace || trace.connectionKey !== connectionKey) {
    return { start: true, skipReason: null };
  }
  if (reason === 'manual' || reason === 'retry') {
    return { start: true, skipReason: null };
  }
  if (trace.finishedAt === null) {
    return { start: false, skipReason: 'in-flight' };
  }
  if (reason === 'foreground' && now - trace.startedAt < MOBILE_LEDGER_PULL_FRESH_MS) {
    return { start: false, skipReason: 'fresh' };
  }
  return { start: true, skipReason: null };
}

/**
 * Whether the native command queue may run at all. Backgrounded apps must not
 * drain, send, or rewrite snapshots; the queue stays durable in the native
 * store and is drained on the next visible resume.
 */
export function shouldDrainNativeCommands(input: {
  appActive: boolean;
  documentVisible: boolean;
  liveConnection: boolean;
  offlineRuntime: boolean;
}): boolean {
  if (!input.appActive) return false;
  if (!input.documentVisible) return false;
  if (!input.liveConnection) return false;
  if (input.offlineRuntime) return false;
  return true;
}
