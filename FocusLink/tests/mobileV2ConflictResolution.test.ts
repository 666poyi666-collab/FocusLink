import fs from 'node:fs';
import path from 'node:path';

import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { fingerprintDeviceSyncValue } from '../shared/sync/deviceProtocol';
import type { FocusLedgerV2, FocusMetadataV2, SyncV2Change } from '../shared/sync/v2Protocol';
import {
  applyMobileV2ChangesAndCheckpoint,
  claimMobileV2Outbox,
  enqueueMobileV2Mutation,
  readMobileV2Conflicts,
  readMobileV2EntityState,
  supersedeMobileV2PendingMutations,
  writeMobileV2Bootstrap,
  writeMobileV2Conflict,
  writeMobileV2EntityState,
} from '../src/mobile/v2Cache';
import {
  buildMobileV2ConflictResolution,
  describeMobileV2ConflictResolution,
  findMobileV2ConflictForResolutionOpId,
  formatDuration,
  mobileV2ConflictResolutionOpId,
  normalizeMobileV2ConflictRecord,
  normalizeMobileV2ConflictResolutionOutcome,
  presentMobileV2Conflicts,
  type MobileV2ConflictRecord,
} from '../src/mobile/v2ConflictResolution';

const DATABASE_NAME = 'focuslink-mobile-preview';

const ledgerLocal: FocusLedgerV2 = {
  sessionId: 'session-1',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_600_000,
  status: 'finished',
  activeElapsedMs: 600_000,
  pausedElapsedMs: 0,
  wallElapsedMs: 600_000,
  originDeviceId: 'phone',
  segments: [],
  pauses: [],
};
const ledgerRemote: FocusLedgerV2 = {
  ...ledgerLocal,
  endedAt: 1_700_000_300_000,
  status: 'aborted',
  activeElapsedMs: 300_000,
  wallElapsedMs: 300_000,
  originDeviceId: 'tablet',
};
const metadataLocal: FocusMetadataV2 = {
  sessionId: 'session-1',
  title: '手机标题',
  note: null,
  subject: null,
  tags: [{ tagId: 'tag-1', name: '物理' }],
  taskAssociation: null,
  updatedAt: 10,
  updatedByDeviceId: 'phone',
};
const metadataRemote: FocusMetadataV2 = {
  ...metadataLocal,
  title: '平板标题',
  note: '平板备注',
  tags: [],
  taskAssociation: { taskId: 'task-1', source: 'local', title: '做卷子' },
  updatedAt: 20,
  updatedByDeviceId: 'tablet',
};

function conflictRecord(overrides: Partial<MobileV2ConflictRecord> = {}): MobileV2ConflictRecord {
  return {
    conflictId: 'remote-7-focus_ledger_v2-session-1',
    entityType: 'focus_ledger_v2',
    entityId: 'session-1',
    base: null,
    local: ledgerLocal,
    remote: ledgerRemote,
    fields: ['payload'],
    sourceDeviceIds: ['tablet'],
    status: 'open',
    createdAt: 1_700_000_000_000,
    resolvedAt: null,
    resolutionOpId: null,
    remoteRevision: 4,
    remoteFingerprint: 'fp-remote',
    ...overrides,
  };
}

describe('mobile v2 conflict resolution', () => {
  it('shows only open conflicts, newest first, with readable field differences', () => {
    const records = [
      conflictRecord({ conflictId: 'older', createdAt: 10 }),
      conflictRecord({ conflictId: 'resolved', status: 'resolved', createdAt: 30 }),
      conflictRecord({
        conflictId: 'newer',
        createdAt: 20,
        entityType: 'focus_metadata_v2',
        local: metadataLocal,
        remote: metadataRemote,
        fields: ['deleted'],
      }),
    ];
    const presented = presentMobileV2Conflicts(records);
    expect(presented.map((row) => row.conflictId)).toEqual(['newer', 'older']);
    expect(presented[0]).toMatchObject({
      entityTypeLabel: '会话信息',
      reasonLabel: '一边删除了这条记录，另一边还留着',
      resolvable: true,
      blockedReason: null,
    });
    const difference = (label: string) =>
      presented[0].differences.find((row) => row.label === label);
    expect(difference('标题')).toMatchObject({ localValue: '手机标题', remoteValue: '平板标题' });
    expect(difference('备注')).toMatchObject({ localValue: '未填写', remoteValue: '平板备注' });
    expect(difference('标签')).toMatchObject({ localValue: '物理', remoteValue: '无标签' });
    expect(difference('关联任务')).toMatchObject({ localValue: '未关联', remoteValue: '做卷子' });
    expect(presented[1].differences.map((row) => row.label)).toEqual(
      expect.arrayContaining(['结束状态', '专注时长']),
    );
    expect(presented[1].differences.find((row) => row.label === '结束状态')).toMatchObject({
      localValue: '正常结束',
      remoteValue: '中途结束',
    });
    expect(presented[1].differences.find((row) => row.label === '专注时长')).toMatchObject({
      localValue: '10 分 0 秒',
      remoteValue: '5 分 0 秒',
    });
    expect(formatDuration(3_600_000)).toBe('1 小时 0 分');
  });

  it('labels a missing side instead of inventing an empty payload', () => {
    const presented = presentMobileV2Conflicts([
      conflictRecord({ entityType: 'focus_metadata_v2', local: null, remote: metadataRemote }),
    ])[0];
    expect(presented.localMissing).toBe(true);
    expect(presented.remoteMissing).toBe(false);
    expect(presented.differences[0]).toMatchObject({
      label: '记录状态',
      localValue: '本机已删除',
      remoteValue: '云端保留',
    });
  });

  it('does not offer a decision before the remote revision is known', () => {
    const legacy = conflictRecord({ remoteRevision: null, remoteFingerprint: null });
    const presented = presentMobileV2Conflicts([legacy])[0];
    expect(presented.resolvable).toBe(false);
    expect(presented.blockedReason).toContain('刷新一次账本');
    const resolution = buildMobileV2ConflictResolution({
      conflict: legacy,
      side: 'remote',
      checkpoint: { boundDeviceId: 'phone', accountGeneration: 1 },
    });
    expect(resolution).toMatchObject({ ok: false });
  });

  it('refuses a payload whose shape does not match the entity type', () => {
    const mismatched = conflictRecord({ remote: metadataRemote });
    const resolution = buildMobileV2ConflictResolution({
      conflict: mismatched,
      side: 'remote',
      checkpoint: { boundDeviceId: 'phone', accountGeneration: 1 },
    });
    expect(resolution).toMatchObject({ ok: false });
    expect(presentMobileV2Conflicts([mismatched])[0].resolvable).toBe(false);
  });

  it('builds a put from the remote revision this device already materialized', () => {
    const resolution = buildMobileV2ConflictResolution({
      conflict: conflictRecord({ remoteRevision: 9, remoteFingerprint: 'fp-nine' }),
      side: 'remote',
      checkpoint: { boundDeviceId: 'phone', accountGeneration: 3 },
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) throw new Error('expected a resolution');
    expect(resolution.opId).toBe('resolve:remote-7-focus_ledger_v2-session-1:remote');
    expect(resolution.mutation).toMatchObject({
      opId: resolution.opId,
      entityType: 'focus_ledger_v2',
      entityId: 'session-1',
      kind: 'put',
      baseRevision: 9,
      baseFingerprint: 'fp-nine',
      deviceId: 'phone',
      accountGeneration: 3,
      payload: ledgerRemote,
    });
  });

  it('builds a delete when the chosen side is already gone', () => {
    const resolution = buildMobileV2ConflictResolution({
      conflict: conflictRecord({
        entityType: 'focus_metadata_v2',
        local: metadataLocal,
        remote: null,
      }),
      side: 'remote',
      checkpoint: { boundDeviceId: 'phone', accountGeneration: 1 },
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) throw new Error('expected a resolution');
    expect(resolution.mutation).toMatchObject({ kind: 'delete', payload: null, baseRevision: 4 });
  });

  it('finds the conflict a resolution op id belongs to without parsing ids', () => {
    const record = conflictRecord({ conflictId: 'remote-7-focus_guard_rule_v1:rule:9' });
    expect(
      findMobileV2ConflictForResolutionOpId(
        [record],
        mobileV2ConflictResolutionOpId(record.conflictId, 'local'),
      )?.conflictId,
    ).toBe(record.conflictId);
    expect(findMobileV2ConflictForResolutionOpId([record], 'resolve:other:local')).toBeNull();
    expect(
      findMobileV2ConflictForResolutionOpId(
        [{ ...record, status: 'resolved' }],
        mobileV2ConflictResolutionOpId(record.conflictId, 'local'),
      ),
    ).toBeNull();
  });

  it('explains every settlement outcome instead of leaving a silent button', () => {
    expect(normalizeMobileV2ConflictResolutionOutcome('applied')).toBe('applied');
    expect(normalizeMobileV2ConflictResolutionOutcome(undefined)).toBe('missing');
    expect(normalizeMobileV2ConflictResolutionOutcome('pending')).toBe('queued');
    expect(describeMobileV2ConflictResolution('applied')).toContain('云端接受这次版本');
    expect(describeMobileV2ConflictResolution('duplicate')).toContain('不用再重复');
    expect(describeMobileV2ConflictResolution('conflict')).toContain('冲突还在');
    expect(describeMobileV2ConflictResolution('rejected', 'conflict_payload_invalid')).toContain(
      'conflict_payload_invalid',
    );
    expect(describeMobileV2ConflictResolution('queued')).toContain('连上云端后自动提交');
    expect(describeMobileV2ConflictResolution('missing')).toContain('回执');
  });

  it('normalises legacy conflict rows that predate the resolution fields', () => {
    const normalised = normalizeMobileV2ConflictRecord({
      conflictId: 'remote-1-focus_metadata_v2-session-1',
      entityType: 'focus_metadata_v2',
      entityId: 'session-1',
      local: metadataLocal,
      remote: metadataRemote,
      fields: ['payload'],
      status: 'open',
      createdAt: 5,
    });
    expect(normalised).toMatchObject({
      remoteRevision: null,
      remoteFingerprint: null,
      status: 'open',
    });
    expect(normalizeMobileV2ConflictRecord({})).toBeNull();
    expect(normalizeMobileV2ConflictRecord(null)).toBeNull();
  });
});

const baseMetadata: FocusMetadataV2 = {
  ...metadataLocal,
  title: '原始标题',
  tags: [],
  updatedAt: 1,
};

async function seedRemoteConflict() {
  const owner = checkpoint('c0');
  await writeMobileV2Bootstrap(owner);
  await writeMobileV2EntityState({
    entityType: 'focus_metadata_v2',
    entityId: 'session-1',
    confirmedRevision: 1,
    confirmedFingerprint: 'fp-one',
    baseSnapshot: baseMetadata,
    deleted: false,
    syncEpoch: 's1',
    cursorEpoch: 'e1',
    accountGeneration: 1,
    updatedAt: 1,
  });
  await enqueueMobileV2Mutation(
    {
      opId: 'local-edit',
      entityType: 'focus_metadata_v2',
      entityId: 'session-1',
      kind: 'put',
      baseRevision: 1,
      baseFingerprint: 'fp-one',
      payload: metadataLocal,
      deviceId: 'phone',
      accountGeneration: 1,
    },
    owner,
    2,
  );
  const remoteChange: SyncV2Change = {
    changeSeq: 7,
    entityType: 'focus_metadata_v2',
    entityId: 'session-1',
    revision: 2,
    fingerprint: fingerprintDeviceSyncValue({ deleted: false, payload: metadataRemote }),
    deleted: false,
    payload: metadataRemote,
    sourceDeviceId: 'tablet',
  };
  await applyMobileV2ChangesAndCheckpoint({
    changes: [remoteChange],
    checkpoint: owner,
    serverTime: 3,
    deviceId: 'phone',
  });
  const [conflict] = await readMobileV2Conflicts();
  return { owner, conflict };
}

describe('mobile v2 conflict resolution persistence', () => {
  beforeEach(deleteDatabase);

  it('settles the conflict row in the same transaction as its resolution ACK', async () => {
    const { owner, conflict } = await seedRemoteConflict();
    expect(conflict).toMatchObject({
      status: 'open',
      remoteRevision: 2,
      local: metadataLocal,
      remote: metadataRemote,
    });
    const resolution = buildMobileV2ConflictResolution({
      conflict,
      side: 'remote',
      checkpoint: owner,
    });
    if (!resolution.ok) throw new Error(resolution.reason);
    expect(
      await supersedeMobileV2PendingMutations(owner, {
        entityType: 'focus_metadata_v2',
        entityId: 'session-1',
        keepOpId: resolution.opId,
      }),
    ).toBe(1);
    await enqueueMobileV2Mutation(resolution.mutation, owner);
    const claimed = await claimMobileV2Outbox(owner, 10, 20);
    expect(claimed.items.map((item) => item.opId)).toEqual([resolution.opId]);

    await applyMobileV2ChangesAndCheckpoint({
      changes: [],
      checkpoint: owner,
      serverTime: 30,
      deviceId: 'phone',
      leaseId: claimed.leaseId,
      acks: [
        {
          opId: resolution.opId,
          entityType: 'focus_metadata_v2',
          entityId: 'session-1',
          status: 'applied',
          revision: 3,
          fingerprint: 'fp-three',
          errorCode: null,
        },
      ],
    });

    const [settled] = await readMobileV2Conflicts();
    expect(settled).toMatchObject({ status: 'resolved', resolutionOpId: resolution.opId });
    expect(await readMobileV2EntityState('focus_metadata_v2', 'session-1')).toMatchObject({
      confirmedRevision: 3,
      confirmedFingerprint: 'fp-three',
    });
  });

  it('keeps the conflict open while the cloud answers with another conflict', async () => {
    const { owner, conflict } = await seedRemoteConflict();
    const resolution = buildMobileV2ConflictResolution({
      conflict,
      side: 'local',
      checkpoint: owner,
    });
    if (!resolution.ok) throw new Error(resolution.reason);
    await enqueueMobileV2Mutation(resolution.mutation, owner);
    const claimed = await claimMobileV2Outbox(owner, 10, 20);
    await applyMobileV2ChangesAndCheckpoint({
      changes: [],
      checkpoint: owner,
      serverTime: 30,
      deviceId: 'phone',
      leaseId: claimed.leaseId,
      acks: [
        {
          opId: resolution.opId,
          entityType: 'focus_metadata_v2',
          entityId: 'session-1',
          status: 'conflict',
          revision: null,
          fingerprint: null,
          errorCode: 'revision_conflict',
        },
      ],
    });
    const [stillOpen] = await readMobileV2Conflicts();
    expect(stillOpen).toMatchObject({ status: 'open', resolutionOpId: null });
  });

  it('never drops a row another exchange already leased', async () => {
    const owner = checkpoint('c0');
    await writeMobileV2Bootstrap(owner);
    await enqueueMobileV2Mutation(
      {
        opId: 'local-edit',
        entityType: 'focus_metadata_v2',
        entityId: 'session-1',
        kind: 'put',
        baseRevision: 1,
        baseFingerprint: 'fp-one',
        payload: metadataLocal,
        deviceId: 'phone',
        accountGeneration: 1,
      },
      owner,
      2,
    );
    await claimMobileV2Outbox(owner, 10, 20);
    expect(
      await supersedeMobileV2PendingMutations(owner, {
        entityType: 'focus_metadata_v2',
        entityId: 'session-1',
        keepOpId: 'resolve:other:local',
      }),
    ).toBe(0);
  });

  it('reads a legacy conflict row without the resolution fields', async () => {
    await writeMobileV2Conflict({
      conflictId: 'remote-1-focus_metadata_v2-session-1',
      entityType: 'focus_metadata_v2',
      entityId: 'session-1',
      base: null,
      local: metadataLocal,
      remote: metadataRemote,
      fields: ['payload'],
      sourceDeviceIds: ['tablet'],
      status: 'open',
      createdAt: 5,
      resolvedAt: null,
      resolutionOpId: null,
    });
    const [legacy] = await readMobileV2Conflicts();
    expect(legacy).toMatchObject({ remoteRevision: null, remoteFingerprint: null, status: 'open' });
  });
});

function checkpoint(cursor: string) {
  return {
    key: 'syncV2.bootstrap' as const,
    state: 'v2-active' as const,
    bootstrapId: null,
    cursor,
    boundDeviceId: 'phone',
    boundAccountId: 'account-test',
    syncEpoch: 's1',
    cursorEpoch: 'e1',
    accountGeneration: 1,
    updatedAt: 1,
  };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

describe('mobile conflict UI wiring', () => {
  const settingsSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'mobile', 'SettingsView.tsx'),
    'utf8',
  );
  const appSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'mobile', 'MobileApp.tsx'),
    'utf8',
  );

  it('renders a decision surface instead of sending the user to the desktop', () => {
    expect(settingsSource).toContain('同步冲突');
    expect(settingsSource).toContain('onResolveConflict');
    expect(settingsSource).toContain('保留本机');
    expect(settingsSource).toContain('采用云端');
    expect(settingsSource).toContain('没有需要你决定的差异');
    expect(settingsSource).not.toContain('去电脑端处理');
  });

  it('submits the choice through the normal exchange and supersedes the stale write', () => {
    expect(appSource).toContain('buildMobileV2ConflictResolution');
    expect(appSource).toContain('supersedeMobileV2PendingMutations');
    expect(appSource).toContain('readMobileV2Conflicts');
    expect(appSource).toContain('describeMobileV2ConflictResolution');
  });
});
