/**
 * 本地自动化凭据与发现配置。
 *
 * 与云端 device / OAuth token 完全分离，只用于回环业务 API，优先级固定：
 * 1. 环境变量 `FOXLINK_BUSINESS_API_TOKEN`（临时排障用）。
 * 2. `%ProgramData%\Poyi\FoxlinkMcp\tokens.json`：多条具名 token，各带显式 scope，可单独撤销。
 * 3. 旧 `business-api-token`：按兼容路径保留，默认拥有全部四个 scope，
 *    迁移时不静默轮换（否则已装好的调用方会突然失效）。
 * 4. 以上都不存在时，在**当前用户**目录首次签发一对凭据（全权 + 只读），
 *    让安装后开箱即可被 CLI 使用，不需要用户手工粘贴密钥。
 *
 * 文件里只有本机凭据，没有云端身份；发现配置只写端口与文件位置，不写密钥。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  AUTOMATION_LISTEN_PORT,
  AUTOMATION_PROTOCOL_VERSION,
  AUTOMATION_SCOPES,
  normalizeScopes,
  type AutomationScope,
} from '@shared/automation/contract';

export interface AutomationCredential {
  tokenId: string;
  scopes: AutomationScope[];
  /** 只在本进程内存里与请求头逐字节比较；不写日志、不回传。 */
  secret: string;
}

export interface AutomationTokenSet {
  credentials: AutomationCredential[];
  source: 'scoped-file' | 'legacy-file' | 'environment' | 'provisioned';
  tokenFile: string | null;
}

const TOKEN_PATTERN = /^fla_[A-Za-z0-9-]{2,32}_[A-Za-z0-9_-]{32,160}$/;

function programDataDirectory(): string {
  return path.join(
    process.env['ProgramData'] ?? path.join(os.homedir(), 'AppData', 'Local'),
    'Poyi',
    'FoxlinkMcp',
  );
}

/** 用户数据目录下的自动化配置；缺省值与打包后的 `%APPDATA%\focuslink` 对齐。 */
export function defaultUserConfigDirectory(): string {
  const roaming = process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(roaming, 'focuslink', 'automation');
}

export function legacyTokenPath(): string {
  return (
    process.env['FOXLINK_BUSINESS_API_TOKEN_FILE'] ??
    path.join(programDataDirectory(), 'business-api-token')
  );
}

export function scopedTokenPath(directory = programDataDirectory()): string {
  return process.env['FOXLINK_AUTOMATION_TOKENS_FILE'] ?? path.join(directory, 'tokens.json');
}

export function discoveryPath(directory = programDataDirectory()): string {
  return (
    process.env['FOXLINK_AUTOMATION_DISCOVERY_FILE'] ??
    path.join(directory, 'automation-discovery.json')
  );
}

/** 只接受普通文件；符号链接与目录一律拒绝，避免被替换成指向别处的凭据。 */
function readRegularFile(filePath: string): string | null {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile()) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function parseScopedTokens(raw: string): AutomationCredential[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const tokens = (parsed as { tokens?: unknown }).tokens;
  if (!Array.isArray(tokens)) return [];
  const credentials: AutomationCredential[] = [];
  for (const item of tokens) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as { id?: unknown; token?: unknown; scopes?: unknown; revoked?: unknown };
    if (record.revoked === true) continue;
    if (typeof record.id !== 'string' || !/^[A-Za-z0-9._-]{1,32}$/.test(record.id)) continue;
    if (typeof record.token !== 'string' || !TOKEN_PATTERN.test(record.token)) continue;
    const scopes = normalizeScopes(record.scopes);
    if (scopes.length === 0) continue;
    credentials.push({ tokenId: record.id, scopes, secret: record.token });
  }
  return credentials;
}

function newToken(tokenId: string): string {
  return `fla_${tokenId}_${crypto.randomBytes(36).toString('base64url')}`;
}

/** 首次签发：全权与只读各一，便于把只读 token 交给只需要读的调用方。 */
function provisionTokens(directory: string): AutomationTokenSet | null {
  const credentials: AutomationCredential[] = [
    { tokenId: 'local-default', scopes: [...AUTOMATION_SCOPES], secret: newToken('local-default') },
    { tokenId: 'local-readonly', scopes: ['focus:read'], secret: newToken('local-readonly') },
  ];
  const filePath = scopedTokenPath(directory);
  const payload = {
    version: 1,
    note: 'FocusLink 本机自动化凭据；token 等同密码，勿提交到仓库或贴进对话',
    tokens: credentials.map((credential) => ({
      id: credential.tokenId,
      token: credential.secret,
      scopes: credential.scopes,
      createdAt: Date.now(),
    })),
  };
  try {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporary, filePath);
  } catch {
    return null;
  }
  return { credentials, source: 'provisioned', tokenFile: filePath };
}

export function loadAutomationTokens(
  options: { userDirectory?: string | null } = {},
): AutomationTokenSet {
  const fromEnvironment = process.env['FOXLINK_BUSINESS_API_TOKEN']?.trim();
  if (fromEnvironment && fromEnvironment.length >= 32) {
    return {
      credentials: [
        { tokenId: 'environment', scopes: [...AUTOMATION_SCOPES], secret: fromEnvironment },
      ],
      source: 'environment',
      tokenFile: null,
    };
  }
  const programDataFile = scopedTokenPath();
  const programDataRaw = readRegularFile(programDataFile);
  if (programDataRaw) {
    const credentials = parseScopedTokens(programDataRaw);
    if (credentials.length > 0) {
      return { credentials, source: 'scoped-file', tokenFile: programDataFile };
    }
  }
  const legacyRaw = readRegularFile(legacyTokenPath())?.trim() ?? '';
  if (legacyRaw.length >= 32) {
    return {
      credentials: [{ tokenId: 'legacy-mcp', scopes: [...AUTOMATION_SCOPES], secret: legacyRaw }],
      source: 'legacy-file',
      tokenFile: legacyTokenPath(),
    };
  }
  const userDirectory = options.userDirectory ?? defaultUserConfigDirectory();
  const userFile = scopedTokenPath(userDirectory);
  const userRaw = readRegularFile(userFile);
  if (userRaw) {
    const credentials = parseScopedTokens(userRaw);
    if (credentials.length > 0) {
      return { credentials, source: 'scoped-file', tokenFile: userFile };
    }
  }
  const provisioned = provisionTokens(userDirectory);
  if (provisioned) return provisioned;
  return { credentials: [], source: 'legacy-file', tokenFile: null };
}

function equalSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * 解析 Authorization 头。返回命中凭据的 tokenId 与 scope；
 * 未命中返回 null，调用方必须按 401 fail-closed 处理。
 */
export function authenticateAutomation(
  authorization: string | undefined,
  tokens: AutomationTokenSet,
): Omit<AutomationCredential, 'secret'> | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  const presented = authorization.slice(7).trim();
  if (presented.length < 32) return null;
  for (const credential of tokens.credentials) {
    if (!equalSecret(presented, credential.secret)) continue;
    return { tokenId: credential.tokenId, scopes: credential.scopes };
  }
  return null;
}

export interface AutomationDiscovery {
  version: number;
  protocolVersion: number;
  product: 'FocusLink';
  host: string;
  port: number;
  tokenFile: string | null;
  tokenSource: AutomationTokenSet['source'];
  updatedAt: number;
}

/** 供 CLI 自动解析端口与凭据位置；不含任何密钥正文。 */
export function writeAutomationDiscovery(
  tokens: AutomationTokenSet,
  directory?: string | null,
): string | null {
  if (!tokens.tokenFile) return null;
  const target = discoveryPath(directory ?? programDataDirectory());
  const value: AutomationDiscovery = {
    version: 1,
    protocolVersion: AUTOMATION_PROTOCOL_VERSION,
    product: 'FocusLink',
    host: '127.0.0.1',
    port: AUTOMATION_LISTEN_PORT,
    tokenFile: tokens.tokenFile,
    tokenSource: tokens.source,
    updatedAt: Date.now(),
  };
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' });
    fs.renameSync(temporary, target);
    return target;
  } catch {
    return null;
  }
}

export function readAutomationDiscovery(filePath: string): AutomationDiscovery | null {
  const raw = readRegularFile(filePath);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AutomationDiscovery>;
    if (
      parsed.protocolVersion !== AUTOMATION_PROTOCOL_VERSION ||
      typeof parsed.port !== 'number' ||
      parsed.port <= 0 ||
      parsed.port > 65_535
    ) {
      return null;
    }
    return {
      version: 1,
      protocolVersion: AUTOMATION_PROTOCOL_VERSION,
      product: 'FocusLink',
      host: '127.0.0.1',
      port: parsed.port,
      tokenFile: typeof parsed.tokenFile === 'string' ? parsed.tokenFile : null,
      tokenSource: (parsed.tokenSource ?? 'legacy-file') as AutomationTokenSet['source'],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

/** CLI 侧从发现配置找到本机凭据正文；不做任何网络推断。 */
export function readTokenFromFile(filePath: string): string | null {
  const raw = readRegularFile(filePath);
  if (!raw) return null;
  const trimmed = raw.trim();
  if (TOKEN_PATTERN.test(trimmed)) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as {
      tokens?: Array<{ token?: unknown; revoked?: unknown }>;
    };
    const first = parsed.tokens?.find(
      (item) => typeof item.token === 'string' && item.revoked !== true,
    );
    return typeof first?.token === 'string' ? first.token : null;
  } catch {
    return null;
  }
}
