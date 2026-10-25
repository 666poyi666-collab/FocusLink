export type SyncV2ClientErrorCode =
  | 'aborted'
  | 'authentication_failed'
  | 'authorization_failed'
  | 'contract_error'
  | 'cursor_ahead'
  | 'invalid_exchange_request'
  | 'network_error'
  | 'rate_limited'
  | 'response_too_large'
  | 'server_error'
  | 'sync_failed'
  | 'timeout';

export class SyncV2ClientError extends Error {
  readonly code: SyncV2ClientErrorCode;
  /** Allowlisted field paths only; never response bodies, values, or headers. */
  readonly fields: readonly string[];
  /**
   * Server-provided wait hint in milliseconds (HTTP `Retry-After`), already
   * clamped by the caller. `null` when the server did not send a usable value.
   * It is a scheduling hint only and must never be stored as a durable code.
   */
  readonly retryAfterMs: number | null;

  constructor(
    code: SyncV2ClientErrorCode,
    message?: string,
    fields: readonly string[] = [],
    retryAfterMs: number | null = null,
  ) {
    const safeFields = [
      ...new Set(fields.filter((field) => /^[a-zA-Z0-9_.[\]-]{1,80}$/.test(field))),
    ].slice(0, 32);
    super(
      message ??
        `canonical Sync v2 failed (${code})${safeFields.length > 0 ? ` fields=${safeFields.join(',')}` : ''}`,
    );
    this.name = 'SyncV2ClientError';
    this.code = code;
    this.fields = safeFields;
    this.retryAfterMs =
      retryAfterMs !== null && Number.isSafeInteger(retryAfterMs) && retryAfterMs > 0
        ? retryAfterMs
        : null;
  }
}

/**
 * Reduces arbitrary transport/runtime failures to a fixed, non-secret code.
 * Upstream bodies, request headers and exception messages must never become
 * durable status or log fields.
 *
 * Retryability is expressed by the code, not by the message text:
 * - retryable transport/backpressure: `network_error`, `timeout`, `rate_limited`, `server_error`
 * - terminal for this account/device: `authentication_failed`, `authorization_failed`,
 *   `contract_error`, `invalid_exchange_request`, `cursor_ahead`, `response_too_large`
 */
export function classifySyncV2Error(error: unknown): SyncV2ClientErrorCode {
  if (error instanceof SyncV2ClientError) return error.code;
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted';
  if (error instanceof TypeError) return 'network_error';

  const message = error instanceof Error ? error.message : '';
  if (/\b401\b|authentication[_ -]?failed/i.test(message)) return 'authentication_failed';
  if (
    /\b403\b|authorization[_ -]?failed|scope (?:missing|insufficient|denied)|(?:missing|insufficient|denied) scope/i.test(
      message,
    )
  ) {
    return 'authorization_failed';
  }
  if (/\b429\b|rate[_ -]?limit|too many requests/i.test(message)) return 'rate_limited';
  if (
    /\b5\d\d\b|server[_ -]?error|bad gateway|service unavailable|gateway timeout/i.test(message)
  ) {
    return 'server_error';
  }
  if (/超时|timeout/i.test(message)) return 'timeout';
  if (/无法连接|连接被拒绝|fetch failed|network error/i.test(message)) return 'network_error';
  if (/超过允许的字节上限|too large/i.test(message)) return 'response_too_large';
  if (/cursor.*ahead|ahead.*cursor/i.test(message)) return 'cursor_ahead';
  if (/响应|response|cursor|epoch|ACK|change feed|格式|JSON|UTF-8|revision/i.test(message)) {
    return 'contract_error';
  }
  return 'sync_failed';
}

export function safeSyncV2Error(error: unknown): SyncV2ClientError {
  if (error instanceof SyncV2ClientError) return error;
  const code = classifySyncV2Error(error);
  return new SyncV2ClientError(code);
}
