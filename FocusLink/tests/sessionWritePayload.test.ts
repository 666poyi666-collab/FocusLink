import { describe, expect, it } from 'vitest';
import {
  buildSessionCreateInput,
  buildSessionPatch,
  SessionWriteError,
  type SessionPatchContext,
} from '../electron/mcp/sessionWritePayload';

const START = 1_700_000_000_000;

function context(overrides: Partial<SessionPatchContext['session']> = {}): SessionPatchContext {
  return {
    session: {
      id: 'session-1',
      startedAt: START,
      endedAt: START + 60_000,
      pauseElapsedMs: 0,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
      ...overrides,
    },
    findTask: (taskId) =>
      taskId === 'task-1' ? { id: 'task-1', title: '第二章第六节', source: 'local' } : null,
  };
}

function expectSessionWriteError(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
  } catch (error) {
    const failure = error as SessionWriteError;
    expect(failure).toBeInstanceOf(SessionWriteError);
    expect(failure.status).toBe(status);
    expect(failure.code).toBe(code);
    return;
  }
  throw new Error('expected a SessionWriteError');
}

describe('/v1 session write payload translation', () => {
  it('translates title, note, subject and record name, with null as clear', () => {
    const patch = buildSessionPatch(
      {
        title: ' 数学 ',
        note: null,
        tomatodoSubject: '数学',
        tomatodoRecordName: '数学',
      },
      context(),
    );

    expect(patch).toEqual({
      title: '数学',
      note: null,
      tomatodoSubject: '数学',
      tomatodoRecordName: '数学',
    });
  });

  it('resolves the task title and source from the local task cache', () => {
    const patch = buildSessionPatch({ taskId: 'task-1', title: '数学' }, context());

    expect(patch.defaultTask).toEqual({
      taskId: 'task-1',
      taskSource: 'local',
      taskTitle: '第二章第六节',
    });
  });

  it('accepts an explicit task title for tasks outside the cache', () => {
    const patch = buildSessionPatch(
      { taskId: 'external-9', taskTitle: '第二章第六节', taskSource: 'ticktick' },
      context(),
    );

    expect(patch.defaultTask).toEqual({
      taskId: 'external-9',
      taskSource: 'ticktick',
      taskTitle: '第二章第六节',
    });
  });

  it('clears the task when taskId is null', () => {
    const patch = buildSessionPatch({ defaultTaskId: null }, context());
    expect(patch.defaultTask).toBeNull();
  });

  it('rejects an unknown task without an explicit title', () => {
    expectSessionWriteError(
      () => buildSessionPatch({ taskId: 'missing' }, context()),
      404,
      'TASK_NOT_FOUND',
    );
  });

  it('builds a single focus timeline for minutes on a pause-free session', () => {
    const patch = buildSessionPatch({ minutes: 79 }, context());

    expect(patch.timeline).toMatchObject({
      reason: 'API 修正时长',
      startedAt: START,
      endedAt: START + 79 * 60_000,
    });
    expect(patch.timeline?.timeline).toHaveLength(1);
    expect(patch.timeline?.timeline[0]).toMatchObject({
      kind: 'focus',
      startedAt: START,
      endedAt: START + 79 * 60_000,
    });
  });

  it('rejects minutes when the session has pauses', () => {
    expectSessionWriteError(
      () => buildSessionPatch({ minutes: 30 }, context({ pauseElapsedMs: 5_000 })),
      422,
      'MINUTES_REQUIRES_TIMELINE',
    );
  });

  it('rejects an empty patch', () => {
    expectSessionWriteError(() => buildSessionPatch({}, context()), 400, 'INVALID_ARGUMENT');
  });

  it('rejects exact timeline corrections on this convenience route', () => {
    expectSessionWriteError(
      () => buildSessionPatch({ timeline: [] }, context()),
      400,
      'INVALID_ARGUMENT',
    );
  });

  it('builds a create input with a single focus segment', () => {
    const input = buildSessionCreateInput(
      {
        startedAt: START,
        endedAt: START + 5 * 60_000,
        minutes: 5,
        title: '数学',
        tomatodoRecordName: '数学',
        taskId: 'task-1',
      },
      context(),
    );

    expect(input).toMatchObject({
      startedAt: START,
      endedAt: START + 5 * 60_000,
      title: '数学',
      tomatodoRecordName: '数学',
      defaultTask: { taskId: 'task-1', taskTitle: '第二章第六节', taskSource: 'local' },
    });
    expect(input.timeline).toHaveLength(1);
    expect(input.timeline[0]).toMatchObject({ kind: 'focus', startedAt: START });
  });

  it('rejects a create input whose end is not after its start', () => {
    expectSessionWriteError(
      () => buildSessionCreateInput({ startedAt: START, endedAt: START }, context()),
      400,
      'INVALID_ARGUMENT',
    );
  });
});
