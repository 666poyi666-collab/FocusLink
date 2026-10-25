import 'fake-indexeddb/auto';

import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOfflineCompletionFreeze,
  completeOfflineFocusRuntime,
  readOfflineCompletionFreeze,
  readPendingDeviceSyncBundles,
  removePendingDeviceSyncBundle,
} from '../src/mobile/cache';
import { persistCompletedOfflineFocus } from '../src/mobile/offlineCompletion';
import {
  classifyNativeCompletion,
  offlineCompletionNotice,
  resolveFrozenCompletion,
  type NativeCompletionOutcome,
} from '../src/mobile/offlineCompletionIdentity';
import { readMobileV2Status, writeMobileV2Bootstrap } from '../src/mobile/v2Cache';

const DATABASE_NAME = 'focuslink-mobile-preview';
const DEVICE_ID = 'device-mobile-idempotency';
const nativePlugin = vi.hoisted(() => ({
  enqueueCompletedLedgerBundle: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    isPluginAvailable: (name: string) => name === 'FocusRuntime',
  },
  registerPlugin: () => nativePlugin,
}));

describe('frozen offline completion identity', () => {
  it('reuses the first completed payload for the same session id', () => {
    const first = resolveFrozenCompletion({
      existing: null,
      bundle: bundle('session-a', 61_000),
      frozenAt: 7,
    });
    expect(first.reused).toBe(false);
    expect(first.freeze).toMatchObject({ sessionId: 'session-a', endedAt: 61_000, frozenAt: 7 });

    const second = resolveFrozenCompletion({
      existing: first.freeze,
      bundle: bundle('session-a', 99_000),
      frozenAt: 9,
    });
    expect(second.reused).toBe(true);
    expect(second.freeze).toBe(first.freeze);
    expect(second.freeze.endedAt).toBe(61_000);
    expect(second.freeze.bundle.session.endedAt).toBe(61_000);
  });

  it('ignores a frozen payload that belongs to another session or is invalid', () => {
    const other = resolveFrozenCompletion({
      existing: { sessionId: 'session-b', endedAt: 5, bundle: bundle('session-b', 5), frozenAt: 1 },
      bundle: bundle('session-a', 61_000),
      frozenAt: 7,
    });
    expect(other.reused).toBe(false);
    expect(other.freeze.sessionId).toBe('session-a');

    const corrupted = resolveFrozenCompletion({
      existing: { sessionId: 'session-a', endedAt: 61_000, bundle: {} as never, frozenAt: 1 },
      bundle: bundle('session-a', 99_000),
      frozenAt: 7,
    });
    expect(corrupted.reused).toBe(false);
    expect(corrupted.freeze.endedAt).toBe(99_000);
  });

  it('classifies every native delivery outcome instead of one boolean', () => {
    const outcome = (
      input: Parameters<typeof classifyNativeCompletion>[0],
    ): NativeCompletionOutcome => classifyNativeCompletion(input);

    expect(outcome({ available: false, queued: false })).toBe('unavailable');
    expect(outcome({ available: true, queued: true })).toBe('queued');
    expect(outcome({ available: true, queued: false })).toBe('duplicate');
    expect(
      outcome({
        available: true,
        queued: false,
        error: new Error('completed ledger identity already exists'),
      }),
    ).toBe('identity-conflict');
    expect(
      outcome({
        available: true,
        queued: false,
        error: new DOMException('Android 账号连接已变化', 'AbortError'),
      }),
    ).toBe('stale-lease');
    expect(outcome({ available: true, queued: false, error: new Error('boom') })).toBe('failed');
  });

  it('never claims the draft is safe after a failed commit or an unresolved conflict', () => {
    const dropped = offlineCompletionNotice({ native: 'failed', pending: null });
    expect(dropped).toContain('草稿');
    expect(dropped).not.toContain('已安全保存');

    const conflict = offlineCompletionNotice({
      native: 'queued',
      pending: { state: 'conflict' } as never,
    });
    expect(conflict).toContain('冲突');
  });
});

describe('canonical offline completion idempotency', () => {
  beforeEach(async () => {
    nativePlugin.enqueueCompletedLedgerBundle.mockReset();
    nativePlugin.enqueueCompletedLedgerBundle.mockResolvedValue({ queued: true, pending: 1 });
    await deleteDatabase();
    await writeMobileV2Bootstrap({
      key: 'syncV2.bootstrap',
      state: 'v2-active',
      bootstrapId: null,
      cursor: 'c4',
      boundDeviceId: DEVICE_ID,
      boundAccountId: 'account-idempotency',
      syncEpoch: 'sync-idempotency',
      cursorEpoch: 'cursor-idempotency',
      accountGeneration: 2,
      updatedAt: 1,
    });
  });

  it('keeps one canonical operation and the first endedAt when a draft is finished twice', async () => {
    const first = await completeOfflineFocusRuntime(bundle('session-retry', 61_000));
    const second = await completeOfflineFocusRuntime(bundle('session-retry', 99_000));

    expect(second.opId).toBe(first.opId);
    expect(second.bundle.session.endedAt).toBe(61_000);
    expect(second.state).toBe('pending');

    const pending = await readPendingDeviceSyncBundles();
    expect(pending).toHaveLength(1);
    expect(pending[0].bundle.session.endedAt).toBe(61_000);

    const freeze = await readOfflineCompletionFreeze('session-retry');
    expect(freeze).toMatchObject({ sessionId: 'session-retry', endedAt: 61_000 });
    expect((await readMobileV2Status(DEVICE_ID)).pending).toBe(2);
  });

  it('clears the frozen identity together with the delivered canonical operation', async () => {
    const pending = await completeOfflineFocusRuntime(bundle('session-clear', 61_000));
    expect(await readOfflineCompletionFreeze('session-clear')).not.toBeNull();

    await removePendingDeviceSyncBundle(pending.opId);

    expect(await readOfflineCompletionFreeze('session-clear')).toBeNull();
    expect(await readPendingDeviceSyncBundles()).toHaveLength(0);
  });

  it('clears the frozen identity on an explicit reset', async () => {
    await completeOfflineFocusRuntime(bundle('session-reset', 61_000));
    await clearOfflineCompletionFreeze('session-reset');
    expect(await readOfflineCompletionFreeze('session-reset')).toBeNull();
    expect(await clearOfflineCompletionFreeze('session-reset')).toBeUndefined();
  });

  it('reports the native duplicate instead of a second queue without claiming a new save', async () => {
    nativePlugin.enqueueCompletedLedgerBundle
      .mockResolvedValueOnce({ queued: true, pending: 1 })
      .mockResolvedValueOnce({ queued: false, pending: 1 });

    const first = await persistCompletedOfflineFocus(bundle('session-dup', 61_000), DEVICE_ID, '0');
    const second = await persistCompletedOfflineFocus(
      bundle('session-dup', 99_000),
      DEVICE_ID,
      '0',
    );

    expect(first).toMatchObject({ reusedFreeze: false, native: 'queued' });
    expect(second).toMatchObject({ reusedFreeze: true, native: 'duplicate' });
    expect(nativePlugin.enqueueCompletedLedgerBundle.mock.calls[1][0].record.bundleId).toBe(
      'session-dup',
    );
    expect(offlineCompletionNotice(second)).toContain('未重复排队');
    const pending = await readPendingDeviceSyncBundles();
    expect(pending).toHaveLength(1);
    expect(pending[0].bundle.session.endedAt).toBe(61_000);
  });

  it('maps a native identity collision to a conflict-backed notice', async () => {
    nativePlugin.enqueueCompletedLedgerBundle.mockRejectedValue(
      new Error('completed ledger identity already exists'),
    );

    const result = await persistCompletedOfflineFocus(
      bundle('session-conflict', 61_000),
      DEVICE_ID,
      '0',
    );

    expect(result.native).toBe('identity-conflict');
    expect(result.nativeDetail).toContain('identity already exists');
    expect(result.pending).toMatchObject({ entityId: 'session-conflict', state: 'pending' });
    expect(offlineCompletionNotice(result)).toContain('最早一次结束');
  });
});

describe('offline completion commit contract', () => {
  const mobileAppSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'mobile', 'MobileApp.tsx'),
    'utf8',
  );
  const boundarySource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'mobile', 'offlineCompletion.ts'),
    'utf8',
  );
  const cacheSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'mobile', 'cache.ts'),
    'utf8',
  );

  it('keeps the draft when the canonical commit did not land', () => {
    expect(mobileAppSource).toContain('if (!completion.pending) return;');
    expect(mobileAppSource).toContain('offlineCompletionNotice(completion)');
    expect(mobileAppSource).not.toContain("'离线会话已安全保存；联网后自动补传'");
  });

  it('freezes the completion identity before the native mirror is queued', () => {
    const freezeIndex = boundarySource.indexOf('writeOfflineCompletionFreeze(freeze)');
    const nativeIndex = boundarySource.indexOf('await enqueueNativeCompletedLedgerBundle(');
    expect(freezeIndex).toBeGreaterThan(0);
    expect(nativeIndex).toBeGreaterThan(0);
    expect(freezeIndex).toBeLessThan(nativeIndex);
    expect(boundarySource).toContain('completeOfflineFocusRuntime(freeze.bundle)');
  });

  it('stores and releases the frozen identity through the canonical cache module', () => {
    expect(cacheSource).toContain("COMPLETION_FREEZE_PREFIX = 'offlineCompletionFreeze.'");
    expect(cacheSource.match(/COMPLETION_FREEZE_PREFIX/g) ?? []).toHaveLength(6);
    expect(cacheSource).toContain('readOfflineCompletionFreeze');
    expect(cacheSource).toContain('writeOfflineCompletionFreeze');
  });
});

function bundle(sessionId: string, endedAt: number) {
  return {
    session: {
      id: sessionId,
      title: '户外化学复习',
      status: 'finished' as const,
      startedAt: 1_000,
      endedAt,
      activeElapsedMs: 50_000,
      pauseElapsedMs: 10_000,
      wallElapsedMs: endedAt - 1_000,
      defaultTaskId: 'task-chemistry',
      defaultTaskSource: 'ticktick' as const,
      defaultTaskTitle: '化学错题',
      note: null,
      createdAt: 1_000,
      updatedAt: endedAt,
    },
    segments: [],
    pauses: [],
  };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('database deletion blocked'));
  });
}
