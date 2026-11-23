import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor() {}
  },
}));

import { validateLiveTransition } from '../cloudflare/accountDurableObject';

type LiveSession = Parameters<typeof validateLiveTransition>[0];

function session(overrides: Record<string, unknown> = {}): LiveSession {
  return {
    id: 'session-ghost',
    title: 'Focus',
    task: null,
    state: 'paused',
    startedAt: 1_000,
    updatedAt: 2_000,
    lastCommandDeviceId: 'device-desktop',
    segments: [
      {
        id: 'segment-0',
        ordinal: 0,
        startedAt: 1_000,
        endedAt: 2_000,
        task: null,
      },
    ],
    pauses: [
      {
        id: 'pause-0',
        ordinal: 0,
        segmentId: 'segment-0',
        startedAt: 2_000,
        endedAt: null,
      },
    ],
    ...overrides,
  } as unknown as LiveSession;
}

const finish = {
  commandId: 'command-finish',
  expectedRevision: 813,
  sessionId: 'session-ghost',
  action: 'finish' as const,
};
const abort = { ...finish, commandId: 'command-abort', action: 'abort' as const };

describe('Account DO live completion with an existing ledger', () => {
  it('allows finish and abort to close a stale live session even when the ledger exists', () => {
    expect(validateLiveTransition(session(), finish, true)).toBeNull();
    expect(validateLiveTransition(session(), abort, true)).toBeNull();
  });

  it('still rejects impossible transitions', () => {
    expect(validateLiveTransition(null, finish, true)).toBe('no_active_session');
    expect(validateLiveTransition(session(), { ...finish, sessionId: 'other' }, false)).toBe(
      'session_mismatch',
    );
    expect(
      validateLiveTransition(
        session(),
        { commandId: 'start', expectedRevision: 1, sessionId: 'new', action: 'start', title: 'x' },
        true,
      ),
    ).toBe('active_session_exists');
  });

  it('lets adopt claim an idle authority but never replaces an active session', () => {
    const adopt = (sessionId: string) => ({
      commandId: 'command-adopt',
      expectedRevision: 1,
      sessionId,
      action: 'adopt' as const,
      session: {
        id: sessionId,
        title: '本机任务',
        state: 'running' as const,
        startedAt: 1_000,
        clientNow: 61_000,
        segments: [{ id: 'segment-local', startedAt: 1_000, endedAt: null }],
        pauses: [],
        task: null,
      },
    });
    expect(validateLiveTransition(null, adopt('session-ghost'), false)).toBeNull();
    expect(validateLiveTransition(null, adopt('session-ghost'), true)).toBe('session_id_exists');
    expect(validateLiveTransition(session(), adopt('session-ghost'), false)).toBeNull();
    expect(validateLiveTransition(session(), adopt('other-session'), false)).toBe(
      'active_session_exists',
    );
  });

  it('keeps the stale-live cleanup wired into commands and ledger mutations', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'cloudflare', 'accountDurableObject.ts'),
      'utf8',
    );
    expect(source).toContain('if (!existingEntity) {');
    expect(source).toContain('this.discardLiveSessionIfCompleted(mutation.entityId);');
    expect(source).toContain(
      'UPDATE live_state SET revision = ?, session_json = NULL WHERE singleton = 1',
    );
  });
});
