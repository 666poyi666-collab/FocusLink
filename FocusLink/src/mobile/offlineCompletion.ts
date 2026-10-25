import type { DeviceSyncSessionBundle } from '@shared/sync/deviceProtocol';
import {
  completeOfflineFocusRuntime,
  readOfflineCompletionFreeze,
  writeOfflineCompletionFreeze,
  type PendingDeviceSyncBundle,
} from './cache';
import {
  classifyNativeCompletion,
  resolveFrozenCompletion,
  type FrozenOfflineCompletion,
  type NativeCompletionOutcome,
} from './offlineCompletionIdentity';
import {
  enqueueNativeCompletedLedgerBundle,
  isNativeFocusRuntimeAvailable,
} from './nativeFocusRuntime';

export { offlineCompletionNotice } from './offlineCompletionIdentity';

export interface OfflineCompletionResult {
  /** Payload identity every retry must reuse, including the first `endedAt`. */
  freeze: FrozenOfflineCompletion;
  /** True when this call found a previous completion for the same session id. */
  reusedFreeze: boolean;
  native: NativeCompletionOutcome;
  nativeDetail: string | null;
  /** Null means nothing was committed locally; the caller must keep the draft. */
  pending: PendingDeviceSyncBundle | null;
  error: string | null;
}

/**
 * Production completion boundary used by MobileApp.
 *
 * The completion identity is frozen first so a retry cannot invent a second
 * `endedAt`: the native WorkManager outbox and the canonical IndexedDB outbox
 * must both describe the same operation. The native mirror is attempted next so
 * Android can deliver while the renderer is dead; IndexedDB stays the canonical
 * foreground outbox and is committed before the active draft can be discarded.
 */
export async function persistCompletedOfflineFocus(
  bundle: DeviceSyncSessionBundle,
  deviceId: string,
  nativeConnectionLease: string | null,
): Promise<OfflineCompletionResult> {
  const existing = await readOfflineCompletionFreeze(bundle.session.id);
  const { freeze, reused } = resolveFrozenCompletion({
    existing,
    bundle,
    frozenAt: Date.now(),
  });
  if (!reused) await writeOfflineCompletionFreeze(freeze);

  const available = isNativeFocusRuntimeAvailable();
  let queued = false;
  let nativeError: unknown;
  try {
    queued = await enqueueNativeCompletedLedgerBundle(
      freeze.bundle,
      deviceId,
      nativeConnectionLease,
    );
  } catch (error) {
    nativeError = error;
  }
  const native = classifyNativeCompletion({ available, queued, error: nativeError });

  try {
    const pending = await completeOfflineFocusRuntime(freeze.bundle);
    return {
      freeze,
      reusedFreeze: reused,
      native,
      nativeDetail: nativeError === undefined ? null : describeError(nativeError),
      pending,
      error: null,
    };
  } catch (error) {
    return {
      freeze,
      reusedFreeze: reused,
      native,
      nativeDetail: nativeError === undefined ? null : describeError(nativeError),
      pending: null,
      error: describeError(error),
    };
  }
}

function describeError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return '未知错误';
}
