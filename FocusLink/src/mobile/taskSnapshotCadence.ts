import { TASK_SNAPSHOT_REFRESH_INTERVAL_MS } from '@shared/sync/taskSnapshotProtocol';

/**
 * Idle cadence for the foreground task-snapshot poll.
 *
 * The first two ticks stay at the 5 s contract interval: right after a change (or after the app
 * returns to the foreground) another device is likely to publish again. Once consecutive reads
 * answer "unchanged" the register clearly is not moving, so the poll widens instead of asking the
 * cloud every 5 s for the whole session. Every widened tick is still a conditional read, so the
 * cost that grows with the delay is the wake-up itself, not the payload.
 */
export const MOBILE_TASK_SNAPSHOT_IDLE_DELAYS_MS = [
  TASK_SNAPSHOT_REFRESH_INTERVAL_MS,
  TASK_SNAPSHOT_REFRESH_INTERVAL_MS,
  15_000,
  30_000,
] as const;

/** Keeps the idle streak bounded; the ceiling delay is what actually holds the poll still. */
export const MOBILE_TASK_SNAPSHOT_MAX_IDLE_STREAK = 12;

export type MobileTaskSnapshotOutcome = 'unchanged' | 'changed' | 'failed';

/** Delay before the next foreground poll, derived only from how long the register has been still. */
export function nextMobileTaskSnapshotDelayMs(unchangedStreak: number): number {
  const streak = Number.isFinite(unchangedStreak) ? Math.max(0, Math.floor(unchangedStreak)) : 0;
  const index = Math.min(streak, MOBILE_TASK_SNAPSHOT_IDLE_DELAYS_MS.length - 1);
  return MOBILE_TASK_SNAPSHOT_IDLE_DELAYS_MS[index];
}

/**
 * `changed` restarts the fast cadence because somebody (this device or another one) just wrote.
 * `failed` keeps the current streak: a failing poll must not silently slow down to the ceiling.
 */
export function advanceMobileTaskSnapshotStreak(
  unchangedStreak: number,
  outcome: MobileTaskSnapshotOutcome,
): number {
  const streak = Number.isFinite(unchangedStreak) ? Math.max(0, Math.floor(unchangedStreak)) : 0;
  if (outcome === 'changed') return 0;
  if (outcome === 'failed') return Math.min(streak, MOBILE_TASK_SNAPSHOT_MAX_IDLE_STREAK);
  return Math.min(streak + 1, MOBILE_TASK_SNAPSHOT_MAX_IDLE_STREAK);
}
