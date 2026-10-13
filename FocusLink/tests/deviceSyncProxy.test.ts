/**
 * 设备同步「跟随系统代理」的单元测试（FL-SYNC-022）。
 *
 * 背景：undici 不读 Windows 系统代理，Clash 的 fake-ip 会让同步域名直连失败。
 * 这里锁住三件事：代理串解析、回环地址必须直连、包装后非回环请求确实带上 dispatcher。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSettings = vi.fn();
const resolveProxy = vi.fn();

vi.mock('electron', () => ({
  session: { defaultSession: { resolveProxy: (...args: unknown[]) => resolveProxy(...args) } },
}));
vi.mock('../electron/settingsStore', () => ({
  getSettings: () => getSettings(),
}));
vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  installDeviceSyncProxy,
  isLoopbackUrl,
  parseResolvedProxy,
  resetDeviceSyncProxyForTests,
} from '../electron/sync/deviceSyncProxy';

const realFetch = globalThis.fetch;

beforeEach(() => {
  getSettings.mockReset();
  resolveProxy.mockReset();
  getSettings.mockReturnValue({ deviceSync: { endpoint: 'https://sync.example.test' } });
});

afterEach(() => {
  resetDeviceSyncProxyForTests();
  globalThis.fetch = realFetch;
});

describe('parseResolvedProxy', () => {
  it('takes the first HTTP proxy entry of a Chromium resolveProxy string', () => {
    expect(parseResolvedProxy('PROXY 127.0.0.1:7897; DIRECT')).toEqual({
      url: 'http://127.0.0.1:7897',
      reason: 'proxied',
    });
  });

  it('keeps a scheme that is already present', () => {
    expect(parseResolvedProxy('HTTPS http://proxy.local:8080')).toEqual({
      url: 'http://proxy.local:8080',
      reason: 'proxied',
    });
  });

  it('reports a direct connection when the system proxy is off', () => {
    expect(parseResolvedProxy('DIRECT')).toEqual({ url: null, reason: 'direct' });
    expect(parseResolvedProxy('')).toEqual({ url: null, reason: 'direct' });
  });

  it('does not silently pretend a SOCKS proxy was applied', () => {
    expect(parseResolvedProxy('SOCKS5 127.0.0.1:7897')).toEqual({
      url: null,
      reason: 'unsupported-proxy',
    });
  });
});

describe('isLoopbackUrl', () => {
  it('treats local hosts as direct-only', () => {
    for (const url of [
      'http://127.0.0.1:8787/sync/v2/live',
      'http://127.0.1.1:8787/x',
      'http://localhost:8787/x',
      'http://[::1]:8787/x',
      'http://focus.localhost/x',
    ]) {
      expect(isLoopbackUrl(url)).toBe(true);
    }
  });

  it('does not treat remote hosts as loopback', () => {
    expect(isLoopbackUrl('https://sync.example.test/sync/v2/live')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });
});

describe('installDeviceSyncProxy', () => {
  it('leaves fetch untouched when the system says DIRECT', async () => {
    resolveProxy.mockResolvedValue('DIRECT');
    const base = vi.fn();
    globalThis.fetch = base as unknown as typeof globalThis.fetch;

    const state = await installDeviceSyncProxy();

    expect(state.proxyUrl).toBeNull();
    expect(state.reason).toBe('direct');
    await fetch('https://sync.example.test/sync/v2/live');
    expect(base).toHaveBeenCalledTimes(1);
    expect(base.mock.calls[0]).toEqual(['https://sync.example.test/sync/v2/live']);
  });

  it('routes non-loopback requests through the resolved proxy but keeps loopback direct', async () => {
    resolveProxy.mockResolvedValue('PROXY 127.0.0.1:7897; DIRECT');
    const base = vi.fn(async () => ({ ok: true }) as unknown as Response);
    globalThis.fetch = base as unknown as typeof globalThis.fetch;

    const state = await installDeviceSyncProxy();
    expect(state.proxyUrl).toBe('http://127.0.0.1:7897');

    await fetch('https://sync.example.test/sync/v2/live');
    expect(base).toHaveBeenCalledTimes(1);
    const [, remoteInit] = base.mock.calls[0] as unknown as [string, RequestInit];
    expect(remoteInit).toMatchObject({ dispatcher: expect.anything() });

    await fetch('http://127.0.0.1:8787/sync/v2/live');
    expect(base).toHaveBeenCalledTimes(2);
    const [, localInit] = base.mock.calls[1] as unknown as [string, RequestInit];
    expect(localInit).toBeUndefined();
  });

  it('falls back to direct and records the reason when resolution throws', async () => {
    resolveProxy.mockRejectedValue(new Error('no resolver'));
    const state = await installDeviceSyncProxy();
    expect(state).toEqual(
      expect.objectContaining({
        endpoint: 'https://sync.example.test',
        proxyUrl: null,
        reason: 'resolve-failed',
      }),
    );
  });

  it('reports no-endpoint instead of probing a proxy for an empty endpoint', async () => {
    getSettings.mockReturnValue({ deviceSync: { endpoint: '' } });
    const state = await installDeviceSyncProxy();
    expect(state.reason).toBe('no-endpoint');
    expect(resolveProxy).not.toHaveBeenCalled();
  });
});
