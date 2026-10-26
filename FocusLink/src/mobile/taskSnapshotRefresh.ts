import { TASK_SNAPSHOT_REFRESH_INTERVAL_MS } from '@shared/sync/taskSnapshotProtocol';
import {
  createMobileAccountRequestLifecycle,
  type MobileAccountRequestLease,
  type MobileAccountRequestLifecycle,
} from './accountLifecycle';

export type TaskSnapshotRequestLease = MobileAccountRequestLease;
export type TaskSnapshotRequestLifecycle = MobileAccountRequestLifecycle;

export function createTaskSnapshotRequestLifecycle(): TaskSnapshotRequestLifecycle {
  return createMobileAccountRequestLifecycle();
}

export interface TaskSnapshotCadenceSource {
  /** Delay before the next poll; re-read after every tick so the cadence can widen or reset. */
  delayMs(): number;
}

/**
 * Foreground task-snapshot poll.
 *
 * A self-scheduling timeout instead of a fixed interval: the elapsed cadence is a property of the
 * cloud register, not of this timer, so every tick asks the caller for the next delay. The poll
 * keeps ticking while the app is hidden — it simply skips the refresh — so a foreground transition
 * does not have to rebuild the timer, and the first visible tick still honours the current delay.
 */
export function startVisibleTaskSnapshotRefresh(
  refresh: () => void,
  isVisible: () => boolean,
  cadence?: TaskSnapshotCadenceSource,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const nextDelay = () => {
    const configured = cadence ? cadence.delayMs() : TASK_SNAPSHOT_REFRESH_INTERVAL_MS;
    return Number.isFinite(configured) && configured > 0
      ? configured
      : TASK_SNAPSHOT_REFRESH_INTERVAL_MS;
  };
  const schedule = () => {
    if (stopped) return;
    timer = globalThis.setTimeout(() => {
      timer = null;
      if (stopped) return;
      if (isVisible()) refresh();
      schedule();
    }, nextDelay());
  };
  schedule();
  return () => {
    stopped = true;
    if (timer !== null) {
      globalThis.clearTimeout(timer);
      timer = null;
    }
  };
}
