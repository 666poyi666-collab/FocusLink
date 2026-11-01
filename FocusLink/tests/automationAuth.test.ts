import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  authenticateAutomation,
  discoveryPath,
  legacyTokenPath,
  loadAutomationTokens,
  readAutomationDiscovery,
  scopedTokenPath,
  writeAutomationDiscovery,
} from '../electron/automation/auth';

let root: string;
let programData: string;
let userDirectory: string;
const savedEnvironment = new Map<string, string | undefined>();

function setEnvironment(name: string, value: string) {
  if (!savedEnvironment.has(name)) savedEnvironment.set(name, process.env[name]);
  process.env[name] = value;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-automation-'));
  programData = path.join(root, 'ProgramData');
  userDirectory = path.join(root, 'user', 'automation');
  fs.mkdirSync(path.join(programData, 'Poyi', 'FoxlinkMcp'), { recursive: true });
  setEnvironment('ProgramData', programData);
  setEnvironment('APPDATA', path.join(root, 'Roaming'));
  delete process.env['FOXLINK_BUSINESS_API_TOKEN'];
  delete process.env['FOXLINK_AUTOMATION_TOKENS_FILE'];
  delete process.env['FOXLINK_AUTOMATION_DISCOVERY_FILE'];
  delete process.env['FOXLINK_BUSINESS_API_TOKEN_FILE'];
});

afterEach(() => {
  for (const [name, value] of savedEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnvironment.clear();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('automation credentials', () => {
  it('provisions a full and a read-only credential for the current user', () => {
    const tokens = loadAutomationTokens({ userDirectory });
    expect(tokens.source).toBe('provisioned');
    expect(tokens.credentials).toHaveLength(2);
    const readonly = tokens.credentials.find((entry) => entry.tokenId === 'local-readonly');
    expect(readonly?.scopes).toEqual(['focus:read']);
    const file = scopedTokenPath(userDirectory);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('authenticates each credential with exactly its own scopes', () => {
    const tokens = loadAutomationTokens({ userDirectory });
    const full = tokens.credentials.find((entry) => entry.tokenId === 'local-default')!;
    const readonly = tokens.credentials.find((entry) => entry.tokenId === 'local-readonly')!;
    expect(authenticateAutomation(`Bearer ${full.secret}`, tokens)?.scopes).toHaveLength(4);
    expect(authenticateAutomation(`Bearer ${readonly.secret}`, tokens)?.scopes).toEqual([
      'focus:read',
    ]);
    expect(authenticateAutomation(`Bearer ${'x'.repeat(40)}`, tokens)).toBeNull();
    expect(authenticateAutomation(undefined, tokens)).toBeNull();
  });

  it('reloads provisioned credentials instead of issuing new ones', () => {
    const first = loadAutomationTokens({ userDirectory });
    const second = loadAutomationTokens({ userDirectory });
    expect(second.source).toBe('scoped-file');
    expect(second.credentials.map((entry) => entry.secret)).toEqual(
      first.credentials.map((entry) => entry.secret),
    );
  });

  it('ignores a revoked credential', () => {
    loadAutomationTokens({ userDirectory });
    const file = scopedTokenPath(userDirectory);
    const payload = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      tokens: Array<{ id: string; revoked?: boolean }>;
    };
    payload.tokens[0]!.revoked = true;
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
    const tokens = loadAutomationTokens({ userDirectory });
    expect(tokens.credentials).toHaveLength(1);
    expect(tokens.credentials[0]!.tokenId).not.toBe(payload.tokens[0]!.id);
  });

  it('keeps the legacy MCP credential and never rotates it', () => {
    fs.writeFileSync(legacyTokenPath(), `${'L'.repeat(48)}\n`, 'utf8');
    const tokens = loadAutomationTokens({ userDirectory });
    expect(tokens.source).toBe('legacy-file');
    expect(tokens.credentials[0]!.secret).toBe('L'.repeat(48));
    expect(tokens.credentials[0]!.scopes).toHaveLength(4);
    expect(fs.existsSync(scopedTokenPath(userDirectory))).toBe(false);
  });

  it('writes a discovery file that never contains a secret', () => {
    const tokens = loadAutomationTokens({ userDirectory });
    const written = writeAutomationDiscovery(tokens, userDirectory);
    expect(written).toBe(discoveryPath(userDirectory));
    const raw = fs.readFileSync(written!, 'utf8');
    for (const credential of tokens.credentials) {
      expect(raw).not.toContain(credential.secret);
    }
    const discovery = readAutomationDiscovery(written!);
    expect(discovery?.port).toBe(18770);
    expect(discovery?.tokenFile).toBe(scopedTokenPath(userDirectory));
  });
});
