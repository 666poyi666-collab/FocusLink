import type { TaskWorkspaceRefreshData } from '@shared/ipc/api';
import type { Task } from '@shared/types';
import { assembleTaskTree } from '@shared/taskTreeUtils';
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

/**
 * 同一份任务数组只组装一次树，且组装结果按引用复用。
 *
 * 为什么必须按引用记录：挂载初始化、refresh 回写、store 订阅三处都会组装同一份
 * store 任务数组，而 assembleTaskTree 每次都会克隆整棵树（shared/taskTreeUtils.ts:96-106），
 * 于是三次组装得到三个内容相同、引用不同的数组，setTasks 每次都判定「变了」，
 * 首访因此多出两次整页渲染。store 的任务数组是不可变替换，引用相同即内容相同，
 * 所以按引用记忆是安全的；本地变更走 map/filter 生成新数组，不会污染这份缓存。
 */
let assembledInput: readonly Task[] | null = null;
let assembledOutput: Task[] | null = null;

export function assembleWorkspaceTree(tasks: readonly Task[]): Task[] {
  if (assembledInput === tasks && assembledOutput) return assembledOutput;
  assembledOutput = assembleTaskTree(tasks);
  assembledInput = tasks;
  return assembledOutput;
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
