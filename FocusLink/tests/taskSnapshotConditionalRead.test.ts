import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  formatTaskSnapshotEtag,
  parseTaskSnapshotResponse,
  resolveTaskSnapshotConditionalRead,
  type TaskSnapshotResponse,
} from '../shared/sync/taskSnapshotProtocol';

const FULL: TaskSnapshotResponse = {
  protocolVersion: 1,
  revision: 9,
  sourceDeviceId: 'device-desktop',
  snapshot: { publishedAt: 8_000, projects: [], tasks: [] },
  serverTime: 9_000,
};
const ETAG = formatTaskSnapshotEtag({
  revision: 9,
  sourceDeviceId: 'device-desktop',
  includeScheduling: true,
});

describe('shared conditional task snapshot decision', () => {
  it('answers a matching validator with the body-free marker and the same etag', () => {
    const matched = resolveTaskSnapshotConditionalRead({
      response: FULL,
      includeScheduling: true,
      ifNoneMatch: ETAG,
    });
    expect(matched.etag).toBe(ETAG);
    expect(matched.notModified).toBe(true);
    expect(matched.body).toMatchObject({
      revision: 9,
      sourceDeviceId: 'device-desktop',
      snapshot: null,
      serverTime: 9_000,
      unchanged: true,
    });
    // The marker must stay parseable by the mobile contract, otherwise the client treats a cheap
    // idle poll as a contract violation.
    expect(parseTaskSnapshotResponse(matched.body)).toMatchObject({ unchanged: true });
    const serialized = JSON.stringify(matched.body);
    expect(serialized).not.toContain('tasks');
    expect(serialized).not.toContain('projects');
    expect(serialized.length).toBeLessThan(JSON.stringify(FULL).length);
  });

  it('returns the untouched response on a miss or without a validator', () => {
    for (const ifNoneMatch of [null, undefined, '', '"flts1-8-sched-device-desktop"', '   ']) {
      const miss = resolveTaskSnapshotConditionalRead({
        response: FULL,
        includeScheduling: true,
        ifNoneMatch,
      });
      expect(miss.notModified).toBe(false);
      expect(miss.body).toBe(FULL);
      expect(miss.etag).toBe(ETAG);
    }
  });

  it('separates the scheduling and legacy representations by tag', () => {
    const legacy = resolveTaskSnapshotConditionalRead({
      response: FULL,
      includeScheduling: false,
      ifNoneMatch: ETAG,
    });
    expect(legacy.etag).toBe('"flts1-9-legacy-device-desktop"');
    // A scheduling tag must never certify the trimmed representation.
    expect(legacy.notModified).toBe(false);
    expect(legacy.body).toBe(FULL);
  });
});

describe('production conditional read wiring', () => {
  const doSource = fs.readFileSync(
    path.join(process.cwd(), 'cloudflare', 'accountDurableObject.ts'),
    'utf8',
  );
  const workerSource = fs.readFileSync(path.join(process.cwd(), 'cloudflare', 'worker.ts'), 'utf8');
  const loopbackSource = fs.readFileSync(
    path.join(process.cwd(), 'cloud', 'deviceSyncServer.ts'),
    'utf8',
  );

  it('routes both backends through the one shared decision', () => {
    expect(doSource).toContain('resolveTaskSnapshotConditionalRead');
    expect(loopbackSource).toContain('resolveTaskSnapshotConditionalRead');
    // Divergent inline copies are exactly how local-only throttling happened before.
    expect(loopbackSource).not.toContain('taskSnapshotEtagMatches(');
    expect(doSource).not.toContain('taskSnapshotEtagMatches(');
  });

  it('lets the production task route answer conditionally', () => {
    expect(doSource).toContain('TASK_SNAPSHOT_IF_NONE_MATCH_HEADER');
    expect(doSource).toContain('etag: conditional.etag');
    expect(doSource).toContain('vary: TASK_SNAPSHOT_CAPABILITY_HEADER');
    // The pre-change route answered the register inline with no validator at all.
    const taskRoute =
      /if \(url\.pathname === '\/v1\/tasks' && request\.method === 'GET'\) \{[\s\S]*?\n      \}/.exec(
        doSource,
      );
    expect(taskRoute, 'the production task GET route must stay inspectable').not.toBeNull();
    expect(taskRoute![0]).toContain('resolveTaskSnapshotConditionalRead');
    expect(taskRoute![0]).not.toMatch(/return json\(\s*this\.getTaskSnapshot\(/);
  });

  it('keeps the validator reachable from a Capacitor WebView', () => {
    // Preflight must allow the non-safelisted request header.
    expect(workerSource).toContain('if-none-match');
    // ETag is not a CORS-safelisted response header, so it must be exposed explicitly.
    expect(workerSource).toContain("'access-control-expose-headers', 'etag'");
  });
});
