import type { LiveFocusSnapshotLike } from './runtimeModel';
import { offlineRuntimeSnapshot, type OfflineFocusRuntime } from './offlineFocusRuntime';

/** A cloud credential/cache reset must never hide a durable local session. */
export function resolveMobileDisplaySnapshot(
  local: OfflineFocusRuntime | null,
  remote: LiveFocusSnapshotLike | null,
  deviceId: string,
  observedAt = Date.now(),
): LiveFocusSnapshotLike | null {
  return local ? offlineRuntimeSnapshot(local, deviceId, observedAt) : remote;
}
