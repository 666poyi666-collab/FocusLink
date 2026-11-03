import { describe, expect, it } from 'vitest';
import type { AutomationCommand, AutomationCommandResult } from '@shared/automation/contract';
import type { FocusSession } from '@shared/types';
import {
  applySessionPatchWithDeps,
  type SessionPatchDeps,
} from '../electron/mcp/sessionPatchService';
import { SessionWriteError } from '../electron/mcp/sessionWritePayload';

const START = 1_700_000_000_000;

function makeHarness(overrides: { version?: number; updatedAt?: number } = {}) {
  const state = {
    version: overrides.version ?? 3,
    updatedAt: overrides.updatedAt ?? 111,
    calls: [] as AutomationCommand[],
    stored: new Map<string, { request_hash: string; response_json: string }>(),
  };
  const session = {
    id: 's1',
    title: null,
    status: 'finished',
    startedAt: START,
    endedAt: START + 600_000,
    activeElapsedMs: 600_000,
    pauseElapsedMs: 0,
    wallElapsedMs: 600_000,
    defaultTaskId: null,
    defaultTaskSource: null,
    defaultTaskTitle: null,
    note: null,
    createdAt: START,
    updatedAt: state.updatedAt,
    tomatodoSubject: null,
    tomatodoRecordName: null,
  } as unknown as FocusSession;
  const deps: SessionPatchDeps = {
    executeCommand: async (command) => {
      state.calls.push(command);
      state.version += 1;
      state.updatedAt += 1;
      return {
        status: 'applied',
        recordVersion: state.version,
        data: null,
        error: null,
      } as unknown as AutomationCommandResult;
    },
    readRecord: () => ({ recordVersion: state.version }),
    getSession: () => session,
    findTask: (taskId) =>
      taskId === 'task-1' ? { id: 'task-1', title: '第二章第六节', source: 'local' } : null,
    readIdempotent: (key) => state.stored.get(key),
    writeIdempotent: (key, _operation, hash, json) => {
      state.stored.set(key, { request_hash: hash, response_json: json });
    },
    hashRequest: (value) => JSON.stringify(value),
    summarize: (id, version) => ({ id, recordVersion: version }),
  };
  return { deps, state, session };
}

describe('/v1 session patch preconditions and replay', () => {
  it('rejects a stale If-Match header without writing', async () => {
    const { deps, state } = makeHarness({ version: 3 });

    await expect(
      applySessionPatchWithDeps(deps, 's1', { title: '数学' }, ['records:write'], 'op-1', '"2"'),
    ).rejects.toBeInstanceOf(SessionWriteError);

    expect(state.calls).toHaveLength(0);
    expect(state.version).toBe(3);
  });

  it('accepts a quoted weak If-Match header and forwards that version', async () => {
    const { deps, state } = makeHarness({ version: 3 });

    const summary = await applySessionPatchWithDeps(
      deps,
      's1',
      { title: '数学' },
      ['records:write'],
      'op-2',
      'W/"3"',
    );

    expect(summary.recordVersion).toBe(4);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ type: 'records.update', expectedRecordVersion: 3 });
  });

  it('rejects an If-Match header that disagrees with the body version', async () => {
    const { deps, state } = makeHarness({ version: 3 });

    await expect(
      applySessionPatchWithDeps(
        deps,
        's1',
        { title: '数学', expectedRecordVersion: 2 },
        ['records:write'],
        'op-3',
        '3',
      ),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_ARGUMENT' });
    expect(state.calls).toHaveLength(0);
  });

  it('rejects a non-integer If-Match header', async () => {
    const { deps } = makeHarness();
    await expect(
      applySessionPatchWithDeps(deps, 's1', { title: '数学' }, ['records:write'], 'op-4', '*'),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_ARGUMENT' });
  });

  it('returns the original confirmation when the same request is replayed', async () => {
    const { deps, state } = makeHarness({ version: 3 });
    const payload = { title: '数学', operationId: 'op-5' };

    const first = await applySessionPatchWithDeps(
      deps,
      's1',
      payload,
      ['records:write'],
      'op-5',
      '3',
    );
    const second = await applySessionPatchWithDeps(
      deps,
      's1',
      payload,
      ['records:write'],
      'op-5',
      '"3"',
    );

    expect(state.calls).toHaveLength(1);
    expect((second as { duplicate?: boolean }).duplicate).toBe(true);
    expect((second as { recordVersion?: number }).recordVersion).toBe(
      (first as { recordVersion?: number }).recordVersion,
    );
    expect(state.version).toBe(4);
  });

  it('replays without an explicit version even after the record advanced', async () => {
    const { deps, state } = makeHarness({ version: 3 });
    const payload = { title: '数学' };

    await applySessionPatchWithDeps(deps, 's1', payload, ['records:write'], 'op-6', undefined);
    const replay = await applySessionPatchWithDeps(
      deps,
      's1',
      payload,
      ['records:write'],
      'op-6',
      undefined,
    );

    expect(state.calls).toHaveLength(1);
    expect((replay as { duplicate?: boolean }).duplicate).toBe(true);
  });

  it('rejects the same operationId with a different payload', async () => {
    const { deps } = makeHarness({ version: 3 });
    await applySessionPatchWithDeps(deps, 's1', { title: '数学' }, ['records:write'], 'op-7', '3');

    await expect(
      applySessionPatchWithDeps(deps, 's1', { title: '英语' }, ['records:write'], 'op-7', '4'),
    ).rejects.toMatchObject({ status: 422, code: 'OPERATION_ID_REUSED' });
  });

  it('falls back to the current version when no precondition is supplied', async () => {
    const { deps, state } = makeHarness({ version: 7 });

    await applySessionPatchWithDeps(
      deps,
      's1',
      { title: '数学' },
      ['records:write'],
      'op-8',
      undefined,
    );

    expect(state.calls[0]).toMatchObject({ expectedRecordVersion: 7 });
  });

  it('rejects a stale expectedUpdatedAt before writing', async () => {
    const { deps, state } = makeHarness({ version: 3, updatedAt: 111 });

    await expect(
      applySessionPatchWithDeps(
        deps,
        's1',
        { title: '数学', expectedUpdatedAt: 110 },
        ['records:write'],
        'op-9',
        undefined,
      ),
    ).rejects.toMatchObject({ status: 409, code: 'STALE_UPDATED_AT' });
    expect(state.calls).toHaveLength(0);
  });
});
