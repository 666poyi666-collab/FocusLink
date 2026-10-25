import 'fake-indexeddb/auto';

import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FOCUSLINK_CANONICAL_SYNC_ORIGIN } from '../shared/sync/identityProtocol';
import type { SyncV2Mutation } from '../shared/sync/v2Protocol';
import { SyncV2ClientError, classifySyncV2Error } from '../shared/sync/v2ClientError';
import {
  MOBILE_V2_RETRY_CAP_MS,
  decideMobileV2Retry,
  describeMobileV2RetryWait,
  isRetryableMobileV2Failure,
  mobileV2RetryDelayMs,
} from '../src/mobile/v2RetryPolicy';
import {
  claimMobileV2Outbox,
  enqueueMobileV2Mutation,
  readMobileV2RetryState,
  retryMobileV2Lease,
  writeMobileV2Bootstrap,
  type MobileV2BootstrapCheckpoint,
} from '../src/mobile/v2Cache';
import { runMobileSyncV2 } from '../src/mobile/v2Sync';

const DATABASE_NAME = 'focuslink-mobile-preview';
const DEVICE_ID = 'device-newdev1';
const ACCOUNT_ID = 'account1';
const TOKEN = `fl2_account1_newdev1_${'x'.repeat(32)}`;

function activeCheckpoint(): MobileV2BootstrapCheckpoint {
  return {
    key: 'syncV2.bootstrap',
    state: 'v2-active',
    bootstrapId: null,
    cursor: 'c0',
    boundDeviceId: DEVICE_ID,
    boundAccountId: ACCOUNT_ID,
    syncEpoch: 'sync-epoch-1',
    cursorEpoch: 'cursor-epoch-1',
    accountGeneration: 1,
    updatedAt: 1,
  };
}

function status(changeSeq = 0): Record<string, unknown> {
  return {
    protocolVersion: 2,
    syncEpoch: 'sync-epoch-1',
    cursorEpoch: 'cursor-epoch-1',
    accountGeneration: 1,
    changeSeq,
    serverTime: 10,
  };
}

function page(): Record<string, unknown> {
  return {
    protocolVersion: 2,
    syncEpoch: 'sync-epoch-1',
    cursorEpoch: 'cursor-epoch-1',
    accountGeneration: 1,
    acks: [],
    changes: [],
    nextCursor: 'c0',
    hasMore: false,
    serverTime: 11,
  };
}

function json(value: unknown, statusCode = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status: statusCode,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function text(body: string, statusCode: number): Response {
  return new Response(body, { status: statusCode, headers: { 'content-type': 'text/plain' } });
}

function metadataMutation(): SyncV2Mutation {
  return {
    opId: 'offline-metadata-edit',
    entityType: 'focus_metadata_v2',
    entityId: 'session-1',
    kind: 'put',
    baseRevision: 0,
    baseFingerprint: null,
    payload: {
      sessionId: 'session-1',
      title: '手机端标题',
      note: null,
      subject: null,
      tags: [],
      taskAssociation: null,
      updatedAt: 5,
      updatedByDeviceId: DEVICE_ID,
    },
    deviceId: DEVICE_ID,
    accountGeneration: 1,
  } as SyncV2Mutation;
}

function stubRoutes(handler: (pathname: string, init?: RequestInit) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsed = new URL(typeof url === 'string' ? url : url instanceof URL ? url : url.url);
      return handler(parsed.pathname, init);
    }),
  );
}

async function syncFailure(): Promise<SyncV2ClientError> {
  const outcome = await runMobileSyncV2({
    endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
    token: TOKEN,
    deviceId: 'ignored-client-device-id',
  }).then(
    () => null,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(SyncV2ClientError);
  return outcome as SyncV2ClientError;
}

describe('mobile v2 retry policy', () => {
  it('backs off exponentially and stops widening at fifteen minutes', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => mobileV2RetryDelayMs(attempt))).toEqual([
      15_000, 30_000, 60_000, 120_000, 240_000,
    ]);
    expect(mobileV2RetryDelayMs(7)).toBe(MOBILE_V2_RETRY_CAP_MS);
    expect(mobileV2RetryDelayMs(12)).toBe(MOBILE_V2_RETRY_CAP_MS);
    expect(mobileV2RetryDelayMs(0)).toBe(15_000);
    expect(mobileV2RetryDelayMs(Number.NaN)).toBe(15_000);
  });

  it('treats a server wait hint as a floor and never lets it shorten the backoff', () => {
    expect(mobileV2RetryDelayMs(1, 2_000)).toBe(15_000);
    expect(mobileV2RetryDelayMs(1, 45_000)).toBe(45_000);
    expect(mobileV2RetryDelayMs(3, 45_000)).toBe(60_000);
    // Out-of-range hints are clamped, so a bogus header cannot pin the device.
    expect(mobileV2RetryDelayMs(1, 999_999)).toBe(300_000);
    expect(mobileV2RetryDelayMs(12, 999_999)).toBe(MOBILE_V2_RETRY_CAP_MS);
  });

  it('retries transport, throttling and server failures only', () => {
    expect(
      ['network_error', 'timeout', 'rate_limited', 'server_error', 'sync_failed'].map((code) =>
        isRetryableMobileV2Failure(code as never),
      ),
    ).toEqual([true, true, true, true, true]);
    expect(
      [
        'contract_error',
        'authentication_failed',
        'authorization_failed',
        'cursor_ahead',
        'response_too_large',
        'invalid_exchange_request',
      ].map((code) => isRetryableMobileV2Failure(code as never)),
    ).toEqual([false, false, false, false, false, false]);
  });

  it('parks a terminal failure at the cap instead of retrying it on the network cadence', () => {
    const decision = decideMobileV2Retry({ code: 'contract_error', attemptCount: 2 });
    expect(decision).toEqual({
      code: 'contract_error',
      attempt: 3,
      retryable: false,
      exhausted: false,
      delayMs: MOBILE_V2_RETRY_CAP_MS,
    });
  });

  it('keeps retrying a retryable failure at the cap after the attempt budget is spent', () => {
    expect(decideMobileV2Retry({ code: 'server_error', attemptCount: 10 })).toMatchObject({
      attempt: 11,
      retryable: true,
      exhausted: false,
      delayMs: MOBILE_V2_RETRY_CAP_MS,
    });
    expect(decideMobileV2Retry({ code: 'server_error', attemptCount: 12 })).toMatchObject({
      attempt: 13,
      retryable: true,
      exhausted: true,
      delayMs: MOBILE_V2_RETRY_CAP_MS,
    });
  });

  it('describes the wait in seconds below a minute and in minutes above it', () => {
    expect(describeMobileV2RetryWait(15_000)).toBe('约 15 秒后自动重试');
    expect(describeMobileV2RetryWait(45_000)).toBe('约 45 秒后自动重试');
    expect(describeMobileV2RetryWait(60_000)).toBe('约 1 分钟后自动重试');
    expect(describeMobileV2RetryWait(MOBILE_V2_RETRY_CAP_MS)).toBe('约 15 分钟后自动重试');
  });

  it('classifies throttling and 5xx as their own retryable codes', () => {
    expect(classifySyncV2Error(new Error('HTTP 429 Too Many Requests'))).toBe('rate_limited');
    expect(classifySyncV2Error(new Error('too many requests, slow down'))).toBe('rate_limited');
    expect(classifySyncV2Error(new Error('HTTP 503 Service Unavailable'))).toBe('server_error');
    expect(classifySyncV2Error(new Error('bad gateway'))).toBe('server_error');
    // The hint survives the safe-error conversion, which reuses the instance.
    const hinted = new SyncV2ClientError('rate_limited', undefined, [], 2_000);
    expect(hinted.retryAfterMs).toBe(2_000);
    expect(new SyncV2ClientError('rate_limited', undefined, [], -1).retryAfterMs).toBeNull();
  });
});

describe('mobile v2 retry bookkeeping', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
    await deleteDatabase();
  });

  it('summarises attempt count, next wait and pending rows for the driver', async () => {
    expect(await readMobileV2RetryState(DEVICE_ID)).toEqual({
      attemptCount: 0,
      nextRetryAt: null,
      pending: 0,
    });

    await writeMobileV2Bootstrap(activeCheckpoint());
    await enqueueMobileV2Mutation(metadataMutation(), activeCheckpoint(), 2);
    expect(await readMobileV2RetryState(DEVICE_ID)).toEqual({
      attemptCount: 0,
      nextRetryAt: null,
      pending: 1,
    });

    const claimed = await claimMobileV2Outbox(activeCheckpoint(), 1);
    await retryMobileV2Lease(claimed.leaseId, 'network_error', Date.now() - 1_000);
    // A wait that already elapsed is not a future hint.
    expect(await readMobileV2RetryState(DEVICE_ID)).toEqual({
      attemptCount: 1,
      nextRetryAt: null,
      pending: 1,
    });
  });

  it('parks a throttled push on the Retry-After floor and surfaces rate limiting', async () => {
    await writeMobileV2Bootstrap(activeCheckpoint());
    await enqueueMobileV2Mutation(metadataMutation(), activeCheckpoint(), 2);
    stubRoutes((pathname, init) => {
      if (pathname === '/sync/v2/status') return json(status());
      const body = JSON.parse(String(init?.body ?? '{}')) as { mutations?: unknown[] };
      if ((body.mutations ?? []).length === 0) return json(page());
      return json({ error: 'slow down' }, 429, { 'retry-after': '45' });
    });

    const failure = await syncFailure();
    expect(failure.code).toBe('rate_limited');
    expect(failure.retryAfterMs).toBe(45_000);

    const retryState = await readMobileV2RetryState(DEVICE_ID);
    expect(retryState).toMatchObject({ attemptCount: 1, pending: 1 });
    expect(retryState.nextRetryAt).not.toBeNull();
    const wait = (retryState.nextRetryAt ?? 0) - Date.now();
    expect(wait).toBeGreaterThan(44_000);
    expect(wait).toBeLessThanOrEqual(46_000);
  });

  it('parks a failed push at the cap when the cloud rejects the contract', async () => {
    await writeMobileV2Bootstrap(activeCheckpoint());
    await enqueueMobileV2Mutation(metadataMutation(), activeCheckpoint(), 2);
    stubRoutes((pathname, init) => {
      if (pathname === '/sync/v2/status') return json(status());
      const body = JSON.parse(String(init?.body ?? '{}')) as { mutations?: unknown[] };
      if ((body.mutations ?? []).length === 0) return json(page());
      return text('not json', 400);
    });

    const failure = await syncFailure();
    expect(failure.code).toBe('contract_error');
    const retryState = await readMobileV2RetryState(DEVICE_ID);
    expect(retryState).toMatchObject({ attemptCount: 1, pending: 1 });
    const wait = (retryState.nextRetryAt ?? 0) - Date.now();
    expect(wait).toBeGreaterThan(MOBILE_V2_RETRY_CAP_MS - 5_000);
    expect(wait).toBeLessThanOrEqual(MOBILE_V2_RETRY_CAP_MS);
  });

  it('reports 5xx as a retryable server error even without a JSON body', async () => {
    stubRoutes(() => text('upstream down', 500));
    expect((await syncFailure()).code).toBe('server_error');

    stubRoutes(() => json({ error: 'boom' }, 502));
    expect((await syncFailure()).code).toBe('server_error');
  });

  it('still treats a successful non-JSON response as a contract error', async () => {
    stubRoutes(() => text('ok', 200));
    expect((await syncFailure()).code).toBe('contract_error');
  });
});

describe('mobile retry UI wiring', () => {
  const readMobileSource = (file: string) =>
    fs.readFileSync(path.join(process.cwd(), 'src', 'mobile', file), 'utf8');

  it('says when the next attempt runs and drives it from the scheduler', () => {
    const app = readMobileSource('MobileApp.tsx');
    expect(app).toContain('retry.retryable ? describeMobileV2RetryWait(retryDelayMs) : null');
    expect(app).toContain(
      'const [ledgerRetryAt, setLedgerRetryAt] = useState<number | null>(null);',
    );
    expect(app).toContain('retryNotice={');
    // One scheduled follow-up, not a polling loop.
    expect(app).toMatch(/window\.setTimeout\(\(\) => \{\s*setLedgerRetryAt\(null\);/);
    // Success, account switch and terminal failures all drop the schedule.
    expect(app.match(/setLedgerRetryAt\(null\);/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps throttling and outages distinguishable from a broken contract', () => {
    const app = readMobileSource('MobileApp.tsx');
    expect(app).toContain("if (code === 'rate_limited') return '云端暂时限流，稍后自动重试';");
    expect(app).toContain("if (code === 'server_error') return '云端暂时不可用，稍后自动重试';");
    const native = readMobileSource('NativeSystemControls.tsx');
    expect(native).toContain("if (code === 'rate_limited') return '云端暂时限流，稍后自动重试';");
    expect(native).toContain("if (code === 'server_error') return '云端暂时不可用，稍后自动重试';");
  });

  it('shows the retry wait in the ledger freshness row', () => {
    const settings = readMobileSource('SettingsView.tsx');
    expect(settings).toContain('retryNotice: string | null;');
    expect(settings).toContain('retryNotice,');
  });
});

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
