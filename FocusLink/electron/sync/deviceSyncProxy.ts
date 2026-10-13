/**
 * Device-sync「跟随系统代理」支持。
 *
 * 背景（2026-10-13 实测，FL-SYNC-022）：本机 Clash Verge 开 fake-ip 时把设备同步域名
 * `foxlink-mcp.focuslink-poyi-6465e9.workers.dev` 解析成 `198.18.0.6`（198.18.0.0/15 保留网段），
 * 直连 TLS 会以 `SEC_E_ILLEGAL_MESSAGE` 失败。设备同步与实时专注全部走 Node 全局 `fetch`
 * （undici），而 **undici 不读 Windows 系统代理**，于是「代理明明可用、应用却连不上」，
 * 表现为间歇性 `network_error`。Chromium（Electron）自己读系统代理，所以这里向 Electron
 * 询问解析结果，再把 undici 的请求转发到该代理。
 *
 * 约束：用户的 Clash 必须一直开着，因此本模块只做「跟随」，不修改任何系统或代理设置；
 * 回环地址（本机内嵌同步服务）永远直连，不经过代理。
 */
import { session } from 'electron';
import { ProxyAgent } from 'undici';
import { logger } from '../logger.js';
import { getSettings } from '../settingsStore.js';

export type DeviceSyncProxyReason =
  'direct' | 'proxied' | 'unsupported-proxy' | 'resolve-failed' | 'no-endpoint';

export interface DeviceSyncProxyState {
  /** 解析代理所用的 URL（设备同步端点）。 */
  endpoint: string | null;
  /** 生效的代理地址；null 表示直连。 */
  proxyUrl: string | null;
  reason: DeviceSyncProxyReason;
  updatedAt: number;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** 回环 / 本机地址判定：内嵌同步服务不能被塞进代理，否则代理一停就连不上自己。 */
export function isLoopbackUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host.endsWith('.localhost')) return true;
  return /^127\./.test(host);
}

/**
 * 解析 Chromium `resolveProxy()` 的返回串，例如 `PROXY 127.0.0.1:7897; DIRECT`、`DIRECT`、
 * `SOCKS5 127.0.0.1:7897`。只取第一个可用的条目。
 */
export function parseResolvedProxy(resolved: string): {
  url: string | null;
  reason: DeviceSyncProxyReason;
} {
  const entries = resolved
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const entry of entries) {
    const [kindRaw, ...rest] = entry.split(/\s+/);
    const kind = (kindRaw ?? '').toUpperCase();
    const target = rest.join(' ').trim();
    if (kind === 'DIRECT') return { url: null, reason: 'direct' };
    if (!target) continue;
    if (kind === 'PROXY' || kind === 'HTTPS') {
      const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `http://${target}`;
      return { url: withScheme, reason: 'proxied' };
    }
    // undici 的 ProxyAgent 只支持 HTTP CONNECT；SOCKS 只能先退回直连并如实记录原因。
    if (kind === 'SOCKS' || kind === 'SOCKS4' || kind === 'SOCKS5') {
      return { url: null, reason: 'unsupported-proxy' };
    }
  }
  return { url: null, reason: 'direct' };
}

function normalizeEndpoint(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function requestUrl(input: unknown): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === 'object' && 'url' in input) {
    const value = (input as { url?: unknown }).url;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

let activeAgent: ProxyAgent | null = null;
let originalFetch: typeof globalThis.fetch | null = null;
let state: DeviceSyncProxyState = {
  endpoint: null,
  proxyUrl: null,
  reason: 'direct',
  updatedAt: 0,
};

export function getDeviceSyncProxyState(): DeviceSyncProxyState {
  return { ...state };
}

/**
 * 只包一次全局 fetch：代理更换时换 `activeAgent`，不重复包装，避免叠加。
 */
function ensureFetchWrapper(): void {
  if (originalFetch) return;
  const base = globalThis.fetch;
  if (typeof base !== 'function') return;
  type FetchArgs = Parameters<typeof globalThis.fetch>;
  originalFetch = base;
  const patched = function patchedFetch(input: FetchArgs[0], init?: FetchArgs[1]) {
    const agent = activeAgent;
    if (!agent) return base(input, init);
    const url = requestUrl(input);
    if (!url || isLoopbackUrl(url)) return base(input, init);
    // undici 专有的 `dispatcher` 选项；DOM 的 RequestInit 类型里没有，只能断言。
    return base(input, { ...(init ?? {}), dispatcher: agent } as FetchArgs[1]);
  } as typeof globalThis.fetch;
  globalThis.fetch = patched;
}

/**
 * 按系统代理解析结果安装/更新转发器。可重复调用：端点或代理变化时自动换新。
 * 任何失败都只降级为直连并记账，绝不抛给调用方（同步链路不该因为代理探测挂掉）。
 */
export async function installDeviceSyncProxy(
  endpointOverride?: string | null,
): Promise<DeviceSyncProxyState> {
  const endpoint = normalizeEndpoint(
    endpointOverride ?? getSettings().deviceSync?.endpoint ?? null,
  );
  if (!endpoint) {
    state = { endpoint: null, proxyUrl: null, reason: 'no-endpoint', updatedAt: Date.now() };
    return getDeviceSyncProxyState();
  }

  let resolved: string;
  try {
    resolved = await session.defaultSession.resolveProxy(endpoint);
  } catch (error) {
    logger.warn('deviceSync', 'system proxy resolution failed; falling back to direct', {
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    });
    state = { endpoint, proxyUrl: null, reason: 'resolve-failed', updatedAt: Date.now() };
    return getDeviceSyncProxyState();
  }

  const parsed = parseResolvedProxy(resolved);
  if (parsed.url === state.proxyUrl && (parsed.url === null || activeAgent)) {
    state = { ...state, endpoint, reason: parsed.reason, updatedAt: Date.now() };
    return getDeviceSyncProxyState();
  }

  const previous = activeAgent;
  if (parsed.url) {
    activeAgent = new ProxyAgent({ uri: parsed.url });
    ensureFetchWrapper();
  } else {
    activeAgent = null;
  }
  if (previous && previous !== activeAgent) {
    void previous.close().catch(() => undefined);
  }

  state = { endpoint, proxyUrl: parsed.url, reason: parsed.reason, updatedAt: Date.now() };
  logger.info('deviceSync', 'node fetch proxy resolved', {
    endpoint,
    resolved,
    proxyUrl: parsed.url,
    reason: parsed.reason,
  });
  return getDeviceSyncProxyState();
}

/** 仅供测试：移除包装与转发器，恢复原始 fetch。 */
export function resetDeviceSyncProxyForTests(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
  const previous = activeAgent;
  activeAgent = null;
  if (previous) void previous.close().catch(() => undefined);
  state = { endpoint: null, proxyUrl: null, reason: 'direct', updatedAt: 0 };
}
