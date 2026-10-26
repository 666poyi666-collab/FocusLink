import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOBILE_TASK_SNAPSHOT_IDLE_DELAYS_MS,
  MOBILE_TASK_SNAPSHOT_MAX_IDLE_STREAK,
  advanceMobileTaskSnapshotStreak,
  nextMobileTaskSnapshotDelayMs,
} from '../src/mobile/taskSnapshotCadence';
import { startVisibleTaskSnapshotRefresh } from '../src/mobile/taskSnapshotRefresh';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('mobile task snapshot idle cadence policy', () => {
  it('starts at the 5 s contract interval and widens to 15 s then 30 s', () => {
    expect(MOBILE_TASK_SNAPSHOT_IDLE_DELAYS_MS).toEqual([5_000, 5_000, 15_000, 30_000]);
    expect([0, 1, 2, 3, 4, 40].map(nextMobileTaskSnapshotDelayMs)).toEqual([
      5_000, 5_000, 15_000, 30_000, 30_000, 30_000,
    ]);
  });

  it('treats garbage streaks as zero instead of scheduling a broken timer', () => {
    expect(nextMobileTaskSnapshotDelayMs(-3)).toBe(5_000);
    expect(nextMobileTaskSnapshotDelayMs(Number.NaN)).toBe(5_000);
    expect(nextMobileTaskSnapshotDelayMs(Number.POSITIVE_INFINITY)).toBe(5_000);
    expect(nextMobileTaskSnapshotDelayMs(2.7)).toBe(15_000);
  });

  it('grows the streak on unchanged, resets it on a write and never lets a failure slow it down', () => {
    expect(advanceMobileTaskSnapshotStreak(0, 'unchanged')).toBe(1);
    expect(advanceMobileTaskSnapshotStreak(1, 'unchanged')).toBe(2);
    expect(advanceMobileTaskSnapshotStreak(7, 'changed')).toBe(0);
    expect(advanceMobileTaskSnapshotStreak(7, 'failed')).toBe(7);
    expect(advanceMobileTaskSnapshotStreak(MOBILE_TASK_SNAPSHOT_MAX_IDLE_STREAK, 'unchanged')).toBe(
      MOBILE_TASK_SNAPSHOT_MAX_IDLE_STREAK,
    );
  });
});

describe('mobile task snapshot adaptive scheduler', () => {
  it('honours the widening delays the cadence source reports', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let streak = 0;
    const ticks: number[] = [];
    const refresh = vi.fn(() => {
      ticks.push(Date.now());
      streak = advanceMobileTaskSnapshotStreak(streak, 'unchanged');
    });
    const stop = startVisibleTaskSnapshotRefresh(refresh, () => true, {
      delayMs: () => nextMobileTaskSnapshotDelayMs(streak),
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ticks).toEqual([5_000]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ticks).toEqual([5_000, 10_000]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ticks).toEqual([5_000, 10_000, 25_000]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ticks).toEqual([5_000, 10_000, 25_000, 55_000]);
    stop();
  });

  it('snaps back to 5 s as soon as a read reports a write', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let streak = MOBILE_TASK_SNAPSHOT_MAX_IDLE_STREAK;
    const ticks: number[] = [];
    const refresh = vi.fn(() => {
      ticks.push(Date.now());
      streak = advanceMobileTaskSnapshotStreak(streak, 'changed');
    });
    const stop = startVisibleTaskSnapshotRefresh(refresh, () => true, {
      delayMs: () => nextMobileTaskSnapshotDelayMs(streak),
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(ticks).toEqual([30_000]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ticks).toEqual([30_000, 35_000]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ticks).toEqual([30_000, 35_000, 40_000]);
    stop();
  });

  it('keeps ticking while hidden, skips the refresh and stops cleanly', async () => {
    vi.useFakeTimers();
    let visible = true;
    const refresh = vi.fn();
    const stop = startVisibleTaskSnapshotRefresh(refresh, () => visible, {
      delayMs: () => 5_000,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    visible = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    visible = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('falls back to the contract interval when the cadence source reports nonsense', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const stop = startVisibleTaskSnapshotRefresh(refresh, () => true, {
      delayMs: () => Number.NaN,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('mobile task snapshot cadence wiring', () => {
  it('drives the foreground poll from the streak and resets it on foreground', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(path.resolve(__dirname, '../src/mobile/MobileApp.tsx'), 'utf8');
    expect(source).toContain('advanceMobileTaskSnapshotStreak(');
    expect(source).toContain('nextMobileTaskSnapshotDelayMs(');
    expect(source).toContain('taskSnapshotCadence.current.unchangedStreak');
    expect(source).toMatch(
      /if \(foregroundActive\) taskSnapshotCadence\.current\.unchangedStreak = 0;/,
    );
    expect(source).toMatch(/delayMs: \(\) =>/);
    expect(source).toContain('advanceMobileTaskSnapshotStreak(');
    const scheduler = fs.readFileSync(
      path.resolve(__dirname, '../src/mobile/taskSnapshotRefresh.ts'),
      'utf8',
    );
    expect(scheduler).toContain('globalThis.setTimeout');
    expect(scheduler).not.toContain('setInterval');
  });
});
