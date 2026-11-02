import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AutomationCommandEnvelope, AutomationScope } from '@shared/automation/contract';
import type { TimerSnapshot } from '@shared/types';

import { AutomationService, type AutomationTimer } from '../electron/automation/service';
import {
  bumpRecordVersion,
  configureRecordVersioning,
  noteRecordMutated,
  onRecordMutated,
  type RecordMutationNotice,
} from '../electron/automation/recordVersioning';
import { AutomationStore } from '../electron/automation/store';
import { resetSchedulerForTests } from '../electron/automation/scheduler';
import { createAutomationTestDatabase } from './fixtures/automationDatabase';

const START = Date.parse('2026-11-02T09:00:00+08:00');
const MINUTE = 60_000;
const ALL_SCOPES: AutomationScope[] = [
  'focus:read',
  'focus:control',
  'records:write',
  'tomatodo:write',
];

function idleSnapshot(): TimerSnapshot {
  return {
    state: 'idle',
    sessionId: null,
    currentSegmentId: null,
    currentTaskId: null,
    currentTaskTitle: null,
    currentTaskSource: null,
    sessionDefaultTaskId: null,
    sessionDefaultTaskTitle: null,
    activeElapsedMs: 0,
    pauseElapsedMs: 0,
    wallElapsedMs: 0,
    currentPauseStartedAt: null,
    segments: [],
    pauseEvents: [],
    lastTick: START,
  };
}

const timer: AutomationTimer = {
  getSnapshot: idleSnapshot,
  onSnapshot: () => () => undefined,
  toggle: async () => idleSnapshot(),
  pause: async () => idleSnapshot(),
  resume: async () => idleSnapshot(),
  stop: async () => idleSnapshot(),
  startWithTask: async () => idleSnapshot(),
};

let database: Database.Database;
let service: AutomationService;
let notices: RecordMutationNotice[];
let unsubscribe: (() => void) | null = null;

function envelope(
  command: Record<string, unknown>,
  operationId: string,
): AutomationCommandEnvelope {
  return {
    operationId,
    sourceClient: 'unit-test',
    command: {
      ...command,
      expiresAt: START + 60 * MINUTE,
    } as AutomationCommandEnvelope['command'],
  };
}

/** 模拟人工界面的一次保存：直接写列，再走统一入口推进版本。 */
function humanEdit(sessionId: string, subject: string, sourceClient = 'ipc:tomatodo-subject') {
  database
    .prepare('UPDATE focus_sessions SET tomatodo_subject = ?, updated_at = ? WHERE id = ?')
    .run(subject, Date.now(), sessionId);
  return noteRecordMutated(database, { sessionId, domain: 'human', sourceClient });
}

beforeEach(async () => {
  resetSchedulerForTests();
  database = createAutomationTestDatabase();
  notices = [];
  configureRecordVersioning({ scope: () => 'scope-human' });
  unsubscribe = onRecordMutated((notice) => notices.push(notice));
  service = new AutomationService({
    database,
    timer,
    tomatodo: {
      status: () => ({
        enabled: true,
        autoSyncEnabled: false,
        minutes: 0,
        subject: '学习',
        recordName: '学习',
        writtenLocally: false,
        cloudSynced: false,
        state: 'not-written',
      }),
      sync: async () => ({
        ok: true,
        synced: 0,
        skipped: 0,
        failed: 0,
        phoneSynced: false,
        cloudSynced: false,
      }),
    },
    now: () => START,
    scope: () => 'scope-human',
    generation: () => 0,
    appVersion: () => '1.9.4-test',
  });
  service.start();
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
  service.dispose();
  resetSchedulerForTests();
  database.close();
});

async function createRecord(operationId: string) {
  return service.execute(
    envelope(
      {
        type: 'records.create',
        input: {
          startedAt: START,
          endedAt: START + 45 * MINUTE,
          timeline: [
            { kind: 'focus', startedAt: START, endedAt: START + 45 * MINUTE, title: '数学' },
          ],
        },
      },
      operationId,
    ),
    ALL_SCOPES,
  );
}

describe('human edits share the automation record version', () => {
  it('bumps the record version and publishes a change event', async () => {
    const created = await createRecord('op-human-0001');
    expect(created.recordVersion).toBe(1);
    notices.length = 0;

    const notice = humanEdit(created.targetId!, '数学');

    expect(notice.recordVersion).toBe(2);
    expect(notice.changeSeq).toBeGreaterThan(0);
    expect(notices.map((entry) => entry.domain)).toEqual(['human']);
    expect(service.readRecord(created.targetId!).recordVersion).toBe(2);
  });

  it('rejects an AI write that still holds the version from before the human edit', async () => {
    const created = await createRecord('op-human-0002');
    humanEdit(created.targetId!, '数学');

    const stale = await service.execute(
      envelope(
        {
          type: 'records.update',
          sessionId: created.targetId,
          expectedRecordVersion: 1,
          patch: { tomatodoSubject: '英语' },
        },
        'op-human-0003',
      ),
      ALL_SCOPES,
    );

    expect(stale.status).toBe('conflict');
    expect(stale.error?.code).toBe('VERSION_CONFLICT');
    expect(stale.error?.current?.recordVersion).toBe(2);
    // 人工刚保存的值不能被覆盖。
    expect(service.readRecord(created.targetId!).tomatodoSubject).toBe('数学');
  });

  it('accepts an AI write once it re-reads the new version', async () => {
    const created = await createRecord('op-human-0004');
    humanEdit(created.targetId!, '数学');

    const applied = await service.execute(
      envelope(
        {
          type: 'records.update',
          sessionId: created.targetId,
          expectedRecordVersion: 2,
          patch: { tomatodoSubject: '英语' },
        },
        'op-human-0005',
      ),
      ALL_SCOPES,
    );

    expect(applied.status).toBe('applied');
    expect(applied.recordVersion).toBe(3);
    expect(service.readRecord(created.targetId!).tomatodoSubject).toBe('英语');
  });

  it('treats cloud import as a record change so AI cannot overwrite it', async () => {
    const created = await createRecord('op-human-0006');
    notices.length = 0;
    noteRecordMutated(database, {
      sessionId: created.targetId!,
      domain: 'import',
      sourceClient: 'sync:device-v2',
    });
    expect(notices[0]?.domain).toBe('import');

    const stale = await service.execute(
      envelope(
        {
          type: 'records.update',
          sessionId: created.targetId,
          expectedRecordVersion: 1,
          patch: { title: '导入覆盖' },
        },
        'op-human-0007',
      ),
      ALL_SCOPES,
    );
    expect(stale.status).toBe('conflict');
  });

  it('rolls the version back with the transaction when the write fails', async () => {
    const created = await createRecord('op-human-0008');
    const store = new AutomationStore(database);
    expect(() =>
      store.transaction(() => {
        bumpRecordVersion(database, { sessionId: created.targetId!, domain: 'human' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(service.readRecord(created.targetId!).recordVersion).toBe(1);
  });

  it('keeps separate versions across connection scopes', async () => {
    const created = await createRecord('op-human-0009');
    humanEdit(created.targetId!, '数学');
    const otherScopeService = new AutomationService({
      database,
      timer,
      tomatodo: {
        status: () => ({
          enabled: true,
          autoSyncEnabled: false,
          minutes: 0,
          subject: '学习',
          recordName: '学习',
          writtenLocally: false,
          cloudSynced: false,
          state: 'not-written',
        }),
        sync: async () => ({
          ok: true,
          synced: 0,
          skipped: 0,
          failed: 0,
          phoneSynced: false,
          cloudSynced: false,
        }),
      },
      now: () => START,
      scope: () => 'scope-other-account',
      generation: () => 0,
      appVersion: () => '1.9.4-test',
    });
    otherScopeService.start();
    try {
      expect(otherScopeService.readRecord(created.targetId!).recordVersion).toBe(0);
      expect(service.readRecord(created.targetId!).recordVersion).toBe(2);
    } finally {
      otherScopeService.dispose();
    }
  });
});
