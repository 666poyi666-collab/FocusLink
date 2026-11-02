import crypto from 'node:crypto';
import http from 'node:http';
import { APP_VERSION } from '@shared/version';
import { AUTOMATION_API_PREFIX, AUTOMATION_LISTEN_PORT } from '@shared/automation/contract';
import type { TimerSnapshot, TimerState } from '@shared/types';
import {
  findTaskCache,
  getDb,
  getMeta,
  getSession,
  getTaskProjectName,
  listPauses,
  listSegments,
  listSessions,
  listTaskCache,
  searchTaskCache,
  setMeta,
} from '../db/index.js';
import { logger } from '../logger.js';
import type { FocusTimerController } from '../timer/focusTimerController.js';
import {
  authenticateAutomation,
  legacyTokenPath,
  loadAutomationTokens,
  writeAutomationDiscovery,
} from '../automation/auth.js';
import { AutomationHttpRouter } from '../automation/http.js';
import type { AutomationService } from '../automation/service.js';
import type {
  AutomationCommand,
  AutomationCommandResult,
  AutomationScope,
} from '@shared/automation/contract';
import {
  buildSessionCreateInput,
  buildSessionPatch,
  SessionWriteError,
} from './sessionWritePayload.js';

const HOST = '127.0.0.1';
const PORT = AUTOMATION_LISTEN_PORT;
const REVISION_KEY = 'foxlink.mcp.controlRevision';
const MAX_BODY_BYTES = 64 * 1024;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface FoxlinkBusinessApi {
  close(): Promise<void>;
  port: number;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Json,
  ) {
    super(message);
  }
}

function send(response: http.ServerResponse, status: number, value: Json): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

async function body(request: http.IncomingMessage): Promise<Record<string, Json>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_BODY_BYTES)
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    chunks.push(value);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('object required');
    return parsed as Record<string, Json>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object');
  }
}

function requiredString(value: Json | undefined, name: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new ApiError(400, 'INVALID_ARGUMENT', `${name} is required`);
  return value;
}

function requiredNumber(value: Json | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new ApiError(400, 'INVALID_ARGUMENT', `${name} must be a number`);
  return value;
}

function canonicalJson(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
    .join(',')}}`;
}

function snapshotValue(snapshot: TimerSnapshot, revision: number): Json {
  return { ...snapshot, revision } as unknown as Json;
}

function sessionDetail(id: string): Json {
  const session = getSession(id);
  if (!session) throw new ApiError(404, 'NOT_FOUND', 'Session was not found');
  return { session, segments: listSegments(id), pauses: listPauses(id) } as unknown as Json;
}

export function startFoxlinkBusinessApi(
  timer: FocusTimerController,
  automation: AutomationService | null = null,
  options: { automationDirectory?: string } = {},
): FoxlinkBusinessApi | null {
  const automationDirectory = options.automationDirectory ?? null;
  const tokens = loadAutomationTokens({ userDirectory: automationDirectory });
  if (tokens.credentials.length === 0) {
    logger.warn('foxlinkMcp', 'business API disabled because no automation credential exists', {
      tokenFile: legacyTokenPath(),
    });
    return null;
  }
  // 发现配置始终写到当前用户目录：ProgramData 常需提权写入，而 CLI 以同一用户运行。
  const discoveryFile = writeAutomationDiscovery(tokens, automationDirectory);
  logger.info('foxlinkMcp', 'automation credential loaded', {
    source: tokens.source,
    credentials: tokens.credentials.length,
    discoveryWritten: discoveryFile !== null,
  });
  const automationRouter = automation ? new AutomationHttpRouter(automation) : null;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS foxlink_api_idempotency (
      idempotency_key TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_foxlink_api_idempotency_created
      ON foxlink_api_idempotency(created_at);
  `);
  let revision = Math.max(0, Number(getMeta(REVISION_KEY) ?? 0));
  let material = '';
  const observe = (value: TimerSnapshot) => {
    const next = `${value.state}:${value.sessionId ?? ''}`;
    if (material && material !== next) {
      revision += 1;
      setMeta(REVISION_KEY, String(revision));
    }
    material = next;
  };
  observe(timer.getSnapshot());
  const unsubscribe = timer.onSnapshot(observe);
  let controlQueue = Promise.resolve();

  const runControl = async (operation: string, payload: Record<string, Json>): Promise<Json> => {
    const requestId = requiredString(payload['requestId'], 'requestId');
    const commandId = requiredString(payload['commandId'], 'commandId');
    const expectedRevision = requiredNumber(payload['expectedRevision'], 'expectedRevision');
    const expectedState = requiredString(payload['expectedState'], 'expectedState') as TimerState;
    const expiresAt = requiredNumber(payload['expiresAt'], 'expiresAt');
    const requestHash = crypto
      .createHash('sha256')
      .update(canonicalJson({ operation, payload } as unknown as Json))
      .digest('hex');
    const key = `command:${commandId}`;
    const existing = getDb()
      .prepare(
        'SELECT request_hash,response_json FROM foxlink_api_idempotency WHERE idempotency_key=?',
      )
      .get(key) as { request_hash: string; response_json: string } | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'commandId was reused with a different payload',
        );
      return JSON.parse(existing.response_json) as Json;
    }
    const requestKey = `request:${requestId}`;
    const existingRequest = getDb()
      .prepare(
        'SELECT request_hash,response_json FROM foxlink_api_idempotency WHERE idempotency_key=?',
      )
      .get(requestKey) as { request_hash: string; response_json: string } | undefined;
    if (existingRequest) {
      if (existingRequest.request_hash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'requestId was reused with a different payload',
        );
      return JSON.parse(existingRequest.response_json) as Json;
    }
    if (expiresAt <= Date.now()) throw new ApiError(409, 'COMMAND_EXPIRED', 'Command has expired');
    const current = timer.getSnapshot();
    if (revision !== expectedRevision)
      throw new ApiError(409, 'REVISION_CONFLICT', 'Control revision changed', {
        expectedRevision,
        actualRevision: revision,
      });
    if (current.state !== expectedState)
      throw new ApiError(409, 'STATE_CONFLICT', 'Timer state changed', {
        expectedState,
        actualState: current.state,
      });
    let result: TimerSnapshot;
    if (operation === 'start') {
      if (current.state !== 'idle')
        throw new ApiError(409, 'STATE_CONFLICT', 'Start requires idle state');
      result = await timer.toggle();
    } else if (operation === 'pause') result = await timer.pause();
    else if (operation === 'resume') result = await timer.resume();
    else result = await timer.stop();
    observe(result);
    const response = {
      status: 'applied',
      requestId,
      commandId,
      snapshot: snapshotValue(result, revision),
    } as unknown as Json;
    const responseJson = JSON.stringify(response);
    getDb().transaction(() => {
      const statement = getDb().prepare(
        'INSERT INTO foxlink_api_idempotency(idempotency_key,operation,request_hash,response_json,created_at) VALUES (?,?,?,?,?)',
      );
      statement.run(key, operation, requestHash, responseJson, Date.now());
      statement.run(requestKey, operation, requestHash, responseJson, Date.now());
      getDb()
        .prepare('DELETE FROM foxlink_api_idempotency WHERE created_at < ?')
        .run(Date.now() - 30 * 86400000);
    })();
    return response;
  };

  const enqueueControl = <T>(task: () => Promise<T>): Promise<T> => {
    const pending = controlQueue.then(task, task);
    controlQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };

  // ---------------------------------------------------------------------------
  // `/v1` 写接口：只做输入翻译，写入仍走自动化命令管线（版本冲突 / 幂等 / 变更日志）。
  // ---------------------------------------------------------------------------
  const WRITE_SCOPE: AutomationScope = 'records:write';

  const requireAutomation = (): AutomationService => {
    if (!automation) {
      throw new ApiError(503, 'AUTOMATION_UNAVAILABLE', 'Automation service is not available');
    }
    return automation;
  };

  const ensureWriteScope = (scopes: readonly AutomationScope[]): void => {
    if (!scopes.includes(WRITE_SCOPE)) {
      throw new ApiError(403, 'SCOPE_DENIED', 'records:write scope is required');
    }
  };

  const operationIdFor = (request: http.IncomingMessage, payload: Record<string, Json>): string => {
    const header = request.headers['idempotency-key'];
    const fromPayload = payload['operationId'];
    if (typeof fromPayload === 'string' && fromPayload.trim() !== '') return fromPayload.trim();
    if (typeof header === 'string' && header.trim() !== '') return header.trim();
    return crypto.randomUUID();
  };

  const executeAutomation = async (
    command: AutomationCommand,
    scopes: readonly AutomationScope[],
    operationId: string,
  ): Promise<AutomationCommandResult> => {
    const service = requireAutomation();
    try {
      return await service.execute(
        { operationId, sourceClient: 'focuslink-v1-api', command },
        scopes,
      );
    } catch (error) {
      const failure = (error as { failure?: { code?: string; message?: string } } | null)?.failure;
      if (failure) {
        throw new ApiError(
          422,
          failure.code ?? 'COMMAND_FAILED',
          failure.message ?? 'Command failed',
        );
      }
      throw error;
    }
  };

  const settleResult = (result: AutomationCommandResult): void => {
    if (result.status === 'applied' || result.status === 'duplicate') return;
    throw new ApiError(
      result.status === 'conflict' ? 409 : 422,
      result.error?.code ?? 'COMMAND_FAILED',
      result.error?.message ?? 'Command failed',
      (result.error?.current ?? null) as Json,
    );
  };

  const sessionSummary = (sessionId: string, recordVersion: number): Json => {
    const session = getSession(sessionId);
    if (!session) throw new ApiError(404, 'NOT_FOUND', 'Session was not found');
    return {
      id: session.id,
      title: session.title ?? null,
      note: session.note ?? null,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? null,
      activeMinutes: Math.max(1, Math.round(session.activeElapsedMs / 60_000)),
      defaultTask: session.defaultTaskId
        ? {
            taskId: session.defaultTaskId,
            taskSource: session.defaultTaskSource,
            taskTitle: session.defaultTaskTitle,
          }
        : null,
      tomatodoSubject: session.tomatodoSubject ?? null,
      tomatodoRecordName: session.tomatodoRecordName ?? null,
      updatedAt: session.updatedAt,
      recordVersion,
    } as unknown as Json;
  };

  const applySessionPatch = async (
    sessionId: string,
    payload: Record<string, Json>,
    scopes: readonly AutomationScope[],
    operationId: string,
  ): Promise<Json> => {
    ensureWriteScope(scopes);
    const service = requireAutomation();
    const session = getSession(sessionId);
    if (!session) throw new ApiError(404, 'NOT_FOUND', 'Session was not found');
    const view = service.readRecord(sessionId);
    const expectedVersionRaw = payload['expectedRecordVersion'];
    if (expectedVersionRaw !== undefined && expectedVersionRaw !== null) {
      const expected = Number(expectedVersionRaw);
      if (!Number.isInteger(expected) || expected !== view.recordVersion) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'Record version changed', {
          expectedRecordVersion: Number.isFinite(expected) ? expected : null,
          recordVersion: view.recordVersion,
        } as unknown as Json);
      }
    }
    const expectedUpdatedAtRaw = payload['expectedUpdatedAt'];
    if (expectedUpdatedAtRaw !== undefined && expectedUpdatedAtRaw !== null) {
      const expectedUpdatedAt = Number(expectedUpdatedAtRaw);
      if (!Number.isFinite(expectedUpdatedAt) || expectedUpdatedAt !== session.updatedAt) {
        throw new ApiError(409, 'STALE_UPDATED_AT', 'Session changed since expectedUpdatedAt', {
          expectedUpdatedAt: Number.isFinite(expectedUpdatedAt) ? expectedUpdatedAt : null,
          updatedAt: session.updatedAt,
        } as unknown as Json);
      }
    }
    let patch;
    try {
      patch = buildSessionPatch(payload, {
        session: {
          id: session.id,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          pauseElapsedMs: session.pauseElapsedMs,
          defaultTaskId: session.defaultTaskId,
          defaultTaskSource: session.defaultTaskSource,
          defaultTaskTitle: session.defaultTaskTitle,
        },
        findTask: (taskId) => {
          const cached = findTaskCache(taskId);
          return cached ? { id: cached.id, title: cached.title, source: cached.source } : null;
        },
      });
    } catch (error) {
      if (error instanceof SessionWriteError) {
        throw new ApiError(error.status, error.code, error.message);
      }
      throw error;
    }
    const result = await executeAutomation(
      {
        type: 'records.update',
        expiresAt: Date.now() + 60_000,
        sessionId,
        expectedRecordVersion: view.recordVersion,
        patch,
      },
      scopes,
      operationId,
    );
    settleResult(result);
    return sessionSummary(sessionId, service.readRecord(sessionId).recordVersion);
  };

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
      if (request.method === 'GET' && url.pathname === '/v1/health')
        return send(response, 200, { status: 'ok', product: 'Foxlink', version: APP_VERSION });
      if (request.method === 'GET' && url.pathname === `${AUTOMATION_API_PREFIX}/health`)
        return send(response, 200, {
          status: 'ok',
          product: 'FocusLink',
          apiVersion: '1',
          version: APP_VERSION,
        });
      // 只接受回环 Host：普通网页无法把本机端口当成可调用的跨域接口。
      const host = (request.headers.host ?? '').toLowerCase();
      if (
        host !== HOST &&
        host !== `${HOST}:${PORT}` &&
        host !== `localhost:${PORT}` &&
        host !== 'localhost'
      )
        throw new ApiError(403, 'HOST_REJECTED', 'Host header is not allowed');
      const credential = authenticateAutomation(request.headers.authorization, tokens);
      if (!credential) throw new ApiError(401, 'AUTH_FAILED', 'Authentication failed');
      if (automationRouter && (await automationRouter.handle(request, response, url, credential)))
        return;
      if (request.method === 'GET' && url.pathname === '/v1/status')
        return send(response, 200, {
          product: 'Foxlink',
          version: APP_VERSION,
          apiVersion: '1',
          timer: snapshotValue(timer.getSnapshot(), revision),
        });
      if (request.method === 'GET' && url.pathname === '/v1/capabilities')
        return send(response, 200, {
          protocolVersion: '1',
          tools: [
            'status',
            'current-session',
            'list-sessions',
            'get-session',
            'today-summary',
            'start-focus',
            'pause-focus',
            'resume-focus',
            'stop-focus',
            'list-tasks',
            'patch-session',
            'link-task',
            'unlink-task',
            'create-session',
            'batch-update-sessions',
          ],
          resources: [
            'foxlink://sessions/recent',
            'foxlink://sessions/{id}',
            'foxlink://analytics/today',
          ],
          writes: {
            requestId: true,
            commandId: true,
            revision: true,
            expectedState: true,
            expiresAt: true,
            sessionEdits: {
              scope: 'records:write',
              fields: [
                'title',
                'note',
                'tomatodoSubject',
                'tomatodoRecordName',
                'taskId',
                'minutes',
              ],
              ifMatch: 'expectedRecordVersion | expectedUpdatedAt',
              idempotency: 'operationId | Idempotency-Key',
            },
          },
        });
      if (request.method === 'GET' && url.pathname === '/v1/focus/current')
        return send(response, 200, snapshotValue(timer.getSnapshot(), revision));
      if (request.method === 'GET' && url.pathname === '/v1/sessions') {
        const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
        const limit = Number.isFinite(requestedLimit)
          ? Math.max(1, Math.min(200, Math.trunc(requestedLimit)))
          : 50;
        const items = listSessions(limit);
        return send(response, 200, { items, count: items.length } as unknown as Json);
      }
      if (request.method === 'GET' && url.pathname.startsWith('/v1/sessions/'))
        return send(
          response,
          200,
          sessionDetail(decodeURIComponent(url.pathname.slice('/v1/sessions/'.length))),
        );
      if (request.method === 'GET' && url.pathname === '/v1/analytics/today') {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const items = listSessions(1000).filter((item) => item.startedAt >= start);
        return send(response, 200, {
          date: new Date(start).toISOString().slice(0, 10),
          sessionCount: items.length,
          activeElapsedMs: items.reduce((sum, item) => sum + item.activeElapsedMs, 0),
          pauseElapsedMs: items.reduce((sum, item) => sum + item.pauseElapsedMs, 0),
        });
      }
      if (request.method === 'GET' && url.pathname === '/v1/tasks') {
        const query = (url.searchParams.get('q') ?? '').trim();
        const projectId = url.searchParams.get('projectId');
        const status = url.searchParams.get('status');
        const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
        const limit = Number.isFinite(requestedLimit)
          ? Math.max(1, Math.min(200, Math.trunc(requestedLimit)))
          : 50;
        let items = query ? searchTaskCache(query) : listTaskCache();
        if (projectId) items = items.filter((item) => item.projectId === projectId);
        if (status) items = items.filter((item) => (item.status ?? '') === status);
        const selected = items.slice(0, limit);
        return send(response, 200, {
          items: selected.map((item) => ({
            id: item.id,
            externalId: item.externalId,
            title: item.title,
            projectId: item.projectId,
            projectName: item.projectId ? getTaskProjectName(item.projectId) : null,
            status: item.status,
            source: item.source,
            tags: item.tags,
            dueDate: item.dueDate,
          })),
          count: selected.length,
        } as unknown as Json);
      }
      if (request.method === 'POST' && url.pathname === '/v1/sessions/batch-update') {
        ensureWriteScope(credential.scopes);
        const payload = await body(request);
        const ids = payload['ids'];
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50) {
          throw new ApiError(400, 'INVALID_ARGUMENT', 'ids must be a non-empty array (max 50)');
        }
        const patchPayload = payload['patch'];
        if (!patchPayload || typeof patchPayload !== 'object' || Array.isArray(patchPayload)) {
          throw new ApiError(400, 'INVALID_ARGUMENT', 'patch must be an object');
        }
        const baseOperationId = operationIdFor(request, payload);
        const results: Json[] = [];
        for (const [index, rawId] of ids.entries()) {
          const sessionId = String(rawId);
          try {
            const summary = await applySessionPatch(
              sessionId,
              patchPayload as Record<string, Json>,
              credential.scopes,
              `${baseOperationId}-${index}`,
            );
            results.push({ id: sessionId, ok: true, session: summary } as unknown as Json);
          } catch (error) {
            const apiError =
              error instanceof ApiError
                ? error
                : new ApiError(500, 'INTERNAL_ERROR', 'Internal error');
            results.push({
              id: sessionId,
              ok: false,
              status: apiError.status,
              code: apiError.code,
              message: apiError.message,
            } as unknown as Json);
            // 不是数据库事务：atomic=true 只保证遇到第一个失败就停止，已成功的条目保留。
            if (payload['atomic'] === true) break;
          }
        }
        return send(response, 200, {
          applied: results.filter((item) => (item as { ok?: boolean }).ok === true).length,
          failed: results.filter((item) => (item as { ok?: boolean }).ok !== true).length,
          results,
        } as unknown as Json);
      }
      if (request.method === 'POST' && url.pathname === '/v1/sessions') {
        ensureWriteScope(credential.scopes);
        const payload = await body(request);
        const input = (() => {
          try {
            return buildSessionCreateInput(payload, {
              findTask: (taskId) => {
                const cached = findTaskCache(taskId);
                return cached
                  ? { id: cached.id, title: cached.title, source: cached.source }
                  : null;
              },
            });
          } catch (error) {
            if (error instanceof SessionWriteError) {
              throw new ApiError(error.status, error.code, error.message);
            }
            throw error;
          }
        })();
        const result = await executeAutomation(
          { type: 'records.create', expiresAt: Date.now() + 60_000, input },
          credential.scopes,
          operationIdFor(request, payload),
        );
        settleResult(result);
        const createdId = result.targetId ?? input.sessionId;
        if (!createdId) throw new ApiError(500, 'INTERNAL_ERROR', 'Session id was not returned');
        return send(response, 201, sessionSummary(createdId, result.recordVersion ?? 0));
      }
      const taskRoute = /^\/v1\/sessions\/([^/]+)\/task$/.exec(url.pathname);
      const sessionRoute = /^\/v1\/sessions\/([^/]+)$/.exec(url.pathname);
      if (taskRoute && (request.method === 'POST' || request.method === 'DELETE')) {
        ensureWriteScope(credential.scopes);
        const sessionId = decodeURIComponent(taskRoute[1]!);
        const payload: Record<string, Json> = request.method === 'POST' ? await body(request) : {};
        const taskId =
          request.method === 'DELETE' ? null : (payload['taskId'] ?? payload['defaultTaskId']);
        if (request.method === 'POST' && (typeof taskId !== 'string' || taskId.trim() === '')) {
          throw new ApiError(400, 'INVALID_ARGUMENT', 'taskId is required');
        }
        payload['taskId'] = (taskId ?? null) as Json;
        return send(
          response,
          200,
          await applySessionPatch(
            sessionId,
            payload,
            credential.scopes,
            operationIdFor(request, payload),
          ),
        );
      }
      if (sessionRoute && request.method === 'PATCH') {
        ensureWriteScope(credential.scopes);
        const sessionId = decodeURIComponent(sessionRoute[1]!);
        const payload = await body(request);
        return send(
          response,
          200,
          await applySessionPatch(
            sessionId,
            payload,
            credential.scopes,
            operationIdFor(request, payload),
          ),
        );
      }

      const match =
        request.method === 'POST'
          ? /^\/v1\/focus\/(start|pause|resume|stop)$/.exec(url.pathname)
          : null;
      if (match) {
        const payload = await body(request);
        return send(response, 200, await enqueueControl(() => runControl(match[1], payload)));
      }
      throw new ApiError(404, 'NOT_FOUND', 'Route was not found');
    } catch (error) {
      if (error instanceof ApiError)
        send(response, error.status, {
          error: { code: error.code, message: error.message, details: error.details ?? null },
        });
      else {
        logger.error('foxlinkMcp', 'business API request failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        send(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
      }
    }
  });
  server.listen(PORT, HOST, () =>
    logger.info('foxlinkMcp', 'business API listening', { host: HOST, port: PORT }),
  );
  return {
    port: PORT,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          unsubscribe();
          resolve();
        }),
      ),
  };
}
