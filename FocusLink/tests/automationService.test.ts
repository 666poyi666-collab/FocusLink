import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  AutomationCommandEnvelope,
  AutomationRecordCreateInput,
  AutomationScope,
} from '@shared/automation/contract';
import type { TimerSnapshot } from '@shared/types';

import {
  AutomationService,
  CommandFailure,
  type AutomationTimer,
  type AutomationTomatodoPort,
} from '../electron/automation/service';
import { resetSchedulerForTests } from '../electron/automation/scheduler';
import { createAutomationTestDatabase, seedSession } from './fixtures/automationDatabase';

const START = Date.parse('2026-11-02T09:00:00+08:00');
const MINUTE = 60_000;
const ALL_SCOPES: AutomationScope[] = [
  'focus:read',
  'focus:control',
  'records:write',
  'tomatodo:write',
];

function baseSnapshot(overrides: Partial<TimerSnapshot> = {}): TimerSnapshot {
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
    ...overrides,
  };
}

class FakeTimer implements AutomationTimer {
  snapshot = baseSnapshot();
  private listeners = new Set<(snapshot: TimerSnapshot) => void>();
  private sequence = 0;

  getSnapshot(): TimerSnapshot {
    return this.snapshot;
  }

  onSnapshot(listener: (snapshot: TimerSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(next: TimerSnapshot) {
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  private newSessionId(): string {
    this.sequence += 1;
    return `live-session-${this.sequence}`;
  }

  async toggle(): Promise<TimerSnapshot> {
    if (this.snapshot.state !== 'idle') return this.snapshot;
    const sessionId = this.newSessionId();
    this.emit(
      baseSnapshot({
        state: 'running',
        sessionId,
        currentSegmentId: `${sessionId}-s0`,
        lastTick: START,
      }),
    );
    return this.snapshot;
  }

  async pause(): Promise<TimerSnapshot> {
    this.emit({ ...this.snapshot, state: 'paused' });
    return this.snapshot;
  }

  async resume(): Promise<TimerSnapshot> {
    this.emit({ ...this.snapshot, state: 'running' });
    return this.snapshot;
  }

  async stop(): Promise<TimerSnapshot> {
    this.emit({ ...this.snapshot, state: 'finished' });
    return this.snapshot;
  }

  async abort(): Promise<TimerSnapshot> {
    return this.stop();
  }

  async startWithTask(
    taskId: string,
    taskSource: 'local' | 'ticktick',
    taskTitle?: string,
  ): Promise<TimerSnapshot> {
    await this.toggle();
    this.emit({
      ...this.snapshot,
      sessionDefaultTaskId: taskId,
      sessionDefaultTaskSource: taskSource,
      sessionDefaultTaskTitle: taskTitle ?? taskId,
      currentTaskId: taskId,
      currentTaskSource: taskSource,
      currentTaskTitle: taskTitle ?? taskId,
    } as TimerSnapshot);
    return this.snapshot;
  }
}

class FakeTomatodo implements AutomationTomatodoPort {
  statusCalls = 0;
  syncCalls = 0;
  writtenLocally = false;
  cloudSynced = false;
  bridgeUnavailable = false;

  status() {
    this.statusCalls += 1;
    return {
      enabled: !this.bridgeUnavailable,
      autoSyncEnabled: false,
      minutes: 45,
      subject: '数学',
      recordName: '数学',
      writtenLocally: this.writtenLocally,
      cloudSynced: this.cloudSynced,
      state: this.cloudSynced ? 'cloud-synced' : 'not-written',
    };
  }

  async sync() {
    this.syncCalls += 1;
    if (this.bridgeUnavailable) {
      return {
        ok: false,
        synced: 0,
        skipped: 0,
        failed: 1,
        phoneSynced: false,
        cloudSynced: false,
        error: 'tomatodo_bridge_unavailable',
      };
    }
    this.writtenLocally = true;
    this.cloudSynced = true;
    return {
      ok: true,
      synced: 1,
      skipped: 0,
      failed: 0,
      phoneSynced: false,
      cloudSynced: true,
    };
  }
}

let database: Database.Database;
let timer: FakeTimer;
let tomatodo: FakeTomatodo;
let clock: number;
let service: AutomationService;

function createService(overrides: { generation?: () => number; scope?: () => string } = {}) {
  return new AutomationService({
    database,
    timer,
    tomatodo,
    now: () => clock,
    scope: overrides.scope ?? (() => 'scope-test'),
    generation: overrides.generation ?? (() => 0),
    appVersion: () => '1.9.2-test',
  });
}

function envelope(
  command: Record<string, unknown>,
  operationId: string,
): AutomationCommandEnvelope {
  return {
    operationId,
    sourceClient: 'unit-test',
    command: { ...command, expiresAt: clock + MINUTE } as AutomationCommandEnvelope['command'],
  };
}

function recordInput(
  overrides: Partial<AutomationRecordCreateInput> = {},
): AutomationRecordCreateInput {
  return {
    startedAt: START,
    endedAt: START + 45 * MINUTE,
    timeline: [
      { kind: 'focus', startedAt: START, endedAt: START + 45 * MINUTE, task: null, title: '数学' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  resetSchedulerForTests();
  database = createAutomationTestDatabase();
  timer = new FakeTimer();
  tomatodo = new FakeTomatodo();
  clock = START;
  service = createService();
  service.start();
});

afterEach(() => {
  service.dispose();
  resetSchedulerForTests();
  database.close();
});

describe('automation read model', () => {
  it('reports an idle control version that identifies the connection generation', () => {
    const state = service.readState();
    expect(state.timer.state).toBe('idle');
    expect(state.timer.controlVersion).toBe('idle:0:0');
    expect(state.activeSession).toBeNull();
    expect(state.changeSeq).toBe(0);
  });

  it('never exposes notes or internal diagnostics in record views', () => {
    seedSession(database, { id: 'session-view', startedAt: START, endedAt: START + MINUTE });
    const view = service.readRecord('session-view');
    expect(Object.keys(view)).not.toContain('note');
    expect(JSON.stringify(view)).not.toContain('dbPath');
  });

  it('reports an unknown session with a stable code', () => {
    expect(() => service.readRecord('missing')).toThrowError(CommandFailure);
    try {
      service.readRecord('missing');
    } catch (error) {
      expect(error instanceof CommandFailure && error.failure.code).toBe('NOT_FOUND');
    }
  });
});

describe('automation timer control', () => {
  it('applies a start, then replays the same operation as duplicate', async () => {
    const command = envelope(
      { type: 'focus.start', expectedControlVersion: 'idle:0:0', expectedState: 'idle' },
      'op-start-0001',
    );
    const first = await service.execute(command, ALL_SCOPES);
    expect(first.status).toBe('applied');
    expect(first.controlVersion).toBe('live-session-1:1:0');

    const replay = await service.execute(command, ALL_SCOPES);
    expect(replay.status).toBe('duplicate');
    expect(replay.targetId).toBe('live-session-1');
  });

  it('replays the same business payload even when the expiry moved forward', async () => {
    const command = envelope(
      { type: 'focus.start', expectedControlVersion: 'idle:0:0', expectedState: 'idle' },
      'op-start-0007',
    );
    const first = await service.execute(command, ALL_SCOPES);
    expect(first.status).toBe('applied');
    clock += 30_000;
    const replay = await service.execute(
      { ...command, command: { ...command.command, expiresAt: clock + MINUTE } },
      ALL_SCOPES,
    );
    expect(replay.status).toBe('duplicate');
  });

  it('refuses to reuse one operationId with a different payload', async () => {
    await service.execute(
      envelope(
        { type: 'focus.start', expectedControlVersion: 'idle:0:0', expectedState: 'idle' },
        'op-start-0002',
      ),
      ALL_SCOPES,
    );
    await expect(
      service.execute(
        envelope(
          { type: 'focus.start', expectedControlVersion: 'idle:1:0', expectedState: 'idle' },
          'op-start-0002',
        ),
        ALL_SCOPES,
      ),
    ).rejects.toMatchObject({ failure: { code: 'OPERATION_ID_REUSED' } });
  });

  it('rejects a stale control version instead of overwriting a newer action', async () => {
    await service.execute(
      envelope(
        { type: 'focus.start', expectedControlVersion: 'idle:0:0', expectedState: 'idle' },
        'op-start-0003',
      ),
      ALL_SCOPES,
    );
    const stale = await service.execute(
      envelope(
        { type: 'focus.pause', expectedControlVersion: 'idle:0:0', expectedState: 'running' },
        'op-pause-0003',
      ),
      ALL_SCOPES,
    );
    expect(stale.status).toBe('conflict');
    expect(stale.error?.code).toBe('VERSION_CONFLICT');
    expect(stale.error?.current?.controlVersion).toBe('live-session-1:1:0');
  });

  it('rejects a pause when the timer is not running', async () => {
    const state = service.readState();
    const result = await service.execute(
      envelope(
        {
          type: 'focus.pause',
          expectedControlVersion: state.timer.controlVersion,
          expectedState: 'running',
        },
        'op-pause-0004',
      ),
      ALL_SCOPES,
    );
    expect(result.status).toBe('conflict');
    expect(result.error?.code).toBe('STATE_CONFLICT');
  });

  it('refuses control with a read-only credential', async () => {
    await expect(
      service.execute(
        envelope(
          { type: 'focus.start', expectedControlVersion: 'idle:0:0', expectedState: 'idle' },
          'op-start-0005',
        ),
        ['focus:read'],
      ),
    ).rejects.toMatchObject({ failure: { code: 'SCOPE_DENIED' } });
  });

  it('bumps the control version when the user changes state outside the API', async () => {
    const before = service.readState().timer.controlVersion;
    await timer.toggle();
    const after = service.readState().timer.controlVersion;
    expect(after).not.toBe(before);
    expect(after.startsWith('live-session-1:')).toBe(true);
  });

  it('treats a connection generation change as a control conflict', async () => {
    const started = await service.execute(
      envelope(
        { type: 'focus.start', expectedControlVersion: 'idle:0:0', expectedState: 'idle' },
        'op-start-0006',
      ),
      ALL_SCOPES,
    );
    expect(started.status).toBe('applied');
    service.dispose();
    service = createService({ generation: () => 1 });
    service.start();
    const result = await service.execute(
      envelope(
        {
          type: 'focus.pause',
          expectedControlVersion: started.controlVersion!,
          expectedState: 'running',
        },
        'op-pause-0006',
      ),
      ALL_SCOPES,
    );
    expect(result.status).toBe('conflict');
    expect(result.error?.code).toBe('VERSION_CONFLICT');
  });
});

describe('automation record writes', () => {
  it('creates a recorded session with conserved three times', async () => {
    const result = await service.execute(
      envelope({ type: 'records.create', input: recordInput() }, 'op-create-0001'),
      ALL_SCOPES,
    );
    expect(result.status).toBe('applied');
    expect(result.recordVersion).toBe(1);
    const view = service.readRecord(result.targetId!);
    expect(view.activeElapsedMs).toBe(45 * MINUTE);
    expect(view.pauseElapsedMs).toBe(0);
    expect(view.wallElapsedMs).toBe(45 * MINUTE);
    expect(view.segments).toHaveLength(1);
    expect(view.status).toBe('finished');
  });

  it('rejects an overlapping record and rolls the write back', async () => {
    seedSession(database, {
      id: 'existing',
      startedAt: START,
      endedAt: START + 30 * MINUTE,
    });
    const result = await service.execute(
      envelope({ type: 'records.create', input: recordInput() }, 'op-create-0002'),
      ALL_SCOPES,
    );
    expect(result.status).toBe('conflict');
    expect(result.error?.code).toBe('OVERLAPPING_RECORD');
    const rows = database.prepare('SELECT COUNT(*) AS count FROM focus_sessions').get() as {
      count: number;
    };
    expect(rows.count).toBe(1);
  });

  it('publishes a change event for every committed write', async () => {
    const result = await service.execute(
      envelope({ type: 'records.create', input: recordInput() }, 'op-create-0003'),
      ALL_SCOPES,
    );
    expect(result.changeSeq).toBe(1);
    const events = service.listEvents(0, 10);
    expect(events.items).toHaveLength(1);
    expect(events.items[0]!.entityId).toBe(result.targetId);
    expect(events.changeSeq).toBe(1);
  });

  it('updates metadata without touching the timeline', async () => {
    const created = await service.execute(
      envelope({ type: 'records.create', input: recordInput() }, 'op-create-0004'),
      ALL_SCOPES,
    );
    const updated = await service.execute(
      envelope(
        {
          type: 'records.update',
          sessionId: created.targetId,
          expectedRecordVersion: 1,
          patch: { title: '复盘', tomatodoSubject: '数学' },
        },
        'op-update-0004',
      ),
      ALL_SCOPES,
    );
    expect(updated.status).toBe('applied');
    expect(updated.recordVersion).toBe(2);
    const view = service.readRecord(created.targetId!);
    expect(view.title).toBe('复盘');
    expect(view.tomatodoSubject).toBe('数学');
    expect(view.activeElapsedMs).toBe(45 * MINUTE);
  });

  it('rejects a metadata write based on a stale record version', async () => {
    const created = await service.execute(
      envelope({ type: 'records.create', input: recordInput() }, 'op-create-0005'),
      ALL_SCOPES,
    );
    await service.execute(
      envelope(
        {
          type: 'records.update',
          sessionId: created.targetId,
          expectedRecordVersion: 1,
          patch: { title: '第一次' },
        },
        'op-update-0005a',
      ),
      ALL_SCOPES,
    );
    const stale = await service.execute(
      envelope(
        {
          type: 'records.update',
          sessionId: created.targetId,
          expectedRecordVersion: 1,
          patch: { title: '第二次' },
        },
        'op-update-0005b',
      ),
      ALL_SCOPES,
    );
    expect(stale.status).toBe('conflict');
    expect(stale.error?.code).toBe('VERSION_CONFLICT');
    expect(stale.error?.current?.recordVersion).toBe(2);
    expect(service.readRecord(created.targetId!).title).toBe('第一次');
  });

  it('replaces the timeline through a correction that keeps the reason', async () => {
    const created = await service.execute(
      envelope({ type: 'records.create', input: recordInput() }, 'op-create-0006'),
      ALL_SCOPES,
    );
    const corrected = await service.execute(
      envelope(
        {
          type: 'records.update',
          sessionId: created.targetId,
          expectedRecordVersion: 1,
          patch: {
            timeline: {
              reason: '开始时间记错了',
              startedAt: START + 5 * MINUTE,
              endedAt: START + 50 * MINUTE,
              timeline: [
                {
                  kind: 'focus',
                  startedAt: START + 5 * MINUTE,
                  endedAt: START + 50 * MINUTE,
                  task: null,
                  title: '数学',
                },
              ],
            },
          },
        },
        'op-update-0006',
      ),
      ALL_SCOPES,
    );
    expect(corrected.status).toBe('applied');
    const view = service.readRecord(created.targetId!);
    expect(view.startedAt).toBe(START + 5 * MINUTE);
    expect(view.activeElapsedMs).toBe(45 * MINUTE);
    const corrections = database
      .prepare(
        'SELECT reason, base_version, new_version FROM automation_corrections WHERE session_id = ?',
      )
      .all(created.targetId) as Array<{
      reason: string;
      base_version: number;
      new_version: number;
    }>;
    expect(corrections).toEqual([{ reason: '开始时间记错了', base_version: 1, new_version: 2 }]);
  });

  it('rejects a timeline correction with a gap and keeps the old timeline', async () => {
    const created = await service.execute(
      envelope({ type: 'records.create', input: recordInput() }, 'op-create-0007'),
      ALL_SCOPES,
    );
    const rejected = await service.execute(
      envelope(
        {
          type: 'records.update',
          sessionId: created.targetId,
          expectedRecordVersion: 1,
          patch: {
            timeline: {
              reason: '漏了一段',
              startedAt: START,
              endedAt: START + 60 * MINUTE,
              timeline: [
                {
                  kind: 'focus',
                  startedAt: START,
                  endedAt: START + 20 * MINUTE,
                  task: null,
                  title: null,
                },
                {
                  kind: 'focus',
                  startedAt: START + 30 * MINUTE,
                  endedAt: START + 60 * MINUTE,
                  task: null,
                  title: null,
                },
              ],
            },
          },
        },
        'op-update-0007',
      ),
      ALL_SCOPES,
    );
    expect(rejected.status).toBe('rejected');
    expect(rejected.error?.code).toBe('TIMELINE_GAP');
    const view = service.readRecord(created.targetId!);
    expect(view.recordVersion).toBe(1);
    expect(view.startedAt).toBe(START);
  });

  it('refuses to overwrite an active session timeline', async () => {
    seedSession(database, {
      id: 'live-session-1',
      startedAt: START,
      endedAt: START + MINUTE,
      status: 'active',
    });
    const result = await service.execute(
      envelope(
        {
          type: 'records.update',
          sessionId: 'live-session-1',
          expectedRecordVersion: 0,
          patch: {
            timeline: {
              reason: '改时长',
              startedAt: START,
              endedAt: START + 10 * MINUTE,
              timeline: [
                {
                  kind: 'focus',
                  startedAt: START,
                  endedAt: START + 10 * MINUTE,
                  task: null,
                  title: null,
                },
              ],
            },
          },
        },
        'op-update-0008',
      ),
      ALL_SCOPES,
    );
    expect(result.status).toBe('conflict');
    expect(result.error?.code).toBe('RECORD_NOT_FINISHED');
  });

  it('rejects an unsupported tomatodo subject instead of storing it', async () => {
    const result = await service.execute(
      envelope(
        {
          type: 'records.create',
          input: recordInput({ tomatodoSubject: '不存在的学科' }),
        },
        'op-create-0009',
      ),
      ALL_SCOPES,
    );
    expect(result.status).toBe('rejected');
    expect(result.error?.code).toBe('INVALID_ARGUMENT');
    const rows = database.prepare('SELECT COUNT(*) AS count FROM focus_sessions').get() as {
      count: number;
    };
    expect(rows.count).toBe(0);
  });

  it('stops replaying an operation after the idempotency result expires', async () => {
    const command = envelope({ type: 'records.create', input: recordInput() }, 'op-create-0010');
    const first = await service.execute(command, ALL_SCOPES);
    expect(first.status).toBe('applied');
    clock = START + 31 * 24 * 60 * MINUTE;
    await expect(service.execute(command, ALL_SCOPES)).rejects.toMatchObject({
      failure: { code: 'OPERATION_EXPIRED' },
    });
  });
});

describe('automation operations and events', () => {
  it('returns a stored operation result by id', async () => {
    await service.execute(
      envelope({ type: 'records.create', input: recordInput() }, 'op-create-0011'),
      ALL_SCOPES,
    );
    const operation = service.getOperation('op-create-0011');
    expect(operation.status).toBe('applied');
    expect(operation.result?.status).toBe('applied');
  });

  it('reports an unknown operation as not found', () => {
    expect(() => service.getOperation('op-missing-01')).toThrowError(CommandFailure);
  });

  it('requires a resync when the cursor fell outside the retention window', async () => {
    for (let index = 0; index < 3; index += 1) {
      await service.execute(
        envelope(
          {
            type: 'records.create',
            input: recordInput({
              startedAt: START + index * 60 * MINUTE,
              endedAt: START + index * 60 * MINUTE + 45 * MINUTE,
              timeline: [
                {
                  kind: 'focus',
                  startedAt: START + index * 60 * MINUTE,
                  endedAt: START + index * 60 * MINUTE + 45 * MINUTE,
                  task: null,
                  title: null,
                },
              ],
            }),
          },
          `op-create-20${index}`,
        ),
        ALL_SCOPES,
      );
    }
    const pruned = database.prepare('DELETE FROM automation_change_log WHERE change_seq < 3').run();
    expect(pruned.changes).toBe(2);
    const events = service.listEvents(0, 10);
    expect(events.resyncRequired).toBe(true);
    const tail = service.listEvents(2, 10);
    expect(tail.resyncRequired).toBe(false);
    expect(tail.items).toHaveLength(1);
  });
});

describe('automation tomatodo plans', () => {
  async function createRecord() {
    const created = await service.execute(
      envelope({ type: 'records.create', input: recordInput() }, 'op-create-0030'),
      ALL_SCOPES,
    );
    return created.targetId!;
  }

  it('previews a plan bound to the current record version without writing', async () => {
    const sessionId = await createRecord();
    const preview = service.buildTomatodoPreview(sessionId);
    expect(preview.requiresApproval).toBe(true);
    expect(preview.recordVersion).toBe(1);
    expect(preview.minutes).toBe(45);
    expect(preview.planId.startsWith('tp-')).toBe(true);
    expect(preview.projectedEndAt).toBe(START + 45 * MINUTE);
    expect(tomatodo.syncCalls).toBe(0);
  });

  it('syncs an approved plan and reports staged delivery without claiming phone visibility', async () => {
    const sessionId = await createRecord();
    const preview = service.buildTomatodoPreview(sessionId);
    const result = await service.execute(
      envelope({ type: 'tomatodo.sync', planId: preview.planId, sessionId }, 'op-sync-0001'),
      ALL_SCOPES,
    );
    expect(result.status).toBe('applied');
    const data = result.data as {
      stages: {
        uploadConfirmed: boolean;
        phoneDeliveryState: string;
        remoteDeleteSupported: boolean;
      };
    };
    expect(data.stages.uploadConfirmed).toBe(true);
    expect(data.stages.phoneDeliveryState).toBe('pending');
    expect(data.stages.remoteDeleteSupported).toBe(false);
  });

  it('refuses a plan whose record changed after preview', async () => {
    const sessionId = await createRecord();
    const preview = service.buildTomatodoPreview(sessionId);
    await service.execute(
      envelope(
        {
          type: 'records.update',
          sessionId,
          expectedRecordVersion: 1,
          patch: { title: '改过标题' },
        },
        'op-update-0031',
      ),
      ALL_SCOPES,
    );
    const result = await service.execute(
      envelope({ type: 'tomatodo.sync', planId: preview.planId, sessionId }, 'op-sync-0002'),
      ALL_SCOPES,
    );
    expect(result.status).toBe('conflict');
    expect(result.error?.code).toBe('PLAN_STALE');
    expect(tomatodo.syncCalls).toBe(0);
  });
});
