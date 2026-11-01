#!/usr/bin/env -S npx tsx

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DEVICE_SYNC_MAX_TIMESTAMP_MS } from '../../shared/sync/deviceProtocol';
import {
  AUTOMATION_API_PREFIX,
  AUTOMATION_PROTOCOL_VERSION,
  AUTOMATION_LISTEN_PORT,
  cliExitForError,
  type AutomationScope,
} from '../../shared/automation/contract';
import {
  TASK_SNAPSHOT_MUTATION_PATH,
  TASK_SNAPSHOT_PATH,
  TASK_SNAPSHOT_CAPABILITY_HEADER,
  TASK_SNAPSHOT_SCHEDULING_CAPABILITY,
  parseTaskSnapshotMutationResponse,
  parseTaskSnapshotResponse,
  type SyncedTask,
  type TaskSnapshotMutation,
  type TaskSnapshotMutationResponse,
  type TaskSnapshotResponse,
} from '../../shared/sync/taskSnapshotProtocol';
import { normalizeTaskRecurrenceDefinition } from '../../shared/taskRecurrence';
import { buildFocusLinkTimeContext } from '../../shared/timeContext';
import type { TaskRecurrenceDefinition } from '../../shared/types';

const MAX_RESPONSE_BYTES = 1_100_000;

export interface FocusLinkCliEnvironment {
  FOCUSLINK_ENDPOINT?: string;
  FOCUSLINK_DEVICE_TOKEN?: string;
  FOCUSLINK_CLI_DEVICE_ID?: string;
  FOCUSLINK_TIME_ZONE?: string;
  FOCUSLINK_MCP_ACCESS_TOKEN?: string;
  FOCUSLINK_LOCAL_PORT?: string;
  FOCUSLINK_LOCAL_TOKEN_FILE?: string;
  FOCUSLINK_AUTOMATION_DISCOVERY_FILE?: string;
  FOCUSLINK_LOCAL_ENDPOINT?: string;
}

export interface FocusLinkCliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

type FetchLike = typeof fetch;
type FlagValue = string | true | string[];

class FocusLinkCliError extends Error {
  constructor(
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'FocusLinkCliError';
  }
}

class FocusLinkTaskClient {
  private readonly endpoint: URL;

  constructor(
    endpoint: string,
    private readonly deviceToken: string,
    private readonly deviceId: string,
    private readonly fetchImpl: FetchLike,
  ) {
    this.endpoint = validateEndpoint(endpoint);
  }

  async read(): Promise<TaskSnapshotResponse> {
    const response = await this.request(TASK_SNAPSHOT_PATH, 'GET');
    const parsed = parseTaskSnapshotResponse(await responseJson(response));
    if (!parsed) throw new FocusLinkCliError('task_authority_protocol_error');
    return parsed;
  }

  async mutate(
    mutation: TaskSnapshotMutation,
    operationId: string,
    expectedRevision: number,
  ): Promise<TaskSnapshotMutationResponse> {
    const body = {
      protocolVersion: 1,
      operationId,
      expectedRevision,
      deviceId: this.deviceId,
      mutation,
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.request(TASK_SNAPSHOT_MUTATION_PATH, 'POST', body);
        const parsed = parseTaskSnapshotMutationResponse(await responseJson(response));
        if (!parsed) throw new FocusLinkCliError('task_authority_protocol_error');
        return parsed;
      } catch (error) {
        if (
          attempt === 1 ||
          !(error instanceof FocusLinkCliError) ||
          !isRetryableMutationError(error.code)
        ) {
          throw error;
        }
      }
    }
    throw new FocusLinkCliError('task_authority_unavailable');
  }

  private async request(pathname: string, method: 'GET' | 'POST', body?: unknown) {
    const url = new URL(pathname, this.endpoint);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.deviceToken}`,
          [TASK_SNAPSHOT_CAPABILITY_HEADER]: TASK_SNAPSHOT_SCHEDULING_CAPABILITY,
          ...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new FocusLinkCliError('task_authority_unavailable');
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new FocusLinkCliError('task_authority_redirect_rejected');
    }
    if (!response.ok) {
      const code = await responseErrorCode(response);
      throw new FocusLinkCliError(code);
    }
    return response;
  }
}

export async function runFocusLinkCli(
  argv: readonly string[],
  environment: FocusLinkCliEnvironment,
  io: FocusLinkCliIo,
  fetchImpl: FetchLike = fetch,
): Promise<number> {
  try {
    const parsed = parseArguments(argv);
    if (parsed.positionals.length === 0 || parsed.flags.has('help')) {
      io.stdout(helpText());
      return 0;
    }
    const [domain, action = 'list'] = parsed.positionals;
    if (LOCAL_DOMAINS.has(domain)) {
      await runLocalCommand(domain, action, parsed, environment, io, fetchImpl);
      return 0;
    }
    const client = createClient(environment, fetchImpl);
    if (domain === 'time') {
      const snapshot = await client.read();
      const timezone =
        stringFlag(parsed.flags, 'timezone') ?? environment.FOCUSLINK_TIME_ZONE ?? 'Asia/Shanghai';
      writeJson(io, {
        authority: 'focuslink-account-do',
        revision: snapshot.revision,
        ...buildFocusLinkTimeContext(snapshot.serverTime, timezone),
      });
      return 0;
    }
    if (domain === 'projects') {
      await runProjectCommand(client, action, parsed.flags, io);
      return 0;
    }
    if (domain === 'tasks') {
      await runTaskCommand(client, action, parsed.flags, io);
      return 0;
    }
    throw new FocusLinkCliError('unknown_command');
  } catch (error) {
    const code = error instanceof FocusLinkCliError ? error.code : 'focuslink_cli_failed';
    const details = error instanceof FocusLinkCliError ? error.details : {};
    io.stderr(JSON.stringify({ ok: false, error: code, ...details }));
    return cliExitForError(code);
  }
}

async function runProjectCommand(
  client: FocusLinkTaskClient,
  action: string,
  flags: ReadonlyMap<string, FlagValue>,
  io: FocusLinkCliIo,
) {
  const snapshot = await client.read();
  const projects =
    snapshot.snapshot?.projects.filter((project) => project.source === 'local') ?? [];
  if (!projects.some((project) => project.id === 'local-inbox')) {
    projects.unshift({ id: 'local-inbox', source: 'local', name: '收件箱', color: '#16899f' });
  }
  if (action === 'list') {
    writeJson(io, { revision: snapshot.revision, projects });
    return;
  }
  if (action === 'get') {
    const projectId = requiredStringFlag(flags, 'project-id');
    const project = projects.find((candidate) => candidate.id === projectId) ?? null;
    const tasks = snapshot.snapshot?.tasks.filter((task) => task.projectId === projectId) ?? [];
    writeJson(io, {
      revision: snapshot.revision,
      project,
      taskCount: tasks.length,
      openTaskCount: tasks.filter((task) => !task.isCompleted).length,
    });
    return;
  }
  let mutation: TaskSnapshotMutation;
  if (action === 'create') {
    mutation = {
      kind: 'create_project',
      name: requiredStringFlag(flags, 'name'),
      ...optionalStringProperty(flags, 'color', 'color'),
    };
  } else if (action === 'update') {
    mutation = {
      kind: 'update_project',
      projectId: requiredStringFlag(flags, 'project-id'),
      ...optionalStringProperty(flags, 'name', 'name'),
      ...(flags.has('clear-color')
        ? { color: null }
        : optionalStringProperty(flags, 'color', 'color')),
    };
  } else if (action === 'delete') {
    mutation = { kind: 'delete_project', projectId: requiredStringFlag(flags, 'project-id') };
  } else {
    throw new FocusLinkCliError('unknown_project_command');
  }
  writeJson(io, confirmation(await writeMutation(client, mutation, snapshot.revision, flags)));
}

async function runTaskCommand(
  client: FocusLinkTaskClient,
  action: string,
  flags: ReadonlyMap<string, FlagValue>,
  io: FocusLinkCliIo,
) {
  const snapshot = await client.read();
  const tasks = snapshot.snapshot?.tasks.filter((task) => task.source === 'local') ?? [];
  if (action === 'list') {
    writeJson(io, {
      revision: snapshot.revision,
      tasks: filterTasks(tasks, flags).slice(0, integerFlag(flags, 'limit') ?? 100),
    });
    return;
  }
  if (action === 'get') {
    const taskId = requiredStringFlag(flags, 'task-id');
    writeJson(io, {
      revision: snapshot.revision,
      task: tasks.find((task) => task.id === taskId) ?? null,
      subtasks: tasks.filter((task) => task.parentId === taskId),
    });
    return;
  }
  const taskId = action === 'create' ? null : requiredStringFlag(flags, 'task-id');
  let mutation: TaskSnapshotMutation;
  if (action === 'create') {
    mutation = {
      kind: 'create_task',
      title: requiredStringFlag(flags, 'title'),
      ...optionalStringProperty(flags, 'task-id', 'taskId'),
      ...nullableStringProperty(flags, 'project-id', 'projectId', 'inbox'),
      ...nullableStringProperty(flags, 'parent-id', 'parentId', 'none'),
      ...taskMetadata(flags, false),
    };
  } else if (action === 'update') {
    mutation = {
      kind: 'update_task',
      taskId: taskId!,
      ...optionalStringProperty(flags, 'title', 'title'),
      ...nullableStringProperty(flags, 'project-id', 'projectId', 'inbox'),
      ...nullableStringProperty(flags, 'parent-id', 'parentId', 'none'),
      ...taskMetadata(flags, true),
    };
  } else if (action === 'move') {
    mutation = {
      kind: 'move_task',
      taskId: taskId!,
      projectId: nullableRequiredStringFlag(flags, 'project-id', 'inbox'),
    };
  } else if (action === 'complete' || action === 'restore') {
    mutation = {
      kind: 'set_task_completed',
      taskId: taskId!,
      completed: action === 'complete',
    };
  } else if (action === 'delete') {
    mutation = { kind: 'delete_task', taskId: taskId! };
  } else {
    throw new FocusLinkCliError('unknown_task_command');
  }
  writeJson(io, confirmation(await writeMutation(client, mutation, snapshot.revision, flags)));
}

const LOCAL_DOMAINS = new Set([
  'status',
  'focus',
  'records',
  'tomatodo',
  'operations',
  'schema',
  'doctor',
]);

const LOCAL_COMMAND_TTL_MS = 60_000;

interface LocalConnection {
  endpoint: URL;
  token: string;
  scopes: AutomationScope[];
}

function defaultConfigDirectory(): string {
  const programData = process.env['ProgramData'];
  if (programData) return path.join(programData, 'Poyi', 'FoxlinkMcp');
  return path.join(process.env['LOCALAPPDATA'] ?? process.env['HOME'] ?? '.', 'Poyi', 'FoxlinkMcp');
}

function readDiscovery(
  environment: FocusLinkCliEnvironment,
): { port: number; tokenFile: string | null } | null {
  const file =
    environment.FOCUSLINK_AUTOMATION_DISCOVERY_FILE ??
    path.join(defaultConfigDirectory(), 'automation-discovery.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      port?: unknown;
      tokenFile?: unknown;
      protocolVersion?: unknown;
    };
    if (parsed.protocolVersion !== AUTOMATION_PROTOCOL_VERSION) return null;
    if (typeof parsed.port !== 'number' || parsed.port <= 0 || parsed.port > 65_535) return null;
    return {
      port: parsed.port,
      tokenFile: typeof parsed.tokenFile === 'string' ? parsed.tokenFile : null,
    };
  } catch {
    return null;
  }
}

function readLocalTokenFile(filePath: string): { token: string; scopes: AutomationScope[] } | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
  if (raw.length >= 32 && !raw.startsWith('{')) return { token: raw, scopes: [] };
  try {
    const parsed = JSON.parse(raw) as { tokens?: Array<{ token?: unknown; scopes?: unknown }> };
    const first = parsed.tokens?.[0];
    if (!first || typeof first.token !== 'string') return null;
    const scopes = Array.isArray(first.scopes)
      ? (first.scopes.filter((scope) => typeof scope === 'string') as AutomationScope[])
      : [];
    return { token: first.token, scopes };
  } catch {
    return null;
  }
}

/** 从发现配置解析本机接口；密钥不经命令行传递。 */
function connectLocal(environment: FocusLinkCliEnvironment): LocalConnection {
  const discovery = readDiscovery(environment);
  const port =
    Number(environment.FOCUSLINK_LOCAL_PORT ?? '') || discovery?.port || AUTOMATION_LISTEN_PORT;
  const endpointInput = environment.FOCUSLINK_LOCAL_ENDPOINT ?? `http://127.0.0.1:${port}`;
  let endpoint: URL;
  try {
    endpoint = new URL(endpointInput);
    endpoint.pathname = '/';
    endpoint.search = '';
    endpoint.hash = '';
  } catch {
    throw new FocusLinkCliError('LOCAL_API_UNAVAILABLE', { reason: 'endpoint_invalid' });
  }
  const tokenFile =
    environment.FOCUSLINK_LOCAL_TOKEN_FILE ??
    discovery?.tokenFile ??
    path.join(defaultConfigDirectory(), 'business-api-token');
  const credential = readLocalTokenFile(tokenFile);
  if (!credential) {
    throw new FocusLinkCliError('AUTH_FAILED', { reason: 'token_file_missing' });
  }
  return { endpoint, token: credential.token, scopes: credential.scopes };
}

class FocusLinkLocalClient {
  constructor(
    private readonly connection: LocalConnection,
    private readonly fetchImpl: FetchLike,
  ) {}

  async get(
    route: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<unknown> {
    const url = new URL(`${AUTOMATION_API_PREFIX}${route}`, this.connection.endpoint);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return this.send(url, 'GET');
  }

  async post(route: string, body: unknown): Promise<unknown> {
    const url = new URL(`${AUTOMATION_API_PREFIX}${route}`, this.connection.endpoint);
    return this.send(url, 'POST', body);
  }

  private async send(url: URL, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.connection.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new FocusLinkCliError('APP_NOT_RUNNING', {
        hint: 'FocusLink 未运行，或本机自动化接口未开启',
      });
    }
    const payload = await responseJson(response);
    if (response.ok) return payload;
    const code = extractErrorCode(payload) ?? 'LOCAL_API_UNAVAILABLE';
    if (isRecord(payload) && isRecord(payload.error)) {
      throw new FocusLinkCliError(code, { current: payload.error });
    }
    throw new FocusLinkCliError(code);
  }
}

function extractErrorCode(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const code = value.error.code;
  return typeof code === 'string' && /^[A-Z_]{3,60}$/.test(code) ? code : null;
}

function emitResult(io: FocusLinkCliIo, result: unknown): number {
  writeJson(io, result);
  if (!isRecord(result)) return 1;
  const status = result.status;
  if (status === 'applied' || status === 'duplicate') return 0;
  if (status === 'accepted') return 6;
  const error = isRecord(result.error) ? result.error : null;
  const code = error && typeof error.code === 'string' ? error.code : 'LOCAL_API_UNAVAILABLE';
  return cliExitForError(code);
}

function timestampValue(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  throw new FocusLinkCliError('INVALID_ARGUMENT', { field, reason: 'invalid_timestamp' });
}

function normalizeTimelineItems(value: unknown): unknown {
  if (!Array.isArray(value)) {
    throw new FocusLinkCliError('INVALID_ARGUMENT', { field: 'timeline' });
  }
  return value.map((item) => {
    if (!isRecord(item)) throw new FocusLinkCliError('INVALID_ARGUMENT', { field: 'timeline' });
    return {
      ...item,
      startedAt: timestampValue(item['startedAt'], 'timeline.startedAt'),
      endedAt: timestampValue(item['endedAt'], 'timeline.endedAt'),
    };
  });
}

function normalizeRecordCreateInput(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new FocusLinkCliError('INVALID_ARGUMENT', { field: 'input' });
  return {
    ...value,
    startedAt: timestampValue(value['startedAt'], 'startedAt'),
    endedAt: timestampValue(value['endedAt'], 'endedAt'),
    timeline: normalizeTimelineItems(value['timeline']),
  };
}

function normalizeRecordPatch(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new FocusLinkCliError('INVALID_ARGUMENT', { field: 'patch' });
  const timeline = value['timeline'];
  if (!isRecord(timeline)) return value;
  return {
    ...value,
    timeline: {
      ...timeline,
      startedAt: timestampValue(timeline['startedAt'], 'timeline.startedAt'),
      endedAt: timestampValue(timeline['endedAt'], 'timeline.endedAt'),
      timeline: normalizeTimelineItems(timeline['timeline']),
    },
  };
}

function readJsonInput(
  flags: ReadonlyMap<string, FlagValue>,
  flagName: string,
  field: string,
): unknown {
  const filePath = stringFlag(flags, flagName);
  if (filePath) {
    try {
      return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
    } catch {
      throw new FocusLinkCliError('INVALID_ARGUMENT', { field, reason: 'file_unreadable' });
    }
  }
  return null;
}

function commandEnvelope(
  flags: ReadonlyMap<string, FlagValue>,
  command: Record<string, unknown>,
): Record<string, unknown> {
  const operationId = operationIdFlag(flags) ?? `cli:${crypto.randomUUID()}`;
  return { operationId, sourceClient: 'focuslink-cli', command };
}

const LOCAL_FOCUS_ACTIONS = new Set(['start', 'pause', 'resume', 'finish', 'abort', 'current']);

function readControlVersion(state: unknown): string | null {
  if (!isRecord(state) || !isRecord(state.timer)) return null;
  const value = state.timer.controlVersion;
  return typeof value === 'string' ? value : null;
}

async function runLocalCommand(
  domain: string,
  action: string,
  parsed: { positionals: string[]; flags: ReadonlyMap<string, FlagValue> },
  environment: FocusLinkCliEnvironment,
  io: FocusLinkCliIo,
  fetchImpl: FetchLike,
): Promise<number> {
  const flags = parsed.flags;
  const targets = parsed.positionals.slice(2);
  const client = new FocusLinkLocalClient(connectLocal(environment), fetchImpl);
  const timezone =
    stringFlag(flags, 'timezone') ?? environment.FOCUSLINK_TIME_ZONE ?? 'Asia/Shanghai';

  if (domain === 'status') {
    writeJson(io, await client.get('/state'));
    return 0;
  }
  if (domain === 'schema') {
    writeJson(io, await client.get('/schema'));
    return 0;
  }
  if (domain === 'doctor') {
    const health = await client.get('/doctor');
    writeJson(io, health);
    return isRecord(health) && health.ok === true ? 0 : 6;
  }
  if (domain === 'operations') {
    if (action !== 'get') throw new FocusLinkCliError('unknown_command');
    const operationId = targets[0] ?? requiredStringFlag(flags, 'operation-id');
    writeJson(io, await client.get(`/operations/${encodeURIComponent(operationId)}`));
    return 0;
  }
  if (domain === 'records') {
    if (action === 'list') {
      writeJson(
        io,
        await client.get('/records', {
          date: stringFlag(flags, 'date') ?? 'today',
          timezone,
          limit: integerFlag(flags, 'limit') ?? undefined,
          cursor: stringFlag(flags, 'cursor'),
        }),
      );
      return 0;
    }
    if (action === 'get') {
      const sessionId = targets[0] ?? requiredStringFlag(flags, 'session');
      writeJson(io, await client.get(`/records/${encodeURIComponent(sessionId)}`));
      return 0;
    }
    if (action === 'create') {
      const raw = readJsonInput(flags, 'input-file', 'input') ?? {};
      const command = {
        type: 'records.create',
        expiresAt: Date.now() + LOCAL_COMMAND_TTL_MS,
        input: normalizeRecordCreateInput(raw),
      };
      return emitResult(io, await client.post('/commands', commandEnvelope(flags, command)));
    }
    if (action === 'update') {
      const sessionId = targets[0] ?? requiredStringFlag(flags, 'session');
      const expected = integerFlag(flags, 'if-version');
      if (expected === null) throw new FocusLinkCliError('missing_if_version');
      const raw = readJsonInput(flags, 'input-file', 'patch') ?? {};
      const command = {
        type: 'records.update',
        expiresAt: Date.now() + LOCAL_COMMAND_TTL_MS,
        sessionId,
        expectedRecordVersion: expected,
        patch: normalizeRecordPatch(raw),
      };
      return emitResult(io, await client.post('/commands', commandEnvelope(flags, command)));
    }
    throw new FocusLinkCliError('unknown_records_command');
  }
  if (domain === 'tomatodo') {
    if (action === 'preview') {
      const sessionId = targets[0] ?? requiredStringFlag(flags, 'session');
      writeJson(io, await client.get('/tomatodo/preview', { session: sessionId }));
      return 0;
    }
    if (action === 'sync') {
      const planId = stringFlag(flags, 'plan') ?? targets[0];
      if (!planId) throw new FocusLinkCliError('missing_plan');
      const sessionId = stringFlag(flags, 'session') ?? targets[1];
      if (!sessionId) throw new FocusLinkCliError('missing_session');
      const command = {
        type: 'tomatodo.sync',
        expiresAt: Date.now() + LOCAL_COMMAND_TTL_MS,
        planId,
        sessionId,
      };
      return emitResult(io, await client.post('/commands', commandEnvelope(flags, command)));
    }
    throw new FocusLinkCliError('unknown_tomatodo_command');
  }
  if (domain === 'focus') {
    if (action === 'current') {
      writeJson(io, await client.get('/state'));
      return 0;
    }
    if (!LOCAL_FOCUS_ACTIONS.has(action)) throw new FocusLinkCliError('unknown_focus_command');
    const state = await client.get('/state');
    const controlVersion = stringFlag(flags, 'if-control-version') ?? readControlVersion(state);
    if (!controlVersion) {
      throw new FocusLinkCliError('LOCAL_API_UNAVAILABLE', { reason: 'state_missing' });
    }
    const timerState = isRecord(state) && isRecord(state.timer) ? state.timer.state : null;
    let expectedState: 'idle' | 'running' | 'paused';
    if (action === 'start') expectedState = 'idle';
    else if (action === 'pause') expectedState = 'running';
    else if (action === 'resume') expectedState = 'paused';
    else if (timerState === 'running' || timerState === 'paused') expectedState = timerState;
    else throw new FocusLinkCliError('STATE_CONFLICT', { state: timerState });
    const command: Record<string, unknown> = {
      type: `focus.${action}`,
      expiresAt: Date.now() + LOCAL_COMMAND_TTL_MS,
      expectedControlVersion: controlVersion,
      expectedState,
    };
    if (action === 'start') {
      const taskId = stringFlag(flags, 'task-id');
      if (taskId) {
        command.task = {
          taskId,
          taskSource: stringFlag(flags, 'task-source') ?? 'local',
          taskTitle: stringFlag(flags, 'task-title') ?? taskId,
        };
      }
      const title = stringFlag(flags, 'title');
      if (title) command.title = title;
    }
    return emitResult(io, await client.post('/commands', commandEnvelope(flags, command)));
  }
  throw new FocusLinkCliError('unknown_command');
}

function taskMetadata(flags: ReadonlyMap<string, FlagValue>, allowClear: boolean) {
  const metadata: Record<string, unknown> = {};
  const priority = priorityFlag(flags);
  if (priority !== null) metadata.priority = priority;
  else if (allowClear && flags.has('clear-priority')) metadata.priority = null;
  const startDate = dateFlag(flags, 'start');
  if (startDate !== undefined) metadata.startDate = startDate;
  else if (allowClear && flags.has('clear-start')) metadata.startDate = null;
  const dueDate = dateFlag(flags, 'due');
  if (dueDate !== undefined) metadata.dueDate = dueDate;
  else if (allowClear && flags.has('clear-due')) metadata.dueDate = null;
  const tags = listFlag(flags, 'tag');
  if (tags.length > 0 || flags.has('tags')) metadata.tags = tags;
  else if (allowClear && flags.has('clear-tags')) metadata.tags = [];
  if (flags.has('clear-recurrence')) metadata.recurrence = null;
  else if (flags.has('frequency')) metadata.recurrence = recurrenceFromFlags(flags);
  return metadata;
}

function recurrenceFromFlags(flags: ReadonlyMap<string, FlagValue>): TaskRecurrenceDefinition {
  const value = {
    timezone: stringFlag(flags, 'timezone') ?? 'Asia/Shanghai',
    frequency: requiredStringFlag(flags, 'frequency'),
    interval: integerFlag(flags, 'interval') ?? 1,
    byWeekday: integerListFlag(flags, 'weekdays'),
    byMonthDay: integerListFlag(flags, 'month-days'),
    endAt: dateFlag(flags, 'repeat-end') ?? null,
    count: integerFlag(flags, 'repeat-count'),
    rollover: stringFlag(flags, 'rollover') ?? 'from_schedule',
  };
  const recurrence = normalizeTaskRecurrenceDefinition(value);
  if (!recurrence) throw new FocusLinkCliError('invalid_recurrence');
  return recurrence;
}

function filterTasks(tasks: readonly SyncedTask[], flags: ReadonlyMap<string, FlagValue>) {
  const query = stringFlag(flags, 'query')?.toLocaleLowerCase();
  const projectId = stringFlag(flags, 'project-id');
  const priority = priorityFlag(flags);
  const dueFrom = dateFlag(flags, 'due-from');
  const dueTo = dateFlag(flags, 'due-to');
  const startFrom = dateFlag(flags, 'start-from');
  const startTo = dateFlag(flags, 'start-to');
  const tags = listFlag(flags, 'tag');
  return tasks.filter((task) => {
    if (!flags.has('include-completed') && task.isCompleted) return false;
    if (projectId && task.projectId !== (projectId === 'inbox' ? 'local-inbox' : projectId))
      return false;
    if (priority !== null && task.priority !== priority) return false;
    if (dueFrom !== undefined && (task.dueDate ?? -1) < dueFrom) return false;
    if (dueTo !== undefined && (task.dueDate ?? Infinity) >= dueTo) return false;
    if (startFrom !== undefined && (task.startDate ?? -1) < startFrom) return false;
    if (startTo !== undefined && (task.startDate ?? Infinity) >= startTo) return false;
    if (tags.some((tag) => !task.tags.includes(tag))) return false;
    return (
      !query ||
      task.title.toLocaleLowerCase().includes(query) ||
      task.tags.some((tag) => tag.toLocaleLowerCase().includes(query))
    );
  });
}

async function writeMutation(
  client: FocusLinkTaskClient,
  mutation: TaskSnapshotMutation,
  observedRevision: number,
  flags: ReadonlyMap<string, FlagValue>,
) {
  const expectedRevision = integerFlag(flags, 'expected-revision') ?? observedRevision;
  const operationId = operationIdFlag(flags) ?? `cli:${crypto.randomUUID()}`;
  try {
    return await client.mutate(mutation, operationId, expectedRevision);
  } catch (error) {
    const code = error instanceof FocusLinkCliError ? error.code : 'task_mutation_failed';
    throw new FocusLinkCliError(code, { operationId, expectedRevision });
  }
}

function confirmation(response: TaskSnapshotMutationResponse) {
  return {
    authority: 'focuslink-account-do',
    operationId: response.operationId,
    status: response.status,
    revision: response.revision,
    result: response.result,
    confirmed: true,
  };
}

function isRetryableMutationError(code: string): boolean {
  return (
    code === 'task_authority_unavailable' ||
    code === 'focuslink_authority_unavailable' ||
    code === 'authoritative_upstream_unreachable' ||
    code === 'authoritative_upstream_timeout'
  );
}

function createClient(environment: FocusLinkCliEnvironment, fetchImpl: FetchLike) {
  const endpoint = environment.FOCUSLINK_ENDPOINT;
  const token = environment.FOCUSLINK_DEVICE_TOKEN;
  if (!token) {
    if (environment.FOCUSLINK_MCP_ACCESS_TOKEN) {
      throw new FocusLinkCliError('device_credential_required_oauth_token_not_accepted');
    }
    throw new FocusLinkCliError('focuslink_device_token_missing');
  }
  if (!endpoint) throw new FocusLinkCliError('focuslink_endpoint_missing');
  const tokenMatch = /^fl2_[A-Za-z0-9-]{6,80}_([A-Za-z0-9-]{6,80})_[A-Za-z0-9_-]{32,160}$/.exec(
    token,
  );
  if (!tokenMatch) {
    throw new FocusLinkCliError('focuslink_device_token_invalid');
  }
  const boundDeviceId = `device-${tokenMatch[1]}`;
  const deviceId = environment.FOCUSLINK_CLI_DEVICE_ID ?? boundDeviceId;
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(deviceId)) {
    throw new FocusLinkCliError('focuslink_cli_device_id_invalid');
  }
  if (deviceId !== boundDeviceId) {
    throw new FocusLinkCliError('focuslink_cli_device_identity_mismatch');
  }
  return new FocusLinkTaskClient(endpoint, token, deviceId, fetchImpl);
}

function validateEndpoint(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FocusLinkCliError('focuslink_endpoint_invalid');
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new FocusLinkCliError('focuslink_endpoint_invalid');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

async function responseJson(response: Response): Promise<unknown> {
  let body: ArrayBuffer;
  try {
    body = await response.arrayBuffer();
  } catch {
    throw new FocusLinkCliError('task_authority_unavailable');
  }
  const bytes = new Uint8Array(body);
  if (bytes.byteLength > MAX_RESPONSE_BYTES)
    throw new FocusLinkCliError('task_authority_response_too_large');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new FocusLinkCliError('task_authority_protocol_error');
  }
}

async function responseErrorCode(response: Response): Promise<string> {
  try {
    const value = await responseJson(response);
    if (
      isRecord(value) &&
      typeof value.error === 'string' &&
      /^[a-z0-9_:-]{1,100}$/.test(value.error)
    ) {
      return value.error;
    }
    if (
      isRecord(value) &&
      isRecord(value.error) &&
      typeof value.error.code === 'string' &&
      /^[a-z0-9_:-]{1,100}$/.test(value.error.code)
    ) {
      return value.error.code;
    }
  } catch {
    // Fall through to a status-only error; response bodies are never echoed.
  }
  if (response.status === 401) return 'device_credential_rejected';
  if (response.status === 403) return 'device_scope_denied';
  if (response.status === 409) return 'task_revision_conflict';
  return response.status >= 500 ? 'task_authority_unavailable' : 'task_mutation_rejected';
}

function parseArguments(argv: readonly string[]) {
  const positionals: string[] = [];
  const flags = new Map<string, FlagValue>();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const [rawName, inline] = value.slice(2).split('=', 2);
    const next = inline ?? (argv[index + 1]?.startsWith('--') ? undefined : argv[index + 1]);
    const flagValue: string | true = next === undefined ? true : next;
    if (inline === undefined && next !== undefined) index += 1;
    const previous = flags.get(rawName!);
    flags.set(
      rawName!,
      previous === undefined
        ? flagValue
        : Array.isArray(previous)
          ? [...previous, String(flagValue)]
          : [String(previous), String(flagValue)],
    );
  }
  return { positionals, flags };
}

function stringFlag(flags: ReadonlyMap<string, FlagValue>, name: string): string | undefined {
  const value = flags.get(name);
  if (value === undefined || value === true) return undefined;
  return Array.isArray(value) ? value.at(-1) : value;
}

function requiredStringFlag(flags: ReadonlyMap<string, FlagValue>, name: string): string {
  const value = stringFlag(flags, name)?.trim();
  if (!value) throw new FocusLinkCliError(`missing_${name.replaceAll('-', '_')}`);
  return value;
}

function integerFlag(flags: ReadonlyMap<string, FlagValue>, name: string): number | null {
  const raw = stringFlag(flags, name);
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FocusLinkCliError(`invalid_${name.replaceAll('-', '_')}`);
  }
  return value;
}

function priorityFlag(flags: ReadonlyMap<string, FlagValue>): number | null {
  const value = integerFlag(flags, 'priority');
  if (value !== null && value > 5) throw new FocusLinkCliError('invalid_priority');
  return value;
}

function operationIdFlag(flags: ReadonlyMap<string, FlagValue>): string | undefined {
  const value = stringFlag(flags, 'operation-id');
  if (
    value !== undefined &&
    (value.length < 8 || value.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(value))
  ) {
    throw new FocusLinkCliError('invalid_operation_id');
  }
  return value;
}

function dateFlag(flags: ReadonlyMap<string, FlagValue>, name: string): number | undefined {
  const raw = stringFlag(flags, name);
  if (raw === undefined) return undefined;
  const numeric = Number(raw);
  const value = Number.isFinite(numeric) ? numeric : Date.parse(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > DEVICE_SYNC_MAX_TIMESTAMP_MS) {
    throw new FocusLinkCliError(`invalid_${name.replaceAll('-', '_')}`);
  }
  return value;
}

function listFlag(flags: ReadonlyMap<string, FlagValue>, name: string): string[] {
  const raw = flags.get(name);
  if (raw === undefined || raw === true) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return [
    ...new Set(
      values
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function integerListFlag(flags: ReadonlyMap<string, FlagValue>, name: string): number[] {
  return listFlag(flags, name)
    .map(Number)
    .sort((left, right) => left - right);
}

function optionalStringProperty(
  flags: ReadonlyMap<string, FlagValue>,
  flag: string,
  property: string,
) {
  const value = stringFlag(flags, flag);
  return value === undefined ? {} : { [property]: value };
}

function nullableStringProperty(
  flags: ReadonlyMap<string, FlagValue>,
  flag: string,
  property: string,
  nullValue: string,
) {
  const value = stringFlag(flags, flag);
  return value === undefined ? {} : { [property]: value === nullValue ? null : value };
}

function nullableRequiredStringFlag(
  flags: ReadonlyMap<string, FlagValue>,
  name: string,
  nullValue: string,
) {
  const value = requiredStringFlag(flags, name);
  return value === nullValue ? null : value;
}

function writeJson(io: FocusLinkCliIo, value: unknown) {
  io.stdout(JSON.stringify(value, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function helpText() {
  return `FocusLink CLI

本机命令（只访问本机回环接口，不经过云端）：
  status --json
  focus current --json
  focus start|pause|resume|finish|abort [--if-control-version <v>] [--operation-id <id>]
  records list [--date today|YYYY-MM-DD] [--timezone Asia/Shanghai] [--limit N] [--cursor <c>]
  records get <session-id>
  records create --input-file <record.json> --operation-id <stable-id>
  records update <session-id> --input-file <patch.json> --if-version <n> --operation-id <stable-id>
  tomatodo preview --session <session-id>
  tomatodo sync --plan <plan-id> --session <session-id> --operation-id <stable-id>
  operations get <operation-id>
  schema --json
  doctor --json
  连接配置从发现文件自动解析；可用 FOCUSLINK_LOCAL_PORT / FOCUSLINK_LOCAL_TOKEN_FILE /
  FOCUSLINK_AUTOMATION_DISCOVERY_FILE 覆盖。密钥不写在命令行参数里。

云端任务命令（需要 FOCUSLINK_ENDPOINT、FOCUSLINK_DEVICE_TOKEN）：
  time [--timezone Asia/Shanghai]
  projects list
  projects get --project-id <id>
  projects create --name <name> [--color <color>]
  projects update --project-id <id> [--name <name>] [--color <color>|--clear-color]
  projects delete --project-id <id>
  tasks list [--project-id <id|inbox>] [--include-completed] [--query <text>]
             [--priority 0..5] [--start-from <ISO|ms>] [--start-to <ISO|ms>]
             [--due-from <ISO|ms>] [--due-to <ISO|ms>] [--tag <name>] [--limit N]
  tasks get --task-id <id>
  tasks create --title <title> [任务字段]
  tasks update --task-id <id> [任务字段|清空字段]
  tasks move --task-id <id> --project-id <id|inbox>
  tasks complete|restore|delete --task-id <id>
  deviceId 从 fl2 凭据绑定段验证派生；ChatGPT Web 使用 OAuth MCP，OAuth access token 不用于本机 CLI。

任务字段：--task-id <id> --title <title> --project-id <id|inbox> --parent-id <id|none>
          --priority 0..5 --start <ISO|ms> --due <ISO|ms> --tag <name>
清空字段：--clear-priority --clear-start --clear-due --clear-tags --clear-recurrence
循环字段：--frequency daily|weekly|monthly|yearly --interval N --timezone <IANA>
          --weekdays 1,3,5 --month-days 1,15 --repeat-end <ISO|ms> --repeat-count N
          --rollover from_schedule|from_completion
写入控制：--operation-id <stable-id> --expected-revision <revision>
临时网络失败会用同一 operationId 重试一次；最终失败 JSON 会返回可复用的 operationId/revision。

退出码：0 已生效/重放命中，2 参数错误，3 鉴权或权限不足，4 版本或状态冲突，
        5 找不到目标，6 本机接口不可用或可重试失败，7 需要重新取快照。`;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  void runFocusLinkCli(process.argv.slice(2), process.env, {
    stdout: (value) => process.stdout.write(`${value}\n`),
    stderr: (value) => process.stderr.write(`${value}\n`),
  }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

export const focusLinkCliModulePath = fileURLToPath(import.meta.url);
