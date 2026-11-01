import http from 'node:http';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AUTOMATION_API_PREFIX, type AutomationScope } from '@shared/automation/contract';
import type { TimerSnapshot } from '@shared/types';

import { AutomationHttpRouter } from '../electron/automation/http';
import { AutomationService, type AutomationTimer } from '../electron/automation/service';
import { resetSchedulerForTests } from '../electron/automation/scheduler';
import { createAutomationTestDatabase } from './fixtures/automationDatabase';

const START = Date.parse('2026-11-02T09:00:00Z');

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
let server: http.Server;
let baseUrl: string;
let scopes: AutomationScope[];

beforeEach(async () => {
  resetSchedulerForTests();
  database = createAutomationTestDatabase();
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
    scope: () => 'scope-http',
    generation: () => 0,
    appVersion: () => '1.9.2-test',
  });
  service.start();
  scopes = ['focus:read'];
  const router = new AutomationHttpRouter(service);
  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    void router.handle(request, response, url, { tokenId: 'test', scopes });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  service.dispose();
  resetSchedulerForTests();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database.close();
});

async function call(
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${AUTOMATION_API_PREFIX}${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    body: init.body,
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
  };
}

describe('automation http router', () => {
  it('serves the unauthenticated health probe', async () => {
    const result = await call('/health');
    expect(result.status).toBe(200);
    expect(result.json.status).toBe('ok');
  });

  it('serves a read route for a read-only credential', async () => {
    const result = await call('/state');
    expect(result.status).toBe(200);
    expect(result.json.protocolVersion).toBe(1);
  });

  it('rejects a write command when the credential only has focus:read', async () => {
    const result = await call('/commands', {
      method: 'POST',
      body: JSON.stringify({
        operationId: 'op-http-0001',
        sourceClient: 'unit-test',
        command: {
          type: 'focus.start',
          expiresAt: START + 60_000,
          expectedControlVersion: 'idle:0:0',
          expectedState: 'idle',
        },
      }),
    });
    expect(result.status).toBe(403);
    expect((result.json.error as { code: string }).code).toBe('SCOPE_DENIED');
  });

  it('rejects malformed JSON with a stable code', async () => {
    scopes = ['focus:read', 'focus:control'];
    const result = await call('/commands', { method: 'POST', body: '{' });
    expect(result.status).toBe(400);
    expect((result.json.error as { code: string }).code).toBe('INVALID_JSON');
  });

  it('rejects an unknown route', async () => {
    const result = await call('/nope');
    expect(result.status).toBe(404);
    expect((result.json.error as { code: string }).code).toBe('ROUTE_NOT_FOUND');
  });

  it('rejects a malformed change cursor', async () => {
    const result = await call('/events?cursor=abc');
    expect(result.status).toBe(400);
    expect((result.json.error as { code: string }).code).toBe('CURSOR_INVALID');
  });

  it('rejects a preview request without tomatodo:write', async () => {
    const result = await call('/tomatodo/preview?session=missing');
    expect(result.status).toBe(403);
  });

  it('returns the schema so clients never guess field semantics', async () => {
    const result = await call('/schema');
    expect(result.status).toBe(200);
    expect(Array.isArray(result.json.commands)).toBe(true);
    expect(Array.isArray(result.json.errors)).toBe(true);
  });
});
