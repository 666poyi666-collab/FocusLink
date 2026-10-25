/**
 * Foreground gating for mobile timers.
 *
 * A phone that is locked or in the background must not keep waking its WebView on a
 * timer: the work either resumes from durable state or is not needed at all. Every
 * periodic reader therefore asks the same question — "is this device actually in front
 * of the user right now?" — instead of re-deriving it from two separate signals.
 */

export interface MobileForegroundSignals {
  appActive: boolean;
  documentVisible: boolean;
}

/**
 * Single source of truth for foreground work. Capacitor's appStateChange and the DOM
 * visibilityState disagree often enough on OEM Android builds (and WebView reports
 * `visible` while the app is behind the lock screen) that both must agree.
 */
export function isMobileForegroundActive(signals: MobileForegroundSignals): boolean {
  return signals.appActive && signals.documentVisible;
}

/** Extra delay after the next wall-clock second so the readout never lags the clock. */
export const MOBILE_TICK_ALIGN_SLACK_MS = 12;

/**
 * Delay until the next whole second plus a small slack. Scheduling against the wall clock
 * (instead of a fixed 1000 ms) keeps the readout from drifting out of step with the
 * server-provided timestamps.
 */
export function nextMobileSecondBoundaryDelay(
  now: number,
  slackMs: number = MOBILE_TICK_ALIGN_SLACK_MS,
): number {
  const remainder = ((Math.floor(now) % 1_000) + 1_000) % 1_000;
  return 1_000 - remainder + slackMs;
}

export interface MobileSecondTickerHost {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export interface MobileSecondTickerGate {
  /** The session is visible and running; idle sessions have nothing to count. */
  active: boolean;
  appActive: boolean;
  documentVisible: boolean;
}

export interface MobileSecondTicker {
  setGate(gate: MobileSecondTickerGate): void;
  isRunning(): boolean;
  tickCount(): number;
  dispose(): void;
}

/**
 * A once-per-second ticker that stops itself entirely while the app is not in front.
 * Backgrounding clears the pending hop instead of leaving a chain of wake-ups that each
 * return early; resuming ticks immediately so the readout realigns before the next second.
 */
export function createMobileSecondTicker(
  host: MobileSecondTickerHost,
  onTick: (now: number) => void,
): MobileSecondTicker {
  let gate: MobileSecondTickerGate = { active: false, appActive: true, documentVisible: true };
  let handle: number | null = null;
  let ticks = 0;
  let disposed = false;

  const shouldRun = (): boolean => !disposed && gate.active && isMobileForegroundActive(gate);

  const clear = (): void => {
    if (handle === null) return;
    host.clearTimeout(handle);
    handle = null;
  };

  const schedule = (): void => {
    handle = host.setTimeout(() => {
      handle = null;
      // The gate can close between scheduling and firing; never tick on a stale hop.
      if (!shouldRun()) return;
      ticks += 1;
      onTick(host.now());
      schedule();
    }, nextMobileSecondBoundaryDelay(host.now()));
  };

  const sync = (): void => {
    if (!shouldRun()) {
      clear();
      return;
    }
    if (handle !== null) return;
    ticks += 1;
    onTick(host.now());
    schedule();
  };

  return {
    setGate(next) {
      gate = {
        active: next.active,
        appActive: next.appActive,
        documentVisible: next.documentVisible,
      };
      sync();
    },
    isRunning: () => handle !== null,
    tickCount: () => ticks,
    dispose() {
      disposed = true;
      clear();
    },
  };
}
