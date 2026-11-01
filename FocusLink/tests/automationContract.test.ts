import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_API_PREFIX,
  AUTOMATION_COMMAND_SCOPE,
  AUTOMATION_COMMAND_TYPES,
  buildAutomationSchema,
  buildCapabilitiesView,
  cliExitForError,
  httpStatusForError,
  isRetryableErrorCode,
  normalizeScopes,
  parseAutomationCommand,
  parseAutomationEnvelope,
  scopeAllows,
} from '@shared/automation/contract';

const EXPIRES = 1_900_000_000_000;

describe('automation contract parsing', () => {
  it('accepts a complete focus.start envelope', () => {
    const parsed = parseAutomationEnvelope({
      operationId: 'op-0001-abcd',
      sourceClient: 'unit-test',
      command: {
        type: 'focus.start',
        expiresAt: EXPIRES,
        expectedControlVersion: 'idle:3:0',
        expectedState: 'idle',
        task: { taskId: 't1', taskSource: 'local', taskTitle: '数学' },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.operationId).toBe('op-0001-abcd');
    expect(parsed.value.command.type).toBe('focus.start');
  });

  it('rejects a missing operationId', () => {
    const parsed = parseAutomationEnvelope({ command: { type: 'focus.pause' } });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe('INVALID_ARGUMENT');
  });

  it('rejects an operationId that is too short to be stable', () => {
    const parsed = parseAutomationEnvelope({
      operationId: 'abc',
      command: { type: 'focus.pause' },
    });
    expect(parsed.ok).toBe(false);
  });

  it('rejects an unknown command type with a stable code', () => {
    const parsed = parseAutomationCommand({ type: 'focus.toggle', expiresAt: EXPIRES });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe('UNSUPPORTED_COMMAND');
  });

  it('requires focus.pause to declare expectedState running', () => {
    const parsed = parseAutomationCommand({
      type: 'focus.pause',
      expiresAt: EXPIRES,
      expectedControlVersion: 'sess:1:0',
      expectedState: 'paused',
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe('INVALID_ARGUMENT');
  });

  it('requires a timeline for records.create', () => {
    const parsed = parseAutomationCommand({
      type: 'records.create',
      expiresAt: EXPIRES,
      input: { startedAt: 1, endedAt: 2 },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe('INVALID_ARGUMENT');
  });

  it('rejects an empty records.update patch so a write is never a no-op', () => {
    const parsed = parseAutomationCommand({
      type: 'records.update',
      expiresAt: EXPIRES,
      sessionId: 'session-1',
      expectedRecordVersion: 2,
      patch: {},
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe('INVALID_ARGUMENT');
  });

  it('rejects a plan id that is not a FocusLink plan id', () => {
    const parsed = parseAutomationCommand({
      type: 'tomatodo.sync',
      expiresAt: EXPIRES,
      planId: 'not-a-plan',
      sessionId: 'session-1',
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe('INVALID_ARGUMENT');
  });

  it('keeps an explicit null distinct from a missing field in patches', () => {
    const parsed = parseAutomationCommand({
      type: 'records.update',
      expiresAt: EXPIRES,
      sessionId: 'session-1',
      expectedRecordVersion: 0,
      patch: { title: null, tomatodoSubject: '数学' },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const patch = (parsed.value as unknown as { patch: Record<string, unknown> }).patch;
    expect(patch.title).toBeNull();
    expect(patch.tomatodoSubject).toBe('数学');
  });
});

describe('automation error mapping', () => {
  it('maps conflict codes to HTTP 409 and exit code 4', () => {
    expect(httpStatusForError('VERSION_CONFLICT')).toBe(409);
    expect(cliExitForError('VERSION_CONFLICT')).toBe(4);
    expect(cliExitForError('OVERLAPPING_RECORD')).toBe(4);
  });

  it('maps auth and argument failures to distinct exit codes', () => {
    expect(cliExitForError('AUTH_FAILED')).toBe(3);
    expect(cliExitForError('SCOPE_DENIED')).toBe(3);
    expect(cliExitForError('TIMELINE_GAP')).toBe(2);
    expect(cliExitForError('APP_NOT_RUNNING')).toBe(6);
    expect(cliExitForError('RESYNC_REQUIRED')).toBe(7);
  });

  it('falls back to a generic failure exit code for unknown codes', () => {
    expect(cliExitForError('focuslink_cli_failed')).toBe(1);
  });

  it('marks only transport-class codes retryable', () => {
    expect(isRetryableErrorCode('TOMATODO_BRIDGE_UNAVAILABLE')).toBe(true);
    expect(isRetryableErrorCode('VERSION_CONFLICT')).toBe(false);
    expect(isRetryableErrorCode('TIMELINE_GAP')).toBe(false);
  });
});

describe('automation scopes', () => {
  it('never lets a read-only token control the timer', () => {
    expect(scopeAllows(['focus:read'], 'focus:control')).toBe(false);
    expect(scopeAllows(['focus:read', 'focus:control'], 'focus:control')).toBe(true);
  });

  it('drops unknown scopes instead of widening access', () => {
    expect(normalizeScopes(['focus:read', 'focus:write', 42])).toEqual(['focus:read']);
  });

  it('maps every command type to exactly one scope', () => {
    for (const type of AUTOMATION_COMMAND_TYPES) {
      expect(AUTOMATION_COMMAND_SCOPE[type]).toBeTruthy();
    }
  });
});

describe('automation schema', () => {
  it('describes every command, read route and error code with stable numbers', () => {
    const schema = buildAutomationSchema();
    expect(schema.commands).toHaveLength(AUTOMATION_COMMAND_TYPES.length);
    expect(schema.reads.length).toBeGreaterThan(0);
    for (const route of schema.reads) {
      expect(route.path.startsWith('/')).toBe(true);
    }
    for (const error of schema.errors) {
      expect(error.httpStatus).toBeGreaterThanOrEqual(200);
      expect(error.exitCode).toBeGreaterThanOrEqual(0);
    }
    expect(AUTOMATION_API_PREFIX).toBe('/automation/v1');
  });

  it('advertises the exact scopes the caller holds', () => {
    const capabilities = buildCapabilitiesView(['focus:read']);
    expect(capabilities.scopes).toEqual(['focus:read']);
    expect(capabilities.capabilities.remoteDelete).toBe(false);
    expect(capabilities.capabilities.remoteReadback).toBe(false);
  });
});
