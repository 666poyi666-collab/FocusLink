/**
 * `/automation/v1` 回环路由。
 *
 * 只挂到既有 127.0.0.1 listener 上，不新开端口、不新起 authority。
 * 严格检查 Host、凭据、scope、JSON 字段与体积；不启用通配 CORS，
 * 普通网页无法直接调用。
 */
import type http from 'node:http';

import {
  AUTOMATION_API_PREFIX,
  AUTOMATION_MAX_BODY_BYTES,
  AUTOMATION_MAX_LIMIT,
  httpStatusForError,
  parseAutomationEnvelope,
  type AutomationCommandResult,
  type AutomationErrorCode,
  type AutomationScope,
} from '@shared/automation/contract';
import { isValidTaskTimeZone, zonedDateTimeToEpoch } from '@shared/taskRecurrence';
import { buildFocusLinkTimeContext } from '@shared/timeContext';

import { logger } from '../logger.js';
import { CommandFailure, type AutomationService } from './service.js';

export interface AutomationCredentialLike {
  tokenId: string;
  scopes: AutomationScope[];
}

class HttpFailure extends Error {
  constructor(
    readonly code: AutomationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HttpFailure';
  }
}

function fail(code: AutomationErrorCode, message: string): HttpFailure {
  return new HttpFailure(code, message);
}

function send(response: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  response.end(body);
}

function sendError(
  response: http.ServerResponse,
  code: AutomationErrorCode,
  message: string,
): void {
  send(response, httpStatusForError(code), { error: { code, message } });
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > AUTOMATION_MAX_BODY_BYTES) {
      throw fail('PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw fail('INVALID_JSON', 'Request body must be valid JSON');
  }
}

function requireScope(credential: AutomationCredentialLike, scope: AutomationScope): void {
  if (!credential.scopes.includes(scope)) {
    throw fail('SCOPE_DENIED', `${scope} scope is required`);
  }
}

function readTimezone(url: URL): string {
  const timezone = url.searchParams.get('timezone') ?? 'Asia/Shanghai';
  if (!isValidTaskTimeZone(timezone)) {
    throw fail('INVALID_ARGUMENT', 'timezone must be a valid IANA zone');
  }
  return timezone;
}

function readLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (raw === null) return 50;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw fail('INVALID_ARGUMENT', 'limit must be a positive integer');
  }
  return Math.min(value, AUTOMATION_MAX_LIMIT);
}

function readDateRange(
  url: URL,
  timezone: string,
): { from: string; to: string; start: number; endExclusive: number } {
  const now = Date.now();
  const today = buildFocusLinkTimeContext(now, timezone);
  const from = url.searchParams.get('date') ?? url.searchParams.get('from') ?? 'today';
  const to = url.searchParams.get('to') ?? from;
  const resolve = (value: string): { date: string; start: number; endExclusive: number } => {
    if (value === 'today') {
      return { date: today.localDate, start: today.dayStart, endExclusive: today.dayEndExclusive };
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw fail('INVALID_ARGUMENT', 'date must be today or YYYY-MM-DD');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const start = zonedDateTimeToEpoch(
      { year, month, day, hour: 0, minute: 0, second: 0, millisecond: 0 },
      timezone,
    );
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
    const endExclusive = zonedDateTimeToEpoch(
      {
        year: nextDay.getUTCFullYear(),
        month: nextDay.getUTCMonth() + 1,
        day: nextDay.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
      },
      timezone,
    );
    return { date: value, start, endExclusive };
  };
  const fromRange = resolve(from);
  const toRange = resolve(to);
  if (toRange.start < fromRange.start) {
    throw fail('INVALID_ARGUMENT', 'to must not be earlier than from');
  }
  return {
    from: fromRange.date,
    to: toRange.date,
    start: fromRange.start,
    endExclusive: toRange.endExclusive,
  };
}

function readCursor(url: URL): { startedAt: number; sessionId: string } | null {
  const raw = url.searchParams.get('cursor');
  if (!raw) return null;
  const separator = raw.indexOf('|');
  if (separator <= 0 || separator === raw.length - 1) {
    throw fail('CURSOR_INVALID', 'cursor is malformed');
  }
  const startedAt = Number(raw.slice(0, separator));
  const sessionId = raw.slice(separator + 1);
  if (!Number.isSafeInteger(startedAt) || startedAt < 0 || sessionId.length === 0) {
    throw fail('CURSOR_INVALID', 'cursor is malformed');
  }
  return { startedAt, sessionId };
}

function readChangeCursor(url: URL): number | null {
  const raw = url.searchParams.get('cursor');
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw fail('CURSOR_INVALID', 'cursor must be a non-negative integer change sequence');
  }
  return value;
}

export class AutomationHttpRouter {
  constructor(private readonly service: AutomationService) {}

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
    credential: AutomationCredentialLike,
  ): Promise<boolean> {
    if (!url.pathname.startsWith(`${AUTOMATION_API_PREFIX}/`)) return false;
    const route = url.pathname.slice(AUTOMATION_API_PREFIX.length);
    try {
      if (request.method === 'GET' && route === '/health') {
        send(response, 200, { status: 'ok', product: 'FocusLink', apiVersion: '1' });
        return true;
      }
      const handled = await this.route(request, response, url, route, credential);
      if (!handled) throw fail('ROUTE_NOT_FOUND', 'Route was not found');
      return true;
    } catch (error) {
      if (error instanceof HttpFailure) {
        sendError(response, error.code, error.message);
        return true;
      }
      if (error instanceof CommandFailure) {
        sendError(response, error.failure.code, error.failure.message);
        return true;
      }
      logger.error('automationApi', 'automation request failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      sendError(response, 'INTERNAL_ERROR', 'Internal error');
      return true;
    }
  }

  private async route(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
    route: string,
    credential: AutomationCredentialLike,
  ): Promise<boolean> {
    if (request.method === 'GET' && route === '/schema') {
      requireScope(credential, 'focus:read');
      send(response, 200, this.service.schema());
      return true;
    }
    if (request.method === 'GET' && route === '/doctor') {
      requireScope(credential, 'focus:read');
      send(response, 200, this.service.doctor());
      return true;
    }
    if (request.method === 'GET' && route === '/capabilities') {
      requireScope(credential, 'focus:read');
      send(response, 200, this.service.capabilities(credential.scopes));
      return true;
    }
    if (request.method === 'GET' && route === '/state') {
      requireScope(credential, 'focus:read');
      send(response, 200, this.service.readState());
      return true;
    }
    if (request.method === 'GET' && route === '/records') {
      requireScope(credential, 'focus:read');
      const timezone = readTimezone(url);
      const range = readDateRange(url, timezone);
      send(
        response,
        200,
        this.service.readRecords({
          dayStart: range.start,
          dayEndExclusive: range.endExclusive,
          localDate: range.from,
          timezone,
          limit: readLimit(url),
          after: readCursor(url),
        }),
      );
      return true;
    }
    if (request.method === 'GET' && route.startsWith('/records/')) {
      requireScope(credential, 'focus:read');
      const sessionId = decodeURIComponent(route.slice('/records/'.length));
      send(response, 200, this.service.readRecord(sessionId));
      return true;
    }
    if (request.method === 'GET' && route === '/summary') {
      requireScope(credential, 'focus:read');
      const timezone = readTimezone(url);
      const range = readDateRange(url, timezone);
      send(
        response,
        200,
        this.service.readSummary({
          from: range.from,
          to: range.to,
          timezone,
          rangeStart: range.start,
          rangeEndExclusive: range.endExclusive,
        }),
      );
      return true;
    }
    if (request.method === 'GET' && route.startsWith('/operations/')) {
      requireScope(credential, 'focus:read');
      const operationId = decodeURIComponent(route.slice('/operations/'.length));
      send(response, 200, this.service.getOperation(operationId));
      return true;
    }
    if (request.method === 'GET' && route === '/events') {
      requireScope(credential, 'focus:read');
      const cursor = readChangeCursor(url);
      const limit = readLimit(url);
      if (cursor === null) {
        send(response, 200, this.service.listEvents(null, limit));
        return true;
      }
      const wait = url.searchParams.get('wait') === 'true';
      send(
        response,
        200,
        wait
          ? await this.service.waitForEvents(cursor, limit)
          : this.service.listEvents(cursor, limit),
      );
      return true;
    }
    if (request.method === 'GET' && route === '/tomatodo/preview') {
      requireScope(credential, 'tomatodo:write');
      const sessionId = url.searchParams.get('session');
      if (!sessionId) throw fail('INVALID_ARGUMENT', 'session is required');
      send(response, 200, this.service.buildTomatodoPreview(sessionId));
      return true;
    }
    if (request.method === 'POST' && route === '/commands') {
      const body = await readJsonBody(request);
      const envelope = parseAutomationEnvelope(body);
      if (!envelope.ok) throw fail(envelope.code, envelope.message);
      const result = await this.service.execute(envelope.value, credential.scopes);
      send(response, statusForResult(result), result);
      return true;
    }
    return false;
  }
}

function statusForResult(result: AutomationCommandResult): number {
  if (result.status === 'applied' || result.status === 'duplicate') return 200;
  if (result.status === 'accepted') return 202;
  if (result.error) return httpStatusForError(result.error.code);
  return 200;
}
