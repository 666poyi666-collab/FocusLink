import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  MOBILE_TICK_ALIGN_SLACK_MS,
  createMobileSecondTicker,
  isMobileForegroundActive,
  nextMobileSecondBoundaryDelay,
} from '../src/mobile/backgroundPolicy';

const readSource = (...segments: string[]) =>
  fs.readFileSync(path.join(process.cwd(), 'src', 'mobile', ...segments), 'utf8');

function host() {
  return {
    now: () => Date.now(),
    setTimeout: (callback: () => void, delayMs: number) =>
      globalThis.setTimeout(callback, delayMs) as unknown as number,
    clearTimeout: (handle: number) => globalThis.clearTimeout(handle),
  };
}

describe('mobile foreground policy', () => {
  it('requires both the capacitor app state and the document to agree', () => {
    expect(isMobileForegroundActive({ appActive: true, documentVisible: true })).toBe(true);
    // OEM builds report a visible WebView while the app sits behind another app, and a
    // live Capacitor app behind the lock screen; either one alone is not foreground.
    expect(isMobileForegroundActive({ appActive: false, documentVisible: true })).toBe(false);
    expect(isMobileForegroundActive({ appActive: true, documentVisible: false })).toBe(false);
    expect(isMobileForegroundActive({ appActive: false, documentVisible: false })).toBe(false);
  });

  it('aligns the next hop to the wall-clock second with a small slack', () => {
    expect(MOBILE_TICK_ALIGN_SLACK_MS).toBe(12);
    expect(nextMobileSecondBoundaryDelay(0)).toBe(1_012);
    expect(nextMobileSecondBoundaryDelay(500)).toBe(512);
    expect(nextMobileSecondBoundaryDelay(999)).toBe(13);
    expect(nextMobileSecondBoundaryDelay(1_000)).toBe(1_012);
    expect(nextMobileSecondBoundaryDelay(1_234)).toBe(778);
    expect(nextMobileSecondBoundaryDelay(-500)).toBe(512);
    expect(nextMobileSecondBoundaryDelay(500, 0)).toBe(500);
  });
});

describe('mobile second ticker', () => {
  it('ticks immediately on activation and then once per aligned second', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const ticks: number[] = [];
      const ticker = createMobileSecondTicker(host(), (now) => ticks.push(now));
      ticker.setGate({ active: true, appActive: true, documentVisible: true });
      expect(ticks).toEqual([0]);
      expect(ticker.isRunning()).toBe(true);
      expect(ticker.tickCount()).toBe(1);

      vi.advanceTimersByTime(1_012);
      expect(ticks).toEqual([0, 1_012]);
      vi.advanceTimersByTime(1_000);
      expect(ticks).toEqual([0, 1_012, 2_012]);
      expect(ticker.tickCount()).toBe(3);
      ticker.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the timer chain while the app is backgrounded and realigns on resume', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const ticks: number[] = [];
      const ticker = createMobileSecondTicker(host(), (now) => ticks.push(now));
      ticker.setGate({ active: true, appActive: true, documentVisible: true });
      expect(ticks).toHaveLength(1);

      ticker.setGate({ active: true, appActive: false, documentVisible: true });
      expect(ticker.isRunning()).toBe(false);
      vi.advanceTimersByTime(60_000);
      expect(ticks).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);

      ticker.setGate({ active: true, appActive: true, documentVisible: true });
      expect(ticks).toHaveLength(2);
      // Resumed exactly on a second boundary, so the realigned hop waits one full second.
      vi.advanceTimersByTime(1_012);
      expect(ticks).toHaveLength(3);
      ticker.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a hop whose gate closed before it fired', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const ticks: number[] = [];
      const ticker = createMobileSecondTicker(host(), (now) => ticks.push(now));
      ticker.setGate({ active: true, appActive: true, documentVisible: true });
      vi.advanceTimersByTime(400);
      ticker.setGate({ active: true, appActive: true, documentVisible: false });
      vi.advanceTimersByTime(5_000);
      expect(ticks).toHaveLength(1);
      ticker.dispose();
      vi.advanceTimersByTime(5_000);
      expect(ticks).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never ticks for an idle session', () => {
    vi.useFakeTimers();
    try {
      const ticks: number[] = [];
      const ticker = createMobileSecondTicker(host(), (now) => ticks.push(now));
      ticker.setGate({ active: false, appActive: true, documentVisible: true });
      vi.advanceTimersByTime(10_000);
      expect(ticks).toHaveLength(0);
      expect(ticker.isRunning()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('mobile background cost wiring', () => {
  const consoleSource = readSource('FocusConsole.tsx');
  const appSource = readSource('MobileApp.tsx');
  const controlsSource = readSource('NativeSystemControls.tsx');
  const settingsSource = readSource('SettingsView.tsx');

  it('drives the console readout from the gated ticker instead of a self-rescheduling timer', () => {
    expect(consoleSource).toContain('createMobileSecondTicker');
    expect(consoleSource).toContain('ticker.setGate({ active, appActive, documentVisible })');
    expect(consoleSource).toContain('return () => ticker.dispose();');
    expect(consoleSource).not.toContain('const delay = 1_000 - (Date.now() % 1_000) + 12;');
    expect(consoleSource).toContain('appActive = true,');
    expect(consoleSource).toContain('documentVisible = true,');
  });

  it('gates the task snapshot and native queue intervals on the shared foreground flag', () => {
    expect(appSource).toContain("import { isMobileForegroundActive } from './backgroundPolicy';");
    expect(appSource).toContain(
      'const foregroundActive = isMobileForegroundActive({ appActive, documentVisible });',
    );
    expect(appSource).toContain('const stopInterval = foregroundActive');
    expect(appSource).toContain('const interval = foregroundActive');
    expect(appSource.match(/foregroundActive/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it('polls the native settings card only while it is actually in front', () => {
    expect(controlsSource).toContain('foregroundActive = true');
    expect(controlsSource).toContain('if (!available || !foregroundActive) return;');
    expect(controlsSource).not.toContain('readWhenVisible');
    expect(settingsSource).toContain(
      '<NativeSystemControls foregroundActive={foregroundActive} />',
    );
  });
});
