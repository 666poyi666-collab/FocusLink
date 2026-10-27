import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  newLocalTaskCreate,
  overlayLocalTaskCreates,
  prepareLocalTaskCreate,
  retryLocalTaskCreate,
} from '../src/mobile/localTaskQueue';
import {
  clearMobileCache,
  readLocalTaskCreates,
  writeLocalTaskCreate,
  retryLocalTaskCreates,
} from '../src/mobile/cache';
import { createEmptyTaskSnapshot } from '../src/mobile/taskSnapshotMutations';
import type { TaskSnapshotResponse } from '../shared/sync/taskSnapshotProtocol';

const remote: TaskSnapshotResponse = {
  protocolVersion: 1,
  revision: 7,
  sourceDeviceId: 'desktop',
  snapshot: createEmptyTaskSnapshot(1_000),
  serverTime: 1_000,
};

describe('durable local task creation', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves without a network request and survives ordinary cache cleanup', async () => {
    const draft = newLocalTaskCreate('task-1', 'account-a', '  阅读  ', null, 1_000);
    await writeLocalTaskCreate(draft);
    await clearMobileCache();
    expect(await readLocalTaskCreates('account-a')).toEqual([draft]);
    expect(await readLocalTaskCreates('account-b')).toEqual([]);
  });

  it('binds an unpaired intent once, preserving identity and rejecting a different account', async () => {
    const draft = newLocalTaskCreate('task-1', 'unpaired', '阅读', null, 1_000);
    await writeLocalTaskCreate(draft);
    const bound = prepareLocalTaskCreate({ ...draft, scope: 'account-a' }, remote);
    await writeLocalTaskCreate(bound);
    await expect(writeLocalTaskCreate({ ...bound, scope: 'account-b' })).rejects.toThrow(
      '另一同步空间',
    );
    expect(await readLocalTaskCreates('account-a')).toEqual([bound]);
    expect(await readLocalTaskCreates('account-b')).toEqual([]);
  });

  it('freezes the CAS base and operation identity across an ambiguous network failure', () => {
    const draft = prepareLocalTaskCreate(
      newLocalTaskCreate('task-1', 'account-a', '阅读', null),
      remote,
    );
    const retry = retryLocalTaskCreate(draft, null, 2_000);
    expect(prepareLocalTaskCreate(retry, { ...remote, revision: 20 })).toMatchObject({
      expectedRevision: 7,
      operationId: draft.operationId,
      id: draft.id,
    });
    const rejected = retryLocalTaskCreate(draft, 409, 2_000);
    expect(prepareLocalTaskCreate(rejected, { ...remote, revision: 20 })).toMatchObject({
      expectedRevision: 20,
      id: draft.id,
      title: draft.title,
    });
    expect(rejected.operationId).not.toBe(draft.operationId);
    expect(retryLocalTaskCreate(draft, 401).blocked).toBe(true);
  });

  it('overlays local rows without fabricating a cloud revision or mutating its task array', () => {
    const draft = newLocalTaskCreate('task-1', 'account-a', '阅读', null);
    const visible = overlayLocalTaskCreates(remote, [draft]);
    expect(visible.revision).toBe(7);
    expect(visible.snapshot?.tasks).toHaveLength(1);
    expect(remote.snapshot?.tasks).toHaveLength(0);
    expect(overlayLocalTaskCreates(visible, [draft]).snapshot?.tasks).toHaveLength(1);
  });

  it('keeps other records on matching acknowledgement cleanup', async () => {
    const a = newLocalTaskCreate('task-a', 'account-a', '阅读', null);
    const b = newLocalTaskCreate('task-b', 'account-a', '复习', null);
    await writeLocalTaskCreate(a);
    await writeLocalTaskCreate(b);
    await writeLocalTaskCreate(a, true);
    expect(await readLocalTaskCreates('account-a')).toEqual([b]);
  });

  it('does not erase a frozen operation on manual retry or a stale acknowledgement', async () => {
    const draft = newLocalTaskCreate('task-a', 'account-a', '阅读', null);
    const prepared = prepareLocalTaskCreate(draft, remote);
    const rebased = prepareLocalTaskCreate(retryLocalTaskCreate(prepared, 409), {
      ...remote,
      revision: 8,
    });
    await writeLocalTaskCreate({ ...rebased, blocked: true });
    await retryLocalTaskCreates('account-a');
    await writeLocalTaskCreate(prepared, true);
    expect(await readLocalTaskCreates('account-a')).toEqual([
      { ...rebased, blocked: false, nextRetryAt: 0 },
    ]);
  });

  it('backs off transient failures without dropping the durable create', () => {
    let record = newLocalTaskCreate('task-a', 'account-a', '阅读', null);
    const first = retryLocalTaskCreate(record, 503, 0);
    expect(first.nextRetryAt).toBeGreaterThanOrEqual(12_000);
    expect(first.nextRetryAt).toBeLessThanOrEqual(18_000);
    expect(retryLocalTaskCreate(record, 429, 0, 120_000).nextRetryAt).toBe(120_000);
    for (let i = 0; i < 20; i += 1) record = retryLocalTaskCreate(record, null, 0);
    expect(record.nextRetryAt).toBeLessThanOrEqual(15 * 60_000);
    expect(record.id).toBe('task-a');
    expect(record.blocked).toBe(false);
  });
});
