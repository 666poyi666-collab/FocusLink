import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchTaskSnapshot, fetchTaskSnapshotConditional } from '../src/mobile/syncClient';
import {
  FOCUSLINK_CANONICAL_SYNC_ORIGIN,
  FOCUSLINK_SYNC_FAILOVER_ORIGIN,
} from '../shared/sync/identityProtocol';
import {
  TASK_SNAPSHOT_CAPABILITY_HEADER,
  TASK_SNAPSHOT_IF_NONE_MATCH_HEADER,
  TASK_SNAPSHOT_SCHEDULING_CAPABILITY,
  formatTaskSnapshotEtag,
  parseTaskSnapshotResponse,
  taskSnapshotEtagMatches,
} from '../shared/sync/taskSnapshotProtocol';

const DEVICE_TOKEN = `fl2_account1_mobile1_${'x'.repeat(32)}`;
const ETAG = formatTaskSnapshotEtag({
  revision: 37,
  sourceDeviceId: 'device-desktop',
  includeScheduling: true,
});
const MARKER = {
  protocolVersion: 1,
  revision: 37,
  sourceDeviceId: 'device-desktop',
  snapshot: null,
  serverTime: 38_000,
  unchanged: true,
} as const;
const FULL_BODY = {
  protocolVersion: 1,
  revision: 37,
  sourceDeviceId: 'device-desktop',
  snapshot: { publishedAt: 37_000, projects: [], tasks: [] },
  serverTime: 38_000,
} as const;

describe('task snapshot etag identity', () => {
  it('derives a quoted etag from revision, capability and device', () => {
    expect(ETAG).toBe('"flts1-37-sched-device-desktop"');
    expect(
      formatTaskSnapshotEtag({
        revision: 37,
        sourceDeviceId: 'device-desktop',
        includeScheduling: true,
      }),
    ).toBe(ETAG);
    // The scheduling capability changes the representation, so it must change the tag too.
    expect(
      formatTaskSnapshotEtag({
        revision: 37,
        sourceDeviceId: 'device-desktop',
        includeScheduling: false,
      }),
    ).toBe('"flts1-37-legacy-device-desktop"');
    expect(
      formatTaskSnapshotEtag({ revision: 0, sourceDeviceId: null, includeScheduling: true }),
    ).toBe('"flts1-0-sched-none"');
  });

  it('matches RFC 9110 list syntax including weak validators', () => {
    expect(taskSnapshotEtagMatches(ETAG, ETAG)).toBe(true);
    expect(taskSnapshotEtagMatches(`"flts1-36-sched-other", ${ETAG}`, ETAG)).toBe(true);
    expect(taskSnapshotEtagMatches(`W/${ETAG}`, ETAG)).toBe(true);
    expect(taskSnapshotEtagMatches('*', ETAG)).toBe(true);
    expect(taskSnapshotEtagMatches(null, ETAG)).toBe(false);
    expect(taskSnapshotEtagMatches('   ', ETAG)).toBe(false);
    expect(taskSnapshotEtagMatches('"flts1-36-sched-device-desktop"', ETAG)).toBe(false);
  });

  it('parses the body-free unchanged marker and rejects other shapes', () => {
    expect(parseTaskSnapshotResponse(MARKER)).toMatchObject({
      revision: 37,
      snapshot: null,
      unchanged: true,
    });
    expect(parseTaskSnapshotResponse({ ...MARKER, unchanged: false })).toBeNull();
    expect(parseTaskSnapshotResponse({ ...MARKER, extra: 1 })).toBeNull();
    const full = parseTaskSnapshotResponse(FULL_BODY);
    expect(full).not.toBeNull();
    expect(full).not.toHaveProperty('unchanged');
  });
});

describe('conditional task snapshot read', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the stored etag and reports the marker instead of a snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(MARKER, { headers: { ETag: ETAG } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchTaskSnapshotConditional({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: DEVICE_TOKEN,
      ifNoneMatch: ` ${ETAG} `,
    });

    expect(result.notModified).toBe(true);
    expect(result.etag).toBe(ETAG);
    expect(result.response.snapshot).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${FOCUSLINK_SYNC_FAILOVER_ORIGIN}/sync/v2/tasks`);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers[TASK_SNAPSHOT_IF_NONE_MATCH_HEADER]).toBe(ETAG);
    expect(headers[TASK_SNAPSHOT_CAPABILITY_HEADER]).toBe(TASK_SNAPSHOT_SCHEDULING_CAPABILITY);
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('omit');
  });

  it('omits the conditional header on a first read', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(FULL_BODY, { headers: { ETag: ETAG } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchTaskSnapshotConditional({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: DEVICE_TOKEN,
    });

    expect(result.notModified).toBe(false);
    expect(result.etag).toBe(ETAG);
    expect(result.response).toMatchObject({ revision: 37, snapshot: { tasks: [] } });
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers).not.toHaveProperty(TASK_SNAPSHOT_IF_NONE_MATCH_HEADER);
  });

  it('requires gateway evidence before adding a validator and retains a proven marker', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(FULL_BODY)));

    const full = await fetchTaskSnapshotConditional({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: DEVICE_TOKEN,
    });
    expect(full.notModified).toBe(false);
    expect(full.etag).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(MARKER)));
    const marker = await fetchTaskSnapshotConditional({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: DEVICE_TOKEN,
      ifNoneMatch: ETAG,
    });
    expect(marker.notModified).toBe(true);
    expect(marker.etag).toBe(ETAG);
  });

  it('falls back once to a plain GET if a stale gateway blocks a previous validator', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(Response.json(FULL_BODY));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchTaskSnapshotConditional({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: DEVICE_TOKEN,
      ifNoneMatch: ETAG,
    });
    expect(result.etag).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const headers = (fetchMock.mock.calls[2][1] as RequestInit).headers as Record<string, string>;
    expect(headers).not.toHaveProperty(TASK_SNAPSHOT_IF_NONE_MATCH_HEADER);
  });

  it('never bypasses an authoritative authentication rejection', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ code: 'unauthorized' }, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchTaskSnapshotConditional({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        token: DEVICE_TOKEN,
        ifNoneMatch: ETAG,
      }),
    ).rejects.toThrow('设备凭据已失效');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a marker on an unconditional read as a contract error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json(MARKER, { headers: { ETag: ETAG } })),
    );

    await expect(
      fetchTaskSnapshot({ endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN, token: DEVICE_TOKEN }),
    ).rejects.toThrow('任务快照响应异常');
  });
});

describe('mobile conditional polling wiring', () => {
  const mobileRoot = path.join(process.cwd(), 'src', 'mobile');
  const mobileAppSource = fs.readFileSync(path.join(mobileRoot, 'MobileApp.tsx'), 'utf8');
  const serverSource = fs.readFileSync(
    path.join(process.cwd(), 'cloud', 'deviceSyncServer.ts'),
    'utf8',
  );

  it('keeps the etag bound to one account connection', () => {
    expect(mobileAppSource).toContain('fetchTaskSnapshotConditional');
    expect(mobileAppSource).toContain('taskSnapshotEtag.current');
    // A stale tag from the previous cloud must never be echoed to the new one.
    expect(mobileAppSource).toContain('storedEtag.connectionKey === connectionKey');
    expect(mobileAppSource).toContain('if (fetched.notModified) {');
    expect(mobileAppSource).not.toContain('fetchTaskSnapshot({');
  });

  it('answers a matched conditional read with a body-free marker', () => {
    // The decision itself lives in the shared protocol module, so both backends share one
    // marker shape; the server only publishes its headers.
    expect(serverSource).toContain('resolveTaskSnapshotConditionalRead');
    expect(serverSource).toContain("response.setHeader('ETag', conditional.etag)");
    expect(serverSource).toContain('TASK_SNAPSHOT_CAPABILITY_HEADER');
  });
});
