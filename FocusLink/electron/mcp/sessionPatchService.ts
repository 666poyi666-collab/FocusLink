// `/v1` 会话写接口的路由级语义（可注入依赖，便于在没有 Electron/SQLite 的环境里验收）。
//
// 2026-11-03 FL-SYNC-038：复用底层 records.update 不自动保证 HTTP 层的前置条件与重放语义。
// 这里固定两条顺序约束：
//   1. 先用稳定请求身份（operationId + 正文摘要）查已确认回执；重放直接返回原确认，不碰 CAS。
//   2. 只有新请求才做 If-Match / expectedRecordVersion / expectedUpdatedAt 的当前状态校验。
import type {
  AutomationCommand,
  AutomationCommandResult,
  AutomationScope,
} from '@shared/automation/contract';
import type { FocusSession } from '@shared/types';
import {
  buildSessionPatch,
  parseIfMatchHeader,
  SessionWriteError,
  type CachedTask,
} from './sessionWritePayload.js';

export interface SessionPatchDeps {
  executeCommand(
    command: AutomationCommand,
    scopes: readonly AutomationScope[],
    operationId: string,
  ): Promise<AutomationCommandResult>;
  readRecord(sessionId: string): { recordVersion: number };
  getSession(sessionId: string): FocusSession | null;
  findTask(taskId: string): CachedTask | null;
  readIdempotent(key: string): { request_hash: string; response_json: string } | undefined;
  writeIdempotent(key: string, operation: string, requestHash: string, responseJson: string): void;
  hashRequest(value: unknown): string;
  summarize(sessionId: string, recordVersion: number): Record<string, unknown>;
}

function settle(result: AutomationCommandResult): void {
  if (result.status === 'applied' || result.status === 'duplicate') return;
  throw new SessionWriteError(
    result.status === 'conflict' ? 409 : 422,
    result.error?.code ?? 'COMMAND_FAILED',
    result.error?.message ?? 'Command failed',
  );
}

/**
 * 对一次会话执行字段补丁。
 *
 * 幂等键与请求摘要都在本层计算：底层 `records.update` 的命令摘要包含实际发送的
 * `expectedRecordVersion`，如果每次都填「当前版本」，同一个成功请求的重放就会被判成
 * `OPERATION_ID_REUSED`（FL-SYNC-038 的实测现象），因此重放判定必须发生在任何版本校验之前。
 */
export async function applySessionPatchWithDeps(
  deps: SessionPatchDeps,
  sessionId: string,
  payload: Record<string, unknown>,
  scopes: readonly AutomationScope[],
  operationId: string,
  ifMatchHeader: string | string[] | undefined,
): Promise<Record<string, unknown>> {
  const idempotencyKey = `v1:session-patch:${operationId}`;
  const requestHash = deps.hashRequest({ sessionId, payload });
  const replayed = deps.readIdempotent(idempotencyKey);
  if (replayed) {
    if (replayed.request_hash !== requestHash) {
      throw new SessionWriteError(
        422,
        'OPERATION_ID_REUSED',
        'operationId was reused with a different payload',
      );
    }
    return {
      ...(JSON.parse(replayed.response_json) as Record<string, unknown>),
      duplicate: true,
    };
  }

  const session = deps.getSession(sessionId);
  if (!session) throw new SessionWriteError(404, 'NOT_FOUND', 'Session was not found');
  const currentVersion = deps.readRecord(sessionId).recordVersion;

  const ifMatchVersion = parseIfMatchHeader(ifMatchHeader);
  const bodyVersionRaw = payload['expectedRecordVersion'];
  let bodyVersion: number | null = null;
  if (bodyVersionRaw !== undefined && bodyVersionRaw !== null) {
    const parsed = Number(bodyVersionRaw);
    if (!Number.isInteger(parsed)) {
      throw new SessionWriteError(
        400,
        'INVALID_ARGUMENT',
        'expectedRecordVersion must be an integer',
      );
    }
    bodyVersion = parsed;
  }
  if (ifMatchVersion !== null && bodyVersion !== null && ifMatchVersion !== bodyVersion) {
    throw new SessionWriteError(
      400,
      'INVALID_ARGUMENT',
      'If-Match and expectedRecordVersion disagree',
    );
  }
  const expectedVersion = ifMatchVersion ?? bodyVersion;
  if (expectedVersion !== null && expectedVersion !== currentVersion) {
    throw new SessionWriteError(409, 'VERSION_CONFLICT', 'Record version changed');
  }
  const expectedUpdatedAtRaw = payload['expectedUpdatedAt'];
  if (expectedUpdatedAtRaw !== undefined && expectedUpdatedAtRaw !== null) {
    const expectedUpdatedAt = Number(expectedUpdatedAtRaw);
    if (!Number.isFinite(expectedUpdatedAt) || expectedUpdatedAt !== session.updatedAt) {
      throw new SessionWriteError(
        409,
        'STALE_UPDATED_AT',
        'Session changed since expectedUpdatedAt',
      );
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
      findTask: deps.findTask,
    });
  } catch (error) {
    if (error instanceof SessionWriteError) throw error;
    throw error;
  }

  const result = await deps.executeCommand(
    {
      type: 'records.update',
      expiresAt: Date.now() + 60_000,
      sessionId,
      expectedRecordVersion: expectedVersion ?? currentVersion,
      patch,
    },
    scopes,
    operationId,
  );
  settle(result);
  const summary = deps.summarize(sessionId, deps.readRecord(sessionId).recordVersion);
  deps.writeIdempotent(idempotencyKey, 'v1.session-patch', requestHash, JSON.stringify(summary));
  return summary;
}
