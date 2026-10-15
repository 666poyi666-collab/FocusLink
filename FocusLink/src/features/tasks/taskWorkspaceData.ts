import type { TaskWorkspaceRefreshData } from '@shared/ipc/api';
import { useStore } from '../../app/store';
import { ipcErrorMessage } from '../../app/ipcError';

let localRead: Promise<TaskWorkspaceRefreshData> | null = null;
let remoteRead: Promise<TaskWorkspaceRefreshData> | null = null;
let lastRefreshAt = 0;
let lastRefreshAttemptAt = 0;
let readGeneration = 0;
const REFRESH_INTERVAL_MS = 30_000;

function cachedWorkspace(): TaskWorkspaceRefreshData {
  const state = useStore.getState();
  return {
    provider: 'focuslink-local',
    tasks: state.ticktickTasks,
    projects: state.ticktickProjects,
    refreshedAt: lastRefreshAt,
  };
}

/** An acknowledged local mutation supersedes any older background read. */
export function acceptTaskWorkspace(data: TaskWorkspaceRefreshData): void {
  readGeneration += 1;
  useStore.getState().setTaskWorkspace(data);
}

/** Empty is a valid loaded workspace. Opening a picker never waits for the network. */
export function readTaskWorkspace(reload = false): Promise<TaskWorkspaceRefreshData> {
  if (!reload && useStore.getState().taskWorkspaceLoaded) return Promise.resolve(cachedWorkspace());
  if (localRead) return localRead;
  const generation = ++readGeneration;
  localRead = (async () => {
    const result = await window.focuslink.tasks.refresh({ localOnly: true });
    if (!result.ok) throw new Error(result.error);
    if (generation === readGeneration) useStore.getState().setTaskWorkspace(result.data);
    return generation === readGeneration ? result.data : cachedWorkspace();
  })().finally(() => {
    localRead = null;
  });
  return localRead;
}

/** One background refresh shared by the picker and task page, with a short freshness window. */
export function refreshTaskWorkspace(force = false): Promise<TaskWorkspaceRefreshData> {
  if (remoteRead) return remoteRead;
  if (!force && lastRefreshAttemptAt && Date.now() - lastRefreshAttemptAt < REFRESH_INTERVAL_MS) {
    return Promise.resolve(cachedWorkspace());
  }
  const generation = readGeneration;
  lastRefreshAttemptAt = Date.now();
  useStore.setState({ taskWorkspaceRefreshing: true, taskWorkspaceRefreshError: null });
  remoteRead = (async () => {
    const result = await window.focuslink.tasks.refresh({
      includeCompleted: true,
      completedDays: 90,
      force,
    });
    if (!result.ok) throw new Error(result.error);
    if (generation === readGeneration) {
      useStore.getState().setTaskWorkspace(result.data);
      lastRefreshAt = Date.now();
    }
    return generation === readGeneration ? result.data : cachedWorkspace();
  })()
    .catch((error) => {
      useStore.setState({ taskWorkspaceRefreshError: ipcErrorMessage(error) });
      throw error;
    })
    .finally(() => {
      remoteRead = null;
      useStore.setState({ taskWorkspaceRefreshing: false });
    });
  return remoteRead;
}
