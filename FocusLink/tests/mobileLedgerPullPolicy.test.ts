import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MOBILE_LEDGER_PULL_FRESH_MS,
  decideMobileLedgerPull,
  shouldDrainNativeCommands,
  type MobileLedgerPullTrace,
} from '../src/mobile/ledgerPullPolicy';

const SEPARATOR = String.fromCharCode(0);
const CONNECTION = 'https://sync.example.test' + SEPARATOR + 'token-a';
const OTHER_CONNECTION = 'https://sync.example.test' + SEPARATOR + 'token-b';

function trace(overrides: Partial<MobileLedgerPullTrace> = {}): MobileLedgerPullTrace {
  return { connectionKey: CONNECTION, startedAt: 10_000, finishedAt: 11_000, ...overrides };
}

function sourceOf(relative: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

describe('mobile ledger pull de-duplication', () => {
  it('always starts the first pull', () => {
    const decision = decideMobileLedgerPull({
      reason: 'foreground',
      connectionKey: CONNECTION,
      now: 1,
      trace: null,
    });
    expect(decision.start).toBe(true);
  });

  it('starts for a different connection even when the previous one is in flight', () => {
    const decision = decideMobileLedgerPull({
      reason: 'foreground',
      connectionKey: OTHER_CONNECTION,
      now: 10_500,
      trace: trace({ finishedAt: null }),
    });
    expect(decision.start).toBe(true);
    expect(decision.skipReason).toBeNull();
  });

  it('joins an in-flight pull for a resume trigger instead of duplicating it', () => {
    const decision = decideMobileLedgerPull({
      reason: 'foreground',
      connectionKey: CONNECTION,
      now: 10_500,
      trace: trace({ finishedAt: null }),
    });
    expect(decision.start).toBe(false);
    expect(decision.skipReason).toBe('in-flight');
  });

  it('joins an in-flight pull for a native command trigger', () => {
    const decision = decideMobileLedgerPull({
      reason: 'command',
      connectionKey: CONNECTION,
      now: 10_500,
      trace: trace({ finishedAt: null }),
    });
    expect(decision.start).toBe(false);
    expect(decision.skipReason).toBe('in-flight');
  });

  it('never drops an explicit manual refresh or the retry timer', () => {
    for (const reason of ['manual', 'retry'] as const) {
      expect(
        decideMobileLedgerPull({
          reason,
          connectionKey: CONNECTION,
          now: 10_100,
          trace: trace({ finishedAt: null }),
        }),
      ).toEqual({ start: true, skipReason: null });
    }
  });

  it('skips a resume pull that starts inside the freshness window', () => {
    const decision = decideMobileLedgerPull({
      reason: 'foreground',
      connectionKey: CONNECTION,
      now: 10_000 + MOBILE_LEDGER_PULL_FRESH_MS - 1,
      trace: trace({ finishedAt: 10_400 }),
    });
    expect(decision.start).toBe(false);
    expect(decision.skipReason).toBe('fresh');
  });

  it('starts a resume pull at or after the freshness window', () => {
    for (const now of [10_000 + MOBILE_LEDGER_PULL_FRESH_MS, 20_000]) {
      expect(
        decideMobileLedgerPull({
          reason: 'foreground',
          connectionKey: CONNECTION,
          now,
          trace: trace({ finishedAt: 10_400 }),
        }).start,
      ).toBe(true);
    }
  });

  it('never applies the freshness window to a native command', () => {
    expect(
      decideMobileLedgerPull({
        reason: 'command',
        connectionKey: CONNECTION,
        now: 10_050,
        trace: trace({ finishedAt: 10_040 }),
      }),
    ).toEqual({ start: true, skipReason: null });
  });

  it('reports the exact freshness window as a millisecond budget', () => {
    expect(MOBILE_LEDGER_PULL_FRESH_MS).toBe(1_500);
  });
});

describe('mobile native command drain gate', () => {
  const base = {
    appActive: true,
    documentVisible: true,
    liveConnection: true,
    offlineRuntime: false,
  };

  it('drains only while active, visible, live and cloud-authoritative', () => {
    expect(shouldDrainNativeCommands(base)).toBe(true);
    expect(shouldDrainNativeCommands({ ...base, appActive: false })).toBe(false);
    expect(shouldDrainNativeCommands({ ...base, documentVisible: false })).toBe(false);
    expect(shouldDrainNativeCommands({ ...base, liveConnection: false })).toBe(false);
    expect(shouldDrainNativeCommands({ ...base, offlineRuntime: true })).toBe(false);
  });
});

describe('mobile ledger pull wiring', () => {
  const app = sourceOf('src/mobile/MobileApp.tsx');

  it('routes every automatic trigger through the policy gate', () => {
    expect(app.match(/requestLedgerPull\('foreground'\)/g)).toHaveLength(1);
    expect(app.match(/requestLedgerPull\('retry'\)/g)).toHaveLength(1);
    expect(app.match(/requestLedgerPull\('manual'\)/g)).toHaveLength(2);
    expect(app.match(/requestLedgerPull\('command'\)/g)).toHaveLength(2);
    // The only direct call left is the replay of a trigger that arrived while a
    // pull was already running; every other entry point is gated.
    expect(app.match(/void pullLedger\(/g)).toHaveLength(1);
    expect(app).toContain('void pullLedger(next, cacheRef.current.cursor);');
    expect(app).toContain('const requestLedgerPull = useCallback(');
    expect(app).toContain('pendingLedgerPull.current = reason;');
  });

  it('aborts native commands on suspend and on account transitions', () => {
    expect(app.match(/nativeCommandAbort\.current\?\.abort\(\);/g)).toHaveLength(2);
    expect(app).toContain('const signal = controller.signal;');
    expect(app).toContain('sendNativeCommand(connection, deviceId, nativeCommand, signal)');
    expect(app).toMatch(/async function sendNativeCommand\([\s\S]*?signal,\n  \}\);/);
  });

  it('pulls the ledger once per drained command batch', () => {
    expect(app.match(/finishedLedgerCommand/g)).toHaveLength(3);
    expect(app).toContain(
      "if (finishedLedgerCommand && !signal.aborted) void requestLedgerPull('command');",
    );
  });

  it('keeps background work off the timer when the app is not active', () => {
    expect(
      app.match(/mobileAppActive\.current && document\.visibilityState === 'visible'/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(app).not.toContain('window.setInterval(() => void processNativeQueue(), 5_000)');
  });
});
