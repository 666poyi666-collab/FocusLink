import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { App as CapacitorApp, type URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { APP_VERSION } from '@shared/version';

import { AppNavigation, type MobileView } from './AppNavigation';
import { isMobileForegroundActive } from './backgroundPolicy';
import { resolveMobileDisplaySnapshot } from './localFocusPresentation';
import {
  newLocalTaskCreate,
  prepareLocalTaskCreate,
  retryLocalTaskCreate,
  overlayLocalTaskCreates,
  localTaskFromCreate,
  localTaskCreateIssue,
  type LocalTaskCreate,
} from './localTaskQueue';
import {
  localTaskCompletionIssue,
  overlayLocalTaskCompletions,
  planTaskCompletionIntent,
  retryLocalTaskCompletion,
  sortLocalTaskCompletions,
  type LocalTaskCompletion,
} from './localTaskCompletions';
import { normalizeDeviceSyncEndpoint } from '@shared/sync/deviceProtocol';
import { parseDeviceToken } from '@shared/sync/v2Protocol';
import {
  SyncV2ClientError,
  classifySyncV2Error,
  type SyncV2ClientErrorCode,
} from '@shared/sync/v2ClientError';
import type { LiveFocusCommand, LiveFocusSnapshotResponse } from '@shared/sync/liveFocusProtocol';
import {
  reconcileTaskSnapshot,
  type SyncedTask,
  type SyncedTaskProject,
  type TaskSnapshotResponse,
} from '@shared/sync/taskSnapshotProtocol';
import {
  defaultTaskProjectColor,
  FOCUSLINK_INBOX_PROJECT_ID,
  isFocusLinkInboxProject,
} from '@shared/taskProjectPolicy';
import {
  clearCachedLiveFocusSnapshot,
  clearCachedTaskSnapshot,
  clearMobileCache,
  createOfflineFocusRuntime,
  readCachedLiveFocusSnapshot,
  readCachedTaskSnapshot,
  readCachedTaskSnapshotConfirmedAt,
  readLegacyCachedTaskSnapshot,
  writeLegacyCachedTaskSnapshot,
  readMobileCache,
  readOfflineFocusRuntime,
  readLocalSessionSyncMeta,
  readPendingDeviceSyncBundles,
  writeLocalSessionSyncMeta,
  writeOfflineFocusRuntime,
  writeCachedLiveFocusSnapshot,
  writeCachedTaskSnapshot,
  readLocalTaskCreates,
  writeLocalTaskCreate,
  retryLocalTaskCreates,
  readLocalTaskEdits,
  writeLocalTaskEdit,
  readLocalTaskCompletions,
  writeLocalTaskCompletion,
  type MobileCacheSnapshot,
  type LocalSessionSyncMeta,
  type MobileAuthorityMode,
} from './cache';
import {
  finishOfflineFocus,
  offlineRuntimeSnapshot,
  pauseOfflineFocus,
  resumeOfflineFocus,
  startOfflineFocus,
  type OfflineFocusRuntime,
} from './offlineFocusRuntime';
import { ConnectionSheet } from './ConnectionSheet';
import { DashboardView } from './DashboardView';
import {
  FocusConsole,
  type MobileFocusCommand,
  type NativeFocusConsoleControls,
} from './FocusConsole';
import {
  completeNativeFocusCommands,
  configureNativeFocusConnection,
  clearNativeFocusConnection,
  drainNativeFocusCommands,
  enterNativePictureInPicture,
  isNativeFocusRuntimeAvailable,
  readNativeFocusConnectionState,
  readNativeFocusStatus,
  restoreNativeFocusConnectionState,
  restoreOrMigrateNativeFocusConnection,
  setNativeImmersiveSystemBars,
  subscribeToNativeFocusCommands,
  updateNativeAuthorityProjectionHistory,
  updateNativeFocusSnapshot,
  waitForNativeFocusRuntimeStartup,
  type NativeFocusConnectionState,
  type NativeFocusCommand,
} from './nativeFocusRuntime';
import {
  clearMobileAccountProfile,
  clearSavedToken,
  getOrCreateDeviceId,
  getOrCreateInstallationId,
  loadMobileAccountProfile,
  loadConnectionPreferences,
  persistMobileAccountSessionBestEffort,
  type MobileConnectionPreferences,
} from './preferences';
import {
  formatClockDuration,
  idleLiveFocusSnapshot as makeIdleSnapshot,
  projectLiveFocusDurations,
  type LiveConnectionState,
  type LiveFocusSnapshotLike,
} from './runtimeModel';
import { SettingsView } from './SettingsView';
import {
  applyMobileAppearance,
  loadMobileAppearance,
  saveMobileAppearance,
  watchMobileSystemTheme,
  type MobileAppearance,
} from './appearance';
import {
  claimDeviceSyncPairingRequest,
  MobileLiveRequestError,
  classifyMobileLiveRequestError,
  createDeviceSyncPairingRequest,
  exchangeDeviceSyncPairingCode,
  listDeviceSyncDevices,
  mutateTaskSnapshot,
  revokeDeviceSyncDevice,
  fetchLiveFocusSnapshot,
  fetchTaskSnapshotConditional,
  publishTaskSnapshot,
  sendLiveFocusCommand,
  waitForLiveFocusSnapshot,
} from './syncClient';
import { normalizePairingCodeInput } from './pairingInput';
import { resolveMobileLiveLifecycleAction } from './liveConnectionLifecycle';
import {
  isOwnerAccountCallback,
  invalidateOwnerAccountBootstrap,
  OFFICIAL_FOCUSLINK_ENDPOINT,
  openOwnerLogin,
  ownerAccountBootstrapApi,
  type OwnerAccountSession,
} from './accountBootstrap';
import {
  createMobileAccountLifecycle,
  createMobileAccountRequestCoalescer,
  createMobileAccountRequestGroup,
  createMobileAccountRequestLifecycle,
  createMobileStartupRestoreCoordinator,
  isMobileAccountRequestCommitCurrent,
  mobileAccountConnectionKey,
  runMobileAccountCommit,
  runMobileAccountLogout,
} from './accountLifecycle';
import { TickTickTaskPage } from './TickTickTaskPage';
import { MobileConfirmDialog } from './MobileConfirmDialog';
import {
  commandAckNotice,
  nativeCommandAckNotice,
  restoreCachedLiveSnapshot,
  shouldApplyLiveSnapshot,
  type LiveSnapshotSource,
} from './liveSnapshotPolicy';
import { remoteForkEvidence } from './authorityPolicy';
import {
  countOutstandingLedgerEntities,
  mobileLedgerProjectionVerifiedAt,
  presentMobileLedgerSync,
} from './ledgerSyncPresentation';
import { runMobileSyncV2 } from './v2Sync';
import {
  enqueueMobileV2Mutation,
  readMobileV2Bootstrap,
  readMobileV2Conflicts,
  readMobileV2OperationHistory,
  readMobileV2RetryState,
  readMobileV2Status,
  supersedeMobileV2PendingMutations,
} from './v2Cache';
import {
  buildMobileV2ConflictResolution,
  describeMobileV2ConflictResolution,
  normalizeMobileV2ConflictResolutionOutcome,
  presentMobileV2Conflicts,
  type MobileV2ConflictRecord,
  type MobileV2ConflictSide,
} from './v2ConflictResolution';
import { decideMobileV2Retry, describeMobileV2RetryWait } from './v2RetryPolicy';
import {
  decideMobileLedgerPull,
  shouldDrainNativeCommands,
  type MobileLedgerPullReason,
  type MobileLedgerPullTrace,
} from './ledgerPullPolicy';
import { offlineCompletionNotice, persistCompletedOfflineFocus } from './offlineCompletion';
import type { DeviceSyncManagedDevice } from '@shared/ipc/api';
import {
  createTaskSnapshotRequestLifecycle,
  startVisibleTaskSnapshotRefresh,
} from './taskSnapshotRefresh';
import {
  advanceMobileTaskSnapshotStreak,
  nextMobileTaskSnapshotDelayMs,
} from './taskSnapshotCadence';
import { presentMobileSyncActivity } from './syncFeedback';
import { isTabletFocusViewport } from './viewportPolicy';
import {
  localTaskEditIssue,
  mergeLocalTaskEdit,
  newLocalTaskEdit,
  overlayLocalTaskEdits,
  retryLocalTaskEdit,
  type LocalTaskEdit,
  type LocalTaskEditPatch,
} from './localTaskEdits';
import {
  createEmptyTaskSnapshot,
  deleteTaskSnapshotProject,
  deleteTaskSnapshotTask,
  moveTaskSnapshotSubtree,
  updateTaskSnapshotProject,
  updateTaskSnapshotTask,
} from './taskSnapshotMutations';

type PullState = 'idle' | 'pulling' | 'confirmed' | 'partial' | 'error';

const EMPTY_CACHE: MobileCacheSnapshot = {
  bundles: [],
  cursor: null,
  lastSyncAt: null,
  serverTime: null,
};

function currentMobilePairingDevice() {
  const native = Capacitor.isNativePlatform();
  const tablet = isTabletFocusViewport(window.innerWidth, window.innerHeight);
  return {
    installationId: getOrCreateInstallationId(),
    displayName: native
      ? tablet
        ? 'FocusLink Android 平板'
        : 'FocusLink Android 手机'
      : 'FocusLink Web',
    platform: native ? ('android' as const) : ('web' as const),
    deviceKind: tablet ? ('tablet' as const) : ('phone' as const),
    appVersion: APP_VERSION,
  };
}

export function MobileApp() {
  const initialPreferences = useRef(loadConnectionPreferences()).current;
  const [preferences, setPreferences] = useState(initialPreferences);
  const [accountProfile, setAccountProfile] = useState(() => loadMobileAccountProfile());
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountLoginPolling, setAccountLoginPolling] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingOffer, setPairingOffer] = useState<{
    code: string;
    expiresAt: number;
    requestToken?: string;
  } | null>(null);
  const [managedDevices, setManagedDevices] = useState<DeviceSyncManagedDevice[]>([]);
  const pairingAutoGeneratedRef = useRef(false);
  const [cache, setCache] = useState<MobileCacheSnapshot>(EMPTY_CACHE);
  const [cacheReady, setCacheReady] = useState(false);
  // Account sync is optional. A new installation starts in the local focus
  // console and keeps login available as an explicit action.
  const [configOpen, setConfigOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  // Foreground state comes from two sources that disagree on some OEM builds (the WebView
  // can report a visible document while the app sits behind the lock screen). One policy
  // decides; every periodic reader below follows it instead of re-deriving its own rule.
  const [appActive, setAppActive] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  const foregroundActive = isMobileForegroundActive({ appActive, documentVisible });
  const [pullState, setPullState] = useState<PullState>('idle');
  const [ledgerNotice, setLedgerNotice] = useState('正在读取本机会话账本…');
  const [liveSnapshot, setLiveSnapshot] = useState<LiveFocusSnapshotLike | null>(null);
  const [liveConnection, setLiveConnection] = useState<LiveConnectionState>(
    initialPreferences.endpoint && initialPreferences.token ? 'connecting' : 'unconfigured',
  );
  const [titleDraft, setTitleDraft] = useState('');
  const [taskSnapshot, setTaskSnapshot] = useState<TaskSnapshotResponse | null>(null);
  const [localTaskRecords, setLocalTaskCreates] = useState<LocalTaskCreate[]>([]);
  const [localTaskQueueEpoch, setLocalTaskQueueEpoch] = useState(0);
  const [localTaskEditRecords, setLocalTaskEdits] = useState<LocalTaskEdit[]>([]);
  const [localTaskEditEpoch, setLocalTaskEditEpoch] = useState(0);
  const [localTaskCompletionRecords, setLocalTaskCompletions] = useState<LocalTaskCompletion[]>([]);
  const [localTaskCompletionEpoch, setLocalTaskCompletionEpoch] = useState(0);
  const [syncedCompletionIds, setSyncedCompletionIds] = useState<Record<string, number>>({});
  const completionSyncedTimers = useRef(new Map<string, number>());
  const localTaskScope = mobileAccountId(preferences) ?? 'unpaired';
  const localTaskCreates = useMemo(
    () => localTaskRecords.filter((r) => r.scope === localTaskScope || r.scope === 'unpaired'),
    [localTaskRecords, localTaskScope],
  );
  const localTaskEdits = useMemo(
    () => localTaskEditRecords.filter((r) => r.scope === localTaskScope || r.scope === 'unpaired'),
    [localTaskEditRecords, localTaskScope],
  );
  const localTaskCompletions = useMemo(
    () =>
      localTaskCompletionRecords.filter(
        (r) => r.scope === localTaskScope || r.scope === 'unpaired',
      ),
    [localTaskCompletionRecords, localTaskScope],
  );
  const visibleTaskSnapshot = useMemo(
    () =>
      overlayLocalTaskCompletions(
        overlayLocalTaskEdits(
          overlayLocalTaskCreates(taskSnapshot, localTaskCreates),
          localTaskEdits,
        ),
        localTaskCompletions,
      ),
    [taskSnapshot, localTaskCompletions, localTaskCreates, localTaskEdits],
  );
  // 行内状态只由本机意图队列给出：待同步、已同步、同步失败，页面不自行猜测。
  const taskCompletionStates = useMemo(() => {
    const states: Record<string, 'pending' | 'synced' | 'failed'> = {};
    for (const [taskId, at] of Object.entries(syncedCompletionIds)) {
      if (at > 0) states[taskId] = 'synced';
    }
    for (const record of localTaskCompletions) {
      states[record.taskId] = record.blocked ? 'failed' : 'pending';
    }
    return states;
  }, [localTaskCompletions, syncedCompletionIds]);
  // When this device last had a task snapshot confirmed by the cloud. Task
  // sync is its own settings domain; it must not borrow the ledger timestamp.
  const [taskConfirmedAt, setTaskConfirmedAt] = useState<number | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [pendingCommand, setPendingCommand] = useState<MobileFocusCommand | null>(null);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [liveConnectionNotice, setLiveConnectionNotice] = useState<string | null>(null);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [nativeReadinessEpoch, setNativeReadinessEpoch] = useState(0);
  const [activeView, setActiveView] = useState<MobileView>('focus');
  // 页面切换动效的 reduced-motion 降级：开启时入场/退出均为瞬时，信息不损失。
  const reduceMotion = useReducedMotion();
  const [liveSnapshotSource, setLiveSnapshotSource] = useState<LiveSnapshotSource>('none');
  const [offlineRuntime, setOfflineRuntime] = useState<OfflineFocusRuntime | null>(null);
  const [authorityMode, setAuthorityMode] = useState<MobileAuthorityMode>('cloud-live');
  const [pendingUploadCount, setPendingUploadCount] = useState(0);
  // Rejected v2 operations are a different failure mode from queued uploads and
  // conflicts; the settings row shows all three counts separately.
  const [ledgerRejectedCount, setLedgerRejectedCount] = useState(0);
  // Sync v2 conflicts used to stop at "recorded": the device showed a count and
  // told the user to fix it on the desktop. Keep the decision on this device.
  const [syncConflicts, setSyncConflicts] = useState<MobileV2ConflictRecord[]>([]);
  const [conflictBusyId, setConflictBusyId] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  // One scheduled follow-up pull for a retryable ledger failure. Durable retry
  // timestamps live on the outbox rows; this is only the UI-side driver so a
  // throttled cloud is retried on the backoff schedule instead of on user taps.
  const [ledgerRetryAt, setLedgerRetryAt] = useState<number | null>(null);
  // Consecutive retryable ledger failures. It only feeds the backoff exponent, so
  // a pull-only failure (no outbox row to carry attemptCount) also widens
  // instead of polling the cloud forever at the base delay.
  const ledgerRetryAttempts = useRef(0);
  const [appearance, setAppearance] = useState<MobileAppearance>(() => loadMobileAppearance());
  const [clearCacheDialogOpen, setClearCacheDialogOpen] = useState(false);
  const [nativeSystemControls, setNativeSystemControls] = useState<NativeFocusConsoleControls>(
    () => ({
      available: isNativeFocusRuntimeAvailable(),
      immersiveSystemBars: false,
      pictureInPictureSupported: false,
      pictureInPictureActive: false,
      busy: null,
    }),
  );

  // A task can be removed or moved by another device while this renderer is open. Do not let
  // the old selection/title survive that snapshot transition and create an unlinked session with
  // a stale task name.
  useEffect(() => {
    if (!selectedTaskId) return;
    const stillPresent =
      visibleTaskSnapshot.snapshot?.tasks.some((task) => task.id === selectedTaskId) ?? false;
    if (stillPresent) return;
    setSelectedTaskId('');
    setTitleDraft('');
  }, [selectedTaskId, visibleTaskSnapshot]);

  const [deviceId, setDeviceId] = useState(() => getOrCreateDeviceId());
  const startupDeviceId = useRef(deviceId).current;
  const [nativeConnectionLease, setNativeConnectionLease] = useState<string | null>(null);
  const preferencesRef = useRef(preferences);
  const cacheRef = useRef(cache);
  const liveSnapshotRef = useRef(liveSnapshot);
  const taskSnapshotRef = useRef<TaskSnapshotResponse | null>(null);
  const offlineRuntimeRef = useRef<OfflineFocusRuntime | null>(null);
  const authorityModeRef = useRef<MobileAuthorityMode>('cloud-live');
  const liveConnectionRef = useRef(liveConnection);
  const pendingCommandRef = useRef<MobileFocusCommand | null>(null);
  const ledgerRequest = useRef<AbortController | null>(null);
  const ledgerGeneration = useRef(0);
  const liveRequest = useRef<AbortController | null>(null);
  const liveGeneration = useRef(0);
  const taskRequests = useRef(createTaskSnapshotRequestLifecycle()).current;
  const taskRefreshes = useRef(
    createMobileAccountRequestCoalescer<TaskSnapshotResponse | null>(),
  ).current;
  const ledgerPulls = useRef(createMobileAccountRequestCoalescer<void>()).current;
  const ledgerPullTrace = useRef<MobileLedgerPullTrace | null>(null);
  const pendingLedgerPull = useRef<MobileLedgerPullReason | null>(null);
  const commandRequests = useRef(createMobileAccountRequestLifecycle()).current;
  const taskWrites = useRef(createMobileAccountRequestGroup()).current;
  // The register ETag belongs to one account connection: a pairing/account switch must not echo
  // the previous cloud's tag, otherwise the next poll could be answered with a stale marker.
  const taskSnapshotEtag = useRef<{ connectionKey: string; etag: string } | null>(null);
  // How many consecutive conditional reads answered "unchanged". The foreground poll widens with
  // this counter, so an idle phone stops asking the cloud every 5 s for a list nobody touched.
  const taskSnapshotCadence = useRef({ unchangedStreak: 0 });
  const cacheMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const nativeQueueRunning = useRef(false);
  const nativeCommandAbort = useRef<AbortController | null>(null);
  const nativeConnectionLeaseRef = useRef<string | null>(null);
  const lastResumeRefreshAt = useRef(0);
  const mobileAppActive = useRef(true);
  const connectionKeyRef = useRef(mobileAccountConnectionKey(initialPreferences));
  const [accountLifecycle] = useState(createMobileAccountLifecycle);
  const [startupRestore] = useState(() => createMobileStartupRestoreCoordinator(accountLifecycle));
  const accountTransitionOperation = useRef<number | null>(null);

  const beginAccountTransition = useCallback(
    (operation: number) => {
      accountTransitionOperation.current = operation;
      taskRefreshes.invalidate();
      taskRequests.invalidate();
      ledgerPulls.invalidate();
      ledgerGeneration.current += 1;
      ledgerRequest.current?.abort();
      ledgerRequest.current = null;
      liveGeneration.current += 1;
      liveRequest.current?.abort();
      liveRequest.current = null;
      commandRequests.invalidate();
      taskWrites.invalidate();
      nativeCommandAbort.current?.abort();
      nativeCommandAbort.current = null;
      ledgerPullTrace.current = null;
      pendingLedgerPull.current = null;
      ledgerRetryAttempts.current = 0;
      setLedgerRetryAt(null);
    },
    [commandRequests, ledgerPulls, taskRefreshes, taskRequests, taskWrites],
  );

  const finishAccountTransition = useCallback((operation: number) => {
    if (accountTransitionOperation.current === operation) {
      accountTransitionOperation.current = null;
    }
  }, []);

  const refreshManagedDevices = useCallback(async (connection = preferencesRef.current) => {
    if (!connection.endpoint || !connection.token) {
      setManagedDevices([]);
      return;
    }
    const sourceConnectionKey = mobileAccountConnectionKey(connection);
    try {
      const devices = await listDeviceSyncDevices(connection);
      if (accountTransitionOperation.current !== null) return;
      if (connectionKeyRef.current !== sourceConnectionKey) return;
      setManagedDevices(devices);
    } catch {
      if (accountTransitionOperation.current !== null) return;
      if (connectionKeyRef.current !== sourceConnectionKey) return;
      setManagedDevices([]);
    }
  }, []);

  // Task writes are user-initiated and must not be coalesced, but every one of them has to be
  // cancellable and re-checked against the live account identity before it may commit.
  const beginTaskWrite = useCallback(() => {
    const connectionKey = mobileAccountConnectionKey(preferencesRef.current);
    const lease = taskWrites.issue(connectionKey);
    return {
      signal: lease.signal,
      canCommit: () =>
        isMobileAccountRequestCommitCurrent({
          requestCurrent: lease.isCurrent(),
          requestConnectionKey: connectionKey,
          currentConnectionKey: connectionKeyRef.current,
          transitionOperation: accountTransitionOperation.current,
        }),
      finish: () => lease.release(),
    };
  }, [taskWrites]);

  /** 完成状态刚被云端确认：行内先显示 3 秒「已同步」，随后回到干净状态。 */
  const markCompletionSynced = useCallback((taskId: string) => {
    setSyncedCompletionIds((current) => ({ ...current, [taskId]: Date.now() }));
    const existing = completionSyncedTimers.current.get(taskId);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      completionSyncedTimers.current.delete(taskId);
      setSyncedCompletionIds((current) => {
        if (current[taskId] === undefined) return current;
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    }, 3_000);
    completionSyncedTimers.current.set(taskId, timer);
  }, []);

  const commitNativeConnectionLease = useCallback((lease: string | null) => {
    nativeConnectionLeaseRef.current = lease;
    setNativeConnectionLease(lease);
  }, []);

  const resetTaskSnapshotForAccount = useCallback(async (): Promise<string[]> => {
    taskRefreshes.invalidate();
    taskRequests.invalidate();
    taskSnapshotRef.current = null;
    setTaskSnapshot(null);
    setTaskConfirmedAt(null);
    setSelectedTaskId('');
    setTitleDraft('');
    try {
      await enqueueMutation(cacheMutationQueue, clearCachedTaskSnapshot);
      return [];
    } catch {
      return ['task-cache'];
    }
  }, [taskRefreshes, taskRequests]);

  const resetLiveSnapshotForAccount = useCallback(async (): Promise<string[]> => {
    commandRequests.invalidate();
    pendingCommandRef.current = null;
    setPendingCommand(null);
    liveGeneration.current += 1;
    liveRequest.current?.abort();
    liveRequest.current = null;
    const local = resolveMobileDisplaySnapshot(offlineRuntimeRef.current, null, deviceId);
    liveSnapshotRef.current = local;
    setLiveSnapshot(local);
    setLiveSnapshotSource(local ? 'local' : 'none');
    try {
      await enqueueMutation(cacheMutationQueue, clearCachedLiveFocusSnapshot);
      return [];
    } catch {
      return ['live-cache'];
    }
  }, [commandRequests, deviceId]);

  const resetAccountScopedState = useCallback(async (): Promise<string[]> => {
    ledgerPulls.invalidate();
    ledgerGeneration.current += 1;
    ledgerRequest.current?.abort();
    ledgerRequest.current = null;
    cacheRef.current = EMPTY_CACHE;
    setCache(EMPTY_CACHE);
    setPendingUploadCount(0);
    setPullState('idle');
    setLedgerNotice('账号已切换，正在重新读取同步账本…');
    const [taskIssues, liveIssues] = await Promise.all([
      resetTaskSnapshotForAccount(),
      resetLiveSnapshotForAccount(),
    ]);
    return [...taskIssues, ...liveIssues];
  }, [ledgerPulls, resetLiveSnapshotForAccount, resetTaskSnapshotForAccount]);

  useEffect(
    () => () => {
      accountLifecycle.invalidate();
      invalidateOwnerAccountBootstrap();
      commandRequests.invalidate();
    },
    [accountLifecycle, commandRequests],
  );

  useEffect(() => {
    applyMobileAppearance(appearance);
    saveMobileAppearance(appearance);
    return watchMobileSystemTheme(applyMobileAppearance, appearance);
  }, [appearance]);

  useEffect(() => {
    if (!pairingOffer) return;
    const delay = Math.max(0, pairingOffer.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      setPairingOffer(null);
      pairingAutoGeneratedRef.current = false;
      setCommandNotice('配对码已过期，请重新生成');
    }, delay);
    return () => window.clearTimeout(timer);
  }, [pairingOffer]);

  useEffect(() => {
    void refreshManagedDevices(preferences);
  }, [preferences, refreshManagedDevices]);

  useEffect(() => {
    if (nativeSystemControls.available) return;
    let disposed = false;
    let removeAppStateListener: (() => Promise<void>) | undefined;
    const retryWhenVisible = () => {
      if (!disposed && document.visibilityState === 'visible') {
        setNativeReadinessEpoch((value) => value + 1);
      }
    };
    document.addEventListener('visibilitychange', retryWhenVisible);
    window.addEventListener('focus', retryWhenVisible);
    window.addEventListener('pageshow', retryWhenVisible);
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) retryWhenVisible();
    }).then((handle) => {
      if (disposed) void handle.remove();
      else removeAppStateListener = () => handle.remove();
    });
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', retryWhenVisible);
      window.removeEventListener('focus', retryWhenVisible);
      window.removeEventListener('pageshow', retryWhenVisible);
      if (removeAppStateListener) void removeAppStateListener();
    };
  }, [nativeSystemControls.available]);

  useEffect(() => {
    if (nativeSystemControls.available) return;
    const readiness = new AbortController();
    void waitForNativeFocusRuntimeStartup({ signal: readiness.signal }).then((ready) => {
      if (ready) {
        setNativeSystemControls((current) =>
          current.available ? current : { ...current, available: true },
        );
      }
    });
    return () => readiness.abort();
  }, [nativeReadinessEpoch, nativeSystemControls.available]);

  useEffect(() => {
    if (!nativeSystemControls.available) return;
    const operation = startupRestore.current();
    if (operation === null) return;
    const operationSignal = accountLifecycle.signal(operation);
    let disposed = false;
    const legacyPreferences = preferencesRef.current;
    void accountLifecycle
      .enqueueNative(async () => {
        if (disposed || !accountLifecycle.isCurrent(operation)) return null;
        return restoreOrMigrateNativeFocusConnection(
          legacyPreferences.endpoint && legacyPreferences.token
            ? {
                endpoint: normalizeDeviceSyncEndpoint(legacyPreferences.endpoint),
                accessToken: legacyPreferences.token,
                deviceId: startupDeviceId,
              }
            : null,
          operationSignal,
        );
      })
      .then(async (connection) => {
        if (disposed || !accountLifecycle.isCurrent(operation) || !connection) return;
        const next: MobileConnectionPreferences = {
          endpoint: normalizeDeviceSyncEndpoint(connection.endpoint),
          token: connection.accessToken,
          rememberToken: true,
        };
        let accountStateIssues: string[] = [];
        if (mobileAccountConnectionKey(next) !== connectionKeyRef.current) {
          connectionKeyRef.current = mobileAccountConnectionKey(next);
          accountStateIssues = await resetAccountScopedState();
        }
        if (disposed || !accountLifecycle.isCurrent(operation)) return;
        // The helper has confirmed the Keystore copy. Keep the token only in
        // React memory and now remove any legacy browser remnants.
        const persistenceIssues = persistMobileAccountSessionBestEffort(next, connection.deviceId);
        commitNativeConnectionLease(connection.connectionLease);
        setDeviceId(connection.deviceId);
        preferencesRef.current = next;
        connectionKeyRef.current = mobileAccountConnectionKey(next);
        setPreferences(next);
        setConfigOpen(false);
        setConnectionEpoch((value) => value + 1);
        if (persistenceIssues.length > 0 || accountStateIssues.length > 0) {
          setCommandNotice('账号已从 Android 安全存储恢复，但本机资料持久化仍需下次重试');
        }
      })
      .catch((error) => {
        if (!disposed && accountLifecycle.isCurrent(operation)) {
          setCommandNotice(`Android 安全凭据恢复失败：${errorMessage(error)}`);
        }
      });
    return () => {
      disposed = true;
    };
  }, [
    accountLifecycle,
    commitNativeConnectionLease,
    nativeSystemControls.available,
    resetAccountScopedState,
    startupDeviceId,
    startupRestore,
  ]);

  const applyOwnerAccountSession = useCallback(
    async (session: OwnerAccountSession, operation: number): Promise<boolean> => {
      const endpoint = normalizeDeviceSyncEndpoint(session.endpoint);
      const routed = parseDeviceToken(session.accessToken.trim());
      if (
        endpoint !== OFFICIAL_FOCUSLINK_ENDPOINT ||
        !routed ||
        routed.accountPublicId !== session.accountId ||
        `device-${routed.devicePublicId}` !== session.deviceId
      ) {
        throw new Error('登录服务返回的设备身份无效');
      }
      const next: MobileConnectionPreferences = {
        endpoint,
        token: session.accessToken.trim(),
        rememberToken: true,
      };
      beginAccountTransition(operation);
      const operationSignal = accountLifecycle.signal(operation);
      let committed = false;
      try {
        const transition = await runMobileAccountCommit(
          accountLifecycle,
          operation,
          {
            read: () => readNativeFocusConnectionState(operationSignal),
            async mutate(baseline): Promise<NativeFocusConnectionState> {
              const connection = await configureNativeFocusConnection(
                next.endpoint,
                next.token,
                session.deviceId,
                baseline.connectionLease,
                operationSignal,
              );
              return {
                connection,
                connectionLease: connection?.connectionLease ?? null,
              };
            },
            async restore(baseline, applied) {
              const restored = await restoreNativeFocusConnectionState(
                baseline,
                applied.connectionLease,
              );
              commitNativeConnectionLease(restored.connectionLease);
            },
          },
          resetAccountScopedState,
        );
        if (!transition.current) return false;
        if (isNativeFocusRuntimeAvailable()) {
          setNativeSystemControls((current) =>
            current.available ? current : { ...current, available: true },
          );
        }
        commitNativeConnectionLease(transition.nativeState?.connectionLease ?? null);
        const profile = {
          accountId: session.accountId,
          accountLabel: session.accountLabel,
        };
        const persistenceIssues = [
          ...transition.issues,
          ...persistMobileAccountSessionBestEffort(next, session.deviceId, profile),
        ];
        setDeviceId(session.deviceId);
        preferencesRef.current = next;
        connectionKeyRef.current = mobileAccountConnectionKey(next);
        setPreferences(next);
        setAccountProfile(profile);
        setPairingOffer(null);
        setPairingCode('');
        setConfigOpen(false);
        setConnectionEpoch((value) => value + 1);
        setCommandNotice(
          persistenceIssues.length > 0
            ? '设备已配对，但本机凭据持久化失败；当前会话继续同步并将在下次启动重试'
            : '设备已配对，正在开始同步',
        );
        void refreshManagedDevices(next);
        committed = true;
        return true;
      } finally {
        finishAccountTransition(operation);
        if (!committed && accountLifecycle.isCurrent(operation)) {
          setConnectionEpoch((value) => value + 1);
        }
      }
    },
    [
      accountLifecycle,
      beginAccountTransition,
      commitNativeConnectionLease,
      finishAccountTransition,
      refreshManagedDevices,
      resetAccountScopedState,
    ],
  );

  const bootstrapOwnerAccount = useCallback(
    async (callbackUrl?: string, polling = false) => {
      const operation = accountLifecycle.issue();
      setAccountBusy(true);
      setCommandNotice(callbackUrl ? '正在完成登录…' : '正在登录 FocusLink 账号…');
      try {
        const result = await ownerAccountBootstrapApi().bootstrap({
          installationId: getOrCreateInstallationId(),
          deviceKind: Capacitor.isNativePlatform()
            ? isTabletFocusViewport(window.innerWidth, window.innerHeight)
              ? 'tablet'
              : 'phone'
            : 'web',
          displayName: Capacitor.isNativePlatform() ? 'FocusLink Android' : 'FocusLink Web',
          callbackUrl,
        });
        if (!accountLifecycle.isCurrent(operation)) return;
        if (result.status === 'login-required') {
          if (!polling) await openOwnerLogin(result.loginUrl);
          if (!accountLifecycle.isCurrent(operation)) return;
          setAccountLoginPolling(true);
          setCommandNotice('已打开授权网页，请在网页中完成登录与批准，会自动继续');
          return;
        }
        if (result.status === 'waiting-for-phone') {
          setAccountLoginPolling(true);
          setCommandNotice('请在系统浏览器中完成授权确认，如未弹出请重新点击登录');
          return;
        }
        setAccountLoginPolling(false);
        await applyOwnerAccountSession(result.session, operation);
      } catch (error) {
        if (!accountLifecycle.isCurrent(operation) || isAbortError(error)) return;
        setAccountLoginPolling(false);
        setCommandNotice(errorMessage(error));
        liveConnectionRef.current = 'error';
        setLiveConnection('error');
      } finally {
        if (accountLifecycle.isCurrent(operation)) setAccountBusy(false);
      }
    },
    [accountLifecycle, applyOwnerAccountSession],
  );

  const redeemPairingCode = useCallback(
    async (inputValue = pairingCode) => {
      const code = normalizePairingCodeInput(inputValue);
      if (!/^\d{8}$/.test(code)) {
        setCommandNotice('请输入 8 位数字配对码');
        return;
      }
      const operation = accountLifecycle.issue();
      setAccountLoginPolling(false);
      setAccountBusy(true);
      setCommandNotice('正在加入多端同步…');
      try {
        const native = Capacitor.isNativePlatform();
        const tablet = isTabletFocusViewport(window.innerWidth, window.innerHeight);
        const result = await exchangeDeviceSyncPairingCode({
          endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
          code,
          device: {
            installationId: getOrCreateInstallationId(),
            displayName: native
              ? tablet
                ? 'FocusLink Android 平板'
                : 'FocusLink Android 手机'
              : 'FocusLink Web',
            platform: native ? 'android' : 'web',
            deviceKind: tablet ? 'tablet' : 'phone',
            appVersion: APP_VERSION,
          },
        });
        if (!accountLifecycle.isCurrent(operation)) return;
        const accountId = /^fl2_([A-Za-z0-9-]{6,80})_/.exec(result.accessToken)?.[1];
        if (!accountId) throw new Error('配对响应无效');
        const applied = await applyOwnerAccountSession(
          {
            accountId,
            accountLabel: 'Poyi',
            endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
            accessToken: result.accessToken,
            deviceId: result.deviceId,
          },
          operation,
        );
        if (applied) {
          setPairingCode('');
          setPairingOffer(null);
          setCommandNotice('设备已加入同步，正在读取任务、实时状态和账本');
        }
      } catch (error) {
        if (!accountLifecycle.isCurrent(operation) || isAbortError(error)) return;
        setCommandNotice(errorMessage(error));
      } finally {
        if (accountLifecycle.isCurrent(operation)) setAccountBusy(false);
      }
    },
    [accountLifecycle, applyOwnerAccountSession, pairingCode],
  );

  const revokeManagedDevice = useCallback(async (deviceIdToRevoke: string) => {
    const connection = preferencesRef.current;
    if (!connection.endpoint || !connection.token) return;
    setAccountBusy(true);
    try {
      await revokeDeviceSyncDevice({
        endpoint: connection.endpoint,
        token: connection.token,
        deviceId: deviceIdToRevoke,
      });
      setManagedDevices((current) =>
        current.filter((device) => device.deviceId !== deviceIdToRevoke),
      );
      setCommandNotice('设备已删除，后续同步已停止');
    } catch (error) {
      setCommandNotice(errorMessage(error));
    } finally {
      setAccountBusy(false);
    }
  }, []);

  const createPairingCode = useCallback(async () => {
    const endpoint = preferencesRef.current.endpoint;
    setAccountBusy(true);
    setCommandNotice('正在生成本机配对码…');
    try {
      const offer = await createDeviceSyncPairingRequest({
        endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
        device: currentMobilePairingDevice(),
      });
      if (preferencesRef.current.endpoint !== endpoint) {
        return;
      }
      setPairingOffer(offer);
      setCommandNotice('本机配对码已生成，请在另一台设备输入；两台会自动加入同步');
    } catch (error) {
      setCommandNotice(errorMessage(error));
    } finally {
      setAccountBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!configOpen) {
      pairingAutoGeneratedRef.current = false;
      return;
    }
    if (pairingOffer || accountBusy || pairingAutoGeneratedRef.current) return;
    pairingAutoGeneratedRef.current = true;
    void createPairingCode();
  }, [accountBusy, configOpen, createPairingCode, pairingOffer, preferences.token]);

  useEffect(() => {
    const requestToken = pairingOffer?.requestToken;
    if (!requestToken || pairingOffer.expiresAt <= Date.now()) return;
    const operation = accountLifecycle.issue();
    const controller = new AbortController();
    let disposed = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const result = await claimDeviceSyncPairingRequest({
          endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
          requestToken,
          device: currentMobilePairingDevice(),
          signal: controller.signal,
        });
        if (disposed || !accountLifecycle.isCurrent(operation)) return;
        if (result.status === 'pending') {
          timer = window.setTimeout(() => void poll(), result.retryAfterMs);
          return;
        }
        const accountId = /^fl2_([A-Za-z0-9-]{6,80})_/.exec(result.accessToken)?.[1];
        if (!accountId) throw new Error('配对领取响应无效');
        const applied = await applyOwnerAccountSession(
          {
            accountId,
            accountLabel: 'Poyi',
            endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
            accessToken: result.accessToken,
            deviceId: result.deviceId,
          },
          operation,
        );
        if (applied) {
          setPairingOffer(null);
          setPairingCode('');
          setCommandNotice('两台设备已配对，正在同步任务、实时状态和账本');
        }
      } catch (error) {
        if (disposed || !accountLifecycle.isCurrent(operation) || isAbortError(error)) return;
        setPairingOffer(null);
        pairingAutoGeneratedRef.current = false;
        setCommandNotice(errorMessage(error));
      }
    };
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [accountLifecycle, applyOwnerAccountSession, pairingOffer, preferences.token]);

  useEffect(() => {
    if (!accountLoginPolling || accountBusy || (preferences.endpoint && preferences.token)) return;
    const timer = window.setTimeout(() => void bootstrapOwnerAccount(undefined, true), 1_500);
    return () => window.clearTimeout(timer);
  }, [
    accountBusy,
    accountLoginPolling,
    bootstrapOwnerAccount,
    preferences.endpoint,
    preferences.token,
  ]);

  useEffect(() => {
    let disposed = false;
    let removeListener: (() => Promise<void>) | undefined;
    const acceptAccountCallback = (rawUrl: string) => {
      if (disposed || !isOwnerAccountCallback(rawUrl)) return;
      setConfigOpen(true);
      void bootstrapOwnerAccount(rawUrl);
    };
    void CapacitorApp.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      acceptAccountCallback(event.url);
    }).then((handle) => {
      if (disposed) void handle.remove();
      else removeListener = () => handle.remove();
    });
    void CapacitorApp.getLaunchUrl().then((result) => {
      if (!disposed && result?.url) acceptAccountCallback(result.url);
    });
    return () => {
      disposed = true;
      if (removeListener) void removeListener();
    };
  }, [bootstrapOwnerAccount]);

  const setConnectionState = useCallback((state: LiveConnectionState) => {
    liveConnectionRef.current = state;
    setLiveConnection(state);
  }, []);

  const commitLiveSnapshot = useCallback(
    async (
      response: LiveFocusSnapshotResponse,
      sourceConnectionKey: string,
    ): Promise<LiveFocusSnapshotLike | null> => {
      const canCommit = () =>
        isMobileAccountRequestCommitCurrent({
          requestCurrent: true,
          requestConnectionKey: sourceConnectionKey,
          currentConnectionKey: connectionKeyRef.current,
          transitionOperation: accountTransitionOperation.current,
        });
      if (!canCommit()) return null;
      const mapped = mapLiveSnapshot(response, Date.now());
      const localRuntime = offlineRuntimeRef.current;
      if (localRuntime) {
        const evidence = remoteForkEvidence(mapped, localRuntime.id);
        const mode: MobileAuthorityMode = evidence ? 'forked-local' : 'local-offline';
        authorityModeRef.current = mode;
        setAuthorityMode(mode);
        if (evidence) {
          const existing = await readLocalSessionSyncMeta(localRuntime.id);
          if (!canCommit()) return null;
          const meta: LocalSessionSyncMeta = {
            sessionId: localRuntime.id,
            authorityMode: 'forked-local',
            originDeviceId: existing?.originDeviceId ?? deviceId,
            baseCloudRevision: existing?.baseCloudRevision ?? null,
            suspectedRemoteSessionId: evidence.sessionId,
            detectedRemoteRevision: evidence.revision,
            detectedAt: evidence.detectedAt,
          };
          await writeLocalSessionSyncMeta(meta);
          setCommandNotice('本机离线会话正在运行；其他设备另有云端活动会话，两者将分别入账');
        }
        return liveSnapshotRef.current;
      }
      const current = liveSnapshotRef.current;
      if (!canCommit()) return null;
      if (!shouldApplyLiveSnapshot(current, mapped)) return current;
      liveSnapshotRef.current = mapped;
      setLiveSnapshot(mapped);
      setLiveSnapshotSource('server');
      try {
        const accountId = mobileAccountId(preferencesRef.current);
        if (accountId) {
          await enqueueMutation(cacheMutationQueue, async () => {
            if (!canCommit()) return;
            await writeCachedLiveFocusSnapshot(mapped, accountId);
          });
        }
      } catch (error) {
        if (canCommit()) {
          setCommandNotice(`实时状态已更新，但本机缓存失败：${errorMessage(error)}`);
        }
      }
      return mapped;
    },
    [deviceId],
  );

  const refreshTasks = useCallback(
    (connection: MobileConnectionPreferences): Promise<TaskSnapshotResponse | null> => {
      const connectionKey = mobileAccountConnectionKey(connection);
      if (accountTransitionOperation.current !== null) return Promise.resolve(null);
      return taskRefreshes.run(connectionKey, async () => {
        const request = taskRequests.issue(connectionKey);
        const canCommit = () =>
          isMobileAccountRequestCommitCurrent({
            requestCurrent: request.isCurrent(),
            requestConnectionKey: connectionKey,
            currentConnectionKey: connectionKeyRef.current,
            transitionOperation: accountTransitionOperation.current,
          });
        try {
          const storedEtag = taskSnapshotEtag.current;
          const ifNoneMatch =
            storedEtag && storedEtag.connectionKey === connectionKey ? storedEtag.etag : null;
          const fetched = await fetchTaskSnapshotConditional({
            endpoint: connection.endpoint,
            token: connection.token,
            signal: request.signal,
            ifNoneMatch,
          });
          if (!canCommit()) return null;
          taskSnapshotEtag.current = fetched.etag ? { connectionKey, etag: fetched.etag } : null;
          if (fetched.notModified) {
            // The cloud register still matches our confirmed revision: keep the snapshot and
            // only move the freshness clock, so an idle poll stops re-downloading the list.
            taskSnapshotCadence.current.unchangedStreak = advanceMobileTaskSnapshotStreak(
              taskSnapshotCadence.current.unchangedStreak,
              'unchanged',
            );
            setTaskConfirmedAt(Date.now());
            return taskSnapshotRef.current;
          }
          const response = fetched.response;
          const reconciliation = reconcileTaskSnapshot(taskSnapshotRef.current, response);
          if (reconciliation.freshness === 'stale') return taskSnapshotRef.current;
          if (reconciliation.freshness === 'inconsistent') {
            setCommandNotice('任务清单 revision 内容不一致，已保留本机较可信快照并继续重试');
            return null;
          }
          // A different revision means somebody wrote: go back to the fast 5 s cadence.
          taskSnapshotCadence.current.unchangedStreak = advanceMobileTaskSnapshotStreak(
            taskSnapshotCadence.current.unchangedStreak,
            reconciliation.freshness === 'refresh' ? 'unchanged' : 'changed',
          );
          taskSnapshotRef.current = reconciliation.snapshot;
          setTaskSnapshot(reconciliation.snapshot);
          setTaskConfirmedAt(Date.now());
          const accountId = mobileAccountId(connection);
          await enqueueMutation(cacheMutationQueue, async () => {
            if (!canCommit()) return;
            // 与账号无关的一份兜底快照：旧版配对令牌没有 accountId，
            // 缺了它离线冷启动只能显示空列表。
            await writeLegacyCachedTaskSnapshot(reconciliation.snapshot);
            if (accountId) {
              await writeCachedTaskSnapshot(reconciliation.snapshot, accountId);
            }
          });
          return reconciliation.snapshot;
        } catch (error) {
          if (!canCommit() || isAbortError(error)) return null;
          // A failing poll keeps its current cadence; only a confirmed read may slow it down.
          taskSnapshotCadence.current.unchangedStreak = advanceMobileTaskSnapshotStreak(
            taskSnapshotCadence.current.unchangedStreak,
            'failed',
          );
          setCommandNotice(
            (current) => current ?? `任务清单刷新失败：${errorMessage(error)}；继续使用本机缓存`,
          );
          return null;
        } finally {
          request.finish();
        }
      });
    },
    [taskRefreshes, taskRequests],
  );

  const requireLatestEditableTaskSnapshot = useCallback(async () => {
    if (!preferences.endpoint || !preferences.token) {
      throw new Error('请先完成设备配对');
    }
    const confirmed = await refreshTasks(preferences);
    if (!confirmed) throw new Error('未能确认最新任务清单，请检查网络后重试');
    if (confirmed.snapshot) return confirmed.snapshot;
    if (confirmed.revision === 0) return createEmptyTaskSnapshot(Date.now());
    throw new Error('任务清单状态异常，请刷新后重试');
  }, [preferences, refreshTasks]);

  // 冷启动先还原上次确认过的任务快照，否则离线重开会显示「还没有任务」。
  useEffect(() => {
    let current = true;
    const accountId = mobileAccountId(preferences);
    if (!accountId)
      return () => {
        current = false;
      };
    void (accountId ? readCachedTaskSnapshot(accountId) : readLegacyCachedTaskSnapshot())
      .then((cached) => cached ?? readLegacyCachedTaskSnapshot())
      .then((cached) => {
        if (!current || !cached) return;
        setTaskSnapshot((existing) =>
          existing && existing.revision > cached.revision ? existing : cached,
        );
      })
      .catch(() => undefined);
    void readCachedTaskSnapshotConfirmedAt(accountId)
      .then((confirmedAt) => {
        if (!current || confirmedAt === null) return;
        setTaskConfirmedAt((existing) => existing ?? confirmedAt);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [preferences]);

  useEffect(() => {
    let current = true;
    void readLocalTaskCreates(localTaskScope)
      .then((records) => {
        if (current) setLocalTaskCreates(records);
      })
      .catch(() => {
        if (current) setCommandNotice('无法读取本机待同步任务，原记录未清除');
      });
    void readLocalTaskEdits(localTaskScope)
      .then((records) => {
        if (current) setLocalTaskEdits(records);
      })
      .catch(() => {
        if (current) setCommandNotice('无法读取本机待同步修改，原记录未清除');
      });
    void readLocalTaskCompletions(localTaskScope)
      .then((records) => {
        if (current) setLocalTaskCompletions(records);
      })
      .catch(() => {
        if (current) setCommandNotice('无法读取本机完成状态，原记录未清除');
      });
    return () => {
      current = false;
    };
  }, [localTaskScope, localTaskQueueEpoch]);

  useEffect(() => {
    if (!foregroundActive || !online || localTaskScope === 'unpaired') return;
    const eligible = localTaskCreates.filter((r) => !r.blocked);
    if (eligible.length === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    const delay = Math.max(0, Math.min(...eligible.map((r) => r.nextRetryAt)) - Date.now());
    const timer = window.setTimeout(() => {
      void (async () => {
        const write = beginTaskWrite();
        const abort = () => controller.abort();
        write.signal.addEventListener('abort', abort, { once: true });
        const current = () => !cancelled && !controller.signal.aborted && write.canCommit();
        try {
          for (const original of eligible) {
            if (!current() || original.nextRetryAt > Date.now()) continue;
            const latest = (await readLocalTaskCreates(localTaskScope)).find(
              (r) => r.id === original.id,
            );
            if (!current()) return;
            if (!latest) continue;
            let record = latest;
            try {
              const fetched = await fetchTaskSnapshotConditional({
                endpoint: preferences.endpoint,
                token: preferences.token,
                signal: controller.signal,
              });
              if (!current()) return;
              if (fetched.notModified) {
                record = { ...record, blocked: true, lastErrorCode: 'contract_error' };
                throw new Error('任务快照响应异常，已保留本机任务');
              }
              const remote = fetched.response;
              // Unpaired local records bind only after this account has answered a read.
              record = prepareLocalTaskCreate({ ...record, scope: localTaskScope }, remote);
              await writeLocalTaskCreate(record);
              if (!current()) return;
              const response = await mutateTaskSnapshot({
                endpoint: preferences.endpoint,
                token: preferences.token,
                deviceId,
                signal: controller.signal,
                operationId: record.operationId,
                expectedRevision: record.expectedRevision!,
                mutation: {
                  kind: 'create_task',
                  taskId: record.id,
                  title: record.title,
                  projectId: record.projectId,
                },
              });
              if (!current()) return;
              if (
                response.operationId !== record.operationId ||
                response.result.entityId !== record.id
              ) {
                record = { ...record, blocked: true, lastErrorCode: 'contract_error' };
                throw new Error('任务回执身份不一致，已保留本机任务');
              }
              await enqueueMutation(cacheMutationQueue, async () => {
                if (!current()) return;
                const reconciled = reconcileTaskSnapshot(taskSnapshotRef.current, response);
                if (reconciled.freshness === 'inconsistent') {
                  record = { ...record, blocked: true, lastErrorCode: 'contract_error' };
                  throw new Error('任务回执与本机已确认内容不一致，已保留待同步任务');
                }
                taskSnapshotRef.current = reconciled.snapshot;
                setTaskSnapshot(reconciled.snapshot);
                setTaskConfirmedAt(Date.now());
                await writeCachedTaskSnapshot(reconciled.snapshot, localTaskScope);
              });
              if (!current()) return;
              await writeLocalTaskCreate(record, true);
            } catch (error) {
              if (!current() || isAbortError(error)) return;
              const failed = record.blocked
                ? record
                : retryLocalTaskCreate(
                    record,
                    error instanceof MobileLiveRequestError ? error.status : null,
                    Date.now(),
                    error instanceof MobileLiveRequestError ? error.retryAfterMs : null,
                  );
              await writeLocalTaskCreate(failed);
              setCommandNotice(
                localTaskCreateIssue(failed) ??
                  '任务已保存在本机，云端暂未确认；恢复连接后将继续同步',
              );
            }
          }
        } finally {
          write.signal.removeEventListener('abort', abort);
          write.finish();
          if (!cancelled) setLocalTaskQueueEpoch((n) => n + 1);
        }
      })().catch(() => {
        if (!cancelled) setCommandNotice('任务同步暂未完成，本机待同步任务仍保留');
      });
    }, delay);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    beginTaskWrite,
    deviceId,
    foregroundActive,
    localTaskCreates,
    localTaskScope,
    online,
    preferences,
  ]);

  const createCloudTask = useCallback(
    async (title: string, projectId: string | null) => {
      if (accountTransitionOperation.current !== null)
        throw new Error('正在切换同步空间，请稍后再保存');
      const record = newLocalTaskCreate(crypto.randomUUID(), localTaskScope, title, projectId);
      await writeLocalTaskCreate(record);
      if ((mobileAccountId(preferencesRef.current) ?? 'unpaired') !== record.scope) return;
      setLocalTaskCreates((records) => [
        ...records.filter((item) => item.id !== record.id),
        record,
      ]);
      setLocalTaskQueueEpoch((n) => n + 1);
      setCommandNotice('任务已保存在本机；联网时自动同步');
    },
    [localTaskScope],
  );

  const createCloudProject = useCallback(
    async (name: string) => {
      const now = Date.now();
      const snapshot = await requireLatestEditableTaskSnapshot();
      const projectCount = snapshot.projects.filter(
        (project) => !isFocusLinkInboxProject(project.id),
      ).length;
      const projectId = crypto.randomUUID();
      const write = beginTaskWrite();
      try {
        const response = await publishTaskSnapshot({
          endpoint: preferences.endpoint,
          token: preferences.token,
          deviceId,
          signal: write.signal,
          snapshot: {
            ...snapshot,
            publishedAt: now,
            projects: [
              ...snapshot.projects,
              {
                id: projectId,
                source: 'local',
                name,
                color: defaultTaskProjectColor(projectCount + 1),
              },
            ],
          },
        });
        if (!write.canCommit()) throw new Error('账号已切换，本次清单创建已取消');
        taskSnapshotRef.current = response;
        setTaskSnapshot(response);
        setTaskConfirmedAt(Date.now());
        const accountId = mobileAccountId(preferences);
        if (accountId) {
          await enqueueMutation(cacheMutationQueue, async () => {
            if (!write.canCommit()) return;
            await writeCachedTaskSnapshot(response, accountId);
          });
        }
        setCommandNotice('清单已保存到 FocusLink 云端');
        return projectId;
      } finally {
        write.finish();
      }
    },
    [beginTaskWrite, deviceId, preferences, requireLatestEditableTaskSnapshot],
  );

  const updateCloudProject = useCallback(
    async (project: SyncedTaskProject, input: { name?: string; color?: string | null }) => {
      const snapshot = await requireLatestEditableTaskSnapshot();
      const freshProject = snapshot.projects.find((candidate) => candidate.id === project.id);
      if (!freshProject) throw new Error('FocusLink 清单不存在，请刷新后重试');
      const now = Date.now();
      const write = beginTaskWrite();
      try {
        const response = await publishTaskSnapshot({
          endpoint: preferences.endpoint,
          token: preferences.token,
          deviceId,
          signal: write.signal,
          snapshot: updateTaskSnapshotProject(snapshot, freshProject, input, now),
        });
        if (!write.canCommit()) return;
        taskSnapshotRef.current = response;
        setTaskSnapshot(response);
        setTaskConfirmedAt(Date.now());
        const accountId = mobileAccountId(preferences);
        if (accountId) {
          await enqueueMutation(cacheMutationQueue, async () => {
            if (!write.canCommit()) return;
            await writeCachedTaskSnapshot(response, accountId);
          });
        }
        setCommandNotice('清单名称与颜色已同步');
      } finally {
        write.finish();
      }
    },
    [beginTaskWrite, deviceId, preferences, requireLatestEditableTaskSnapshot],
  );

  const deleteCloudProject = useCallback(
    async (project: SyncedTaskProject) => {
      const snapshot = await requireLatestEditableTaskSnapshot();
      const freshProject = snapshot.projects.find((candidate) => candidate.id === project.id);
      if (!freshProject) throw new Error('FocusLink 清单不存在，请刷新后重试');
      const now = Date.now();
      const next = deleteTaskSnapshotProject(snapshot, freshProject, now);
      const write = beginTaskWrite();
      try {
        const response = await publishTaskSnapshot({
          endpoint: preferences.endpoint,
          token: preferences.token,
          deviceId,
          signal: write.signal,
          snapshot: next.snapshot,
        });
        if (!write.canCommit()) return;
        taskSnapshotRef.current = response;
        setTaskSnapshot(response);
        setTaskConfirmedAt(Date.now());
        const accountId = mobileAccountId(preferences);
        if (accountId) {
          await enqueueMutation(cacheMutationQueue, async () => {
            if (!write.canCommit()) return;
            await writeCachedTaskSnapshot(response, accountId);
          });
        }
        setCommandNotice(`清单已删除，${next.movedTaskCount} 项任务已移到收件箱`);
      } finally {
        write.finish();
      }
    },
    [beginTaskWrite, deviceId, preferences, requireLatestEditableTaskSnapshot],
  );

  const moveCloudTask = useCallback(
    async (task: SyncedTask, targetProjectId: string) => {
      const snapshot = await requireLatestEditableTaskSnapshot();
      const freshTask = snapshot.tasks.find((candidate) => candidate.id === task.id);
      if (!freshTask) throw new Error('FocusLink 任务不存在，请刷新后重试');
      const projectId = targetProjectId || FOCUSLINK_INBOX_PROJECT_ID;
      const now = Date.now();
      const write = beginTaskWrite();
      try {
        const response = await publishTaskSnapshot({
          endpoint: preferences.endpoint,
          token: preferences.token,
          deviceId,
          signal: write.signal,
          snapshot: moveTaskSnapshotSubtree(snapshot, freshTask.id, projectId, now),
        });
        if (!write.canCommit()) return;
        taskSnapshotRef.current = response;
        setTaskSnapshot(response);
        setTaskConfirmedAt(Date.now());
        const accountId = mobileAccountId(preferences);
        if (accountId) {
          await enqueueMutation(cacheMutationQueue, async () => {
            if (!write.canCommit()) return;
            await writeCachedTaskSnapshot(response, accountId);
          });
        }
        const destination = response.snapshot?.projects.find(
          (project) => project.id === projectId,
        )?.name;
        setCommandNotice(`任务已移到「${destination ?? '收件箱'}」`);
      } finally {
        write.finish();
      }
    },
    [beginTaskWrite, deviceId, preferences, requireLatestEditableTaskSnapshot],
  );

  /**
   * 完成/恢复先落本机：只等 IndexedDB 写入，不再先刷新远端整份清单，连续勾选因此互不阻塞。
   * 真正的云端提交由补发流程在撤销窗口之后按顺序完成。
   */
  const setCloudTaskCompleted = useCallback(
    async (task: SyncedTask, completed: boolean) => {
      if (!preferences.endpoint || !preferences.token) {
        throw new Error('请先完成设备配对');
      }
      if (accountTransitionOperation.current !== null) {
        throw new Error('正在切换同步空间，请稍后再试');
      }
      const scope = localTaskScope;
      const plan = planTaskCompletionIntent({
        records: localTaskCompletions,
        taskId: task.id,
        scope,
        completed,
        now: Date.now(),
      });
      if (plan.kind === 'noop') return;
      if (plan.kind === 'drop') {
        // 撤销窗口内：直接丢弃意图。云端从未看到这次完成，循环任务也不会被推进。
        await writeLocalTaskCompletion(plan.record, true);
        setLocalTaskCompletions((records) => records.filter((r) => r.taskId !== task.id));
        setCommandNotice('已撤销，本次完成没有发往云端');
        return;
      }
      await writeLocalTaskCompletion(plan.record);
      if ((mobileAccountId(preferencesRef.current) ?? 'unpaired') !== scope) return;
      setLocalTaskCompletions((records) => [
        ...records.filter((r) => r.taskId !== task.id),
        plan.record,
      ]);
      setLocalTaskCompletionEpoch((n) => n + 1);
      setCommandNotice(
        plan.kind === 'replace'
          ? completed
            ? '已完成，已保存在本机'
            : '已恢复，已保存在本机'
          : completed
            ? '已完成，已保存在本机；网络恢复后自动同步'
            : '已恢复，已保存在本机；网络恢复后自动同步',
      );
    },
    [localTaskCompletions, localTaskScope, preferences],
  );

  const enqueueTaskEdit = useCallback(
    async (task: SyncedTask, patch: LocalTaskEditPatch, deleted: boolean) => {
      const now = Date.now();
      const previous = localTaskEditRecords.find((record) => record.taskId === task.id);
      const merged = previous
        ? mergeLocalTaskEdit(previous, deleted ? null : patch)
        : newLocalTaskEdit(task.id, localTaskScope, deleted ? {} : patch, deleted, now);
      await writeLocalTaskEdit(merged);
      setLocalTaskEdits((records) => [...records.filter((r) => r.taskId !== task.id), merged]);
      return merged;
    },
    [localTaskEditRecords, localTaskScope],
  );

  /** Publish one pending edit; the record is dropped only after the cloud confirms it. */
  const flushTaskEdit = useCallback(
    async (record: LocalTaskEdit) => {
      const snapshot = await requireLatestEditableTaskSnapshot();
      const now = Date.now();
      const next = record.deleted
        ? deleteTaskSnapshotTask(snapshot, record.taskId, now).snapshot
        : updateTaskSnapshotTask(snapshot, record.taskId, record.patch, now);
      const write = beginTaskWrite();
      try {
        const response = await publishTaskSnapshot({
          endpoint: preferences.endpoint,
          token: preferences.token,
          deviceId,
          signal: write.signal,
          snapshot: next,
        });
        if (!write.canCommit()) throw new Error('账号已切换，本次修改已取消');
        taskSnapshotRef.current = response;
        setTaskSnapshot(response);
        setTaskConfirmedAt(Date.now());
        const accountId = mobileAccountId(preferences);
        if (accountId) {
          await enqueueMutation(cacheMutationQueue, async () => {
            if (!write.canCommit()) return;
            await writeCachedTaskSnapshot(response, accountId);
          });
        }
        await writeLocalTaskEdit(record, true);
        setLocalTaskEdits((records) => records.filter((r) => r.taskId !== record.taskId));
      } finally {
        write.finish();
      }
    },
    [beginTaskWrite, deviceId, preferences, requireLatestEditableTaskSnapshot],
  );

  const queueTaskEdit = useCallback(
    async (task: SyncedTask, patch: LocalTaskEditPatch, deleted: boolean) => {
      const record = await enqueueTaskEdit(task, patch, deleted);
      try {
        await flushTaskEdit(record);
        setCommandNotice(deleted ? '任务已删除' : '任务已更新');
      } catch (error) {
        if (isAbortError(error)) throw error;
        const retried = retryLocalTaskEdit(
          record,
          error instanceof MobileLiveRequestError ? error.status : null,
          Date.now(),
        );
        await writeLocalTaskEdit(retried);
        setLocalTaskEdits((records) => [...records.filter((r) => r.taskId !== task.id), retried]);
        setCommandNotice(
          localTaskEditIssue(retried)
            ? '本机修改已保留，服务端拒绝后需你确认'
            : '修改已保存在本机；联网时自动同步',
        );
      }
    },
    [enqueueTaskEdit, flushTaskEdit],
  );

  const updateCloudTask = useCallback(
    async (task: SyncedTask, patch: LocalTaskEditPatch) => {
      await queueTaskEdit(task, patch, false);
    },
    [queueTaskEdit],
  );

  const deleteCloudTask = useCallback(
    async (task: SyncedTask) => {
      await queueTaskEdit(task, {}, true);
    },
    [queueTaskEdit],
  );

  // 一条任务在离线期间的多次修改已经合并成一条记录；联网后按创建时间顺序补发。
  useEffect(() => {
    if (!foregroundActive || !online || localTaskScope === 'unpaired') return;
    const retryable = localTaskEdits.filter((record) => !record.blocked);
    if (retryable.length === 0) return;
    const due = retryable.filter((record) => record.nextRetryAt <= Date.now());
    if (due.length === 0) {
      // 退避中的记录必须自己醒来，否则联网后没有任何事件会重新触发补发。
      const wait = Math.max(0, Math.min(...retryable.map((r) => r.nextRetryAt)) - Date.now());
      const wake = window.setTimeout(() => setLocalTaskEditEpoch((n) => n + 1), wait);
      return () => window.clearTimeout(wake);
    }
    const pending = due;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        void (async () => {
          for (const record of pending) {
            if (cancelled || controller.signal.aborted) return;
            const latest = (await readLocalTaskEdits(localTaskScope)).find(
              (candidate) => candidate.taskId === record.taskId,
            );
            if (!latest || latest.blocked) continue;
            try {
              await flushTaskEdit(latest);
              if (!cancelled) setCommandNotice('本机修改已同步到云端');
            } catch (error) {
              if (cancelled || isAbortError(error)) return;
              const retried = retryLocalTaskEdit(
                latest,
                error instanceof MobileLiveRequestError ? error.status : null,
                Date.now(),
                error instanceof MobileLiveRequestError ? error.retryAfterMs : null,
              );
              await writeLocalTaskEdit(retried);
              setLocalTaskEdits((records) => [
                ...records.filter((r) => r.taskId !== latest.taskId),
                retried,
              ]);
              if (retried.blocked) return;
            }
          }
        })();
      },
      Math.max(0, Math.min(...pending.map((r) => r.nextRetryAt)) - Date.now()),
    );
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [flushTaskEdit, foregroundActive, localTaskEditEpoch, localTaskEdits, localTaskScope, online]);

  /**
   * 提交一条完成/恢复意图。撤销窗口结束后才第一次调用；只有仍是同一意图才清记录。
   * 返回 null 表示回执期间意图已被改写，记录保留给下一轮补发。
   */
  const flushTaskCompletion = useCallback(
    async (record: LocalTaskCompletion): Promise<{ recurrenceRolled: boolean } | null> => {
      const confirmed = await refreshTasks(preferences);
      if (!confirmed) throw new Error('未能确认最新任务清单，请检查网络后重试');
      const write = beginTaskWrite();
      try {
        if (!write.canCommit()) throw new Error('账号已切换，本次完成状态已取消');
        const response = await mutateTaskSnapshot({
          endpoint: preferences.endpoint,
          token: preferences.token,
          deviceId,
          signal: write.signal,
          operationId: record.operationId,
          expectedRevision: confirmed.revision,
          mutation: {
            kind: 'set_task_completed',
            taskId: record.taskId,
            completed: record.completed,
          },
        });
        if (!write.canCommit()) return null;
        if (response.operationId !== record.operationId) {
          throw new Error('完成回执身份不一致，已保留本机记录');
        }
        const reconciled = reconcileTaskSnapshot(taskSnapshotRef.current, response);
        if (reconciled.freshness === 'inconsistent') {
          throw new Error('任务回执与本机已确认内容不一致，已保留本机完成记录');
        }
        taskSnapshotRef.current = reconciled.snapshot;
        setTaskSnapshot(reconciled.snapshot);
        setTaskConfirmedAt(Date.now());
        const accountId = mobileAccountId(preferences);
        if (accountId) {
          await enqueueMutation(cacheMutationQueue, async () => {
            if (!write.canCommit()) return;
            await writeCachedTaskSnapshot(reconciled.snapshot, accountId);
          });
        }
        // 回执期间用户可能已经改成反向意图：只有仍是同一意图才清记录。
        const after = (await readLocalTaskCompletions(localTaskScope)).find(
          (candidate) => candidate.taskId === record.taskId,
        );
        if (after && after.operationId === record.operationId) {
          await writeLocalTaskCompletion(record, true);
          return { recurrenceRolled: response.result.recurrenceRolled === true };
        }
        return null;
      } finally {
        write.finish();
      }
    },
    [beginTaskWrite, deviceId, localTaskScope, preferences, refreshTasks],
  );

  /**
   * 完成/恢复意图补发：撤销窗口结束后才第一次发出，按创建顺序逐条提交。
   *
   * 队列只从 IndexedDB 读，不用 React 状态做调度：每次提交成功都会更新状态，
   * 若把状态放进依赖，effect 会被自己的更新打断，队尾那条记录永远发不出去。
   * 一轮结束后隔 400ms 再看一次，覆盖「上一轮里还没到 notBefore」的记录。
   */
  useEffect(() => {
    if (!foregroundActive || !online || localTaskScope === 'unpaired') return;
    let cancelled = false;
    const controller = new AbortController();
    let timer: number | null = null;

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        timer = null;
        void run();
      }, delay);
    };

    const run = async () => {
      if (cancelled) return;
      const records = (await readLocalTaskCompletions(localTaskScope)).filter(
        (record) => !record.blocked,
      );
      if (cancelled) return;
      if (records.length === 0) return;
      const nextDue = Math.min(
        ...records.map((record) => Math.max(record.nextRetryAt, record.notBefore)),
      );
      const now = Date.now();
      if (nextDue > now) {
        // 最长等 15 秒就重新看一次队列：前台恢复或网络刚回来时能比退避更早地接上。
        schedule(Math.min(nextDue - now, 15_000));
        return;
      }
      for (const record of sortLocalTaskCompletions(records)) {
        if (cancelled || controller.signal.aborted) return;
        if (record.notBefore > Date.now() || record.nextRetryAt > Date.now()) continue;
        const latest = (await readLocalTaskCompletions(localTaskScope)).find(
          (candidate) => candidate.taskId === record.taskId,
        );
        if (cancelled) return;
        if (!latest || latest.blocked) continue;
        try {
          const response = await flushTaskCompletion(latest);
          if (cancelled) return;
          if (!response) continue;
          setLocalTaskCompletions((current) =>
            current.filter((candidate) => candidate.taskId !== latest.taskId),
          );
          markCompletionSynced(latest.taskId);
          if (latest.completed) {
            setCommandNotice(
              response.recurrenceRolled ? '本次已完成，下次循环已推进；已同步' : '已完成并同步',
            );
          } else {
            setCommandNotice('已恢复未完成并同步');
          }
        } catch (error) {
          if (cancelled || isAbortError(error)) return;
          const failed = retryLocalTaskCompletion(
            latest,
            error instanceof MobileLiveRequestError ? error.status : null,
            Date.now(),
            error instanceof MobileLiveRequestError ? error.retryAfterMs : null,
          );
          await writeLocalTaskCompletion(failed);
          if (cancelled) return;
          setLocalTaskCompletions((current) => [
            ...current.filter((candidate) => candidate.taskId !== failed.taskId),
            failed,
          ]);
          setCommandNotice(
            localTaskCompletionIssue(failed) ??
              '完成状态已保存在本机，云端暂未确认；恢复连接后继续同步',
          );
          if (failed.blocked) continue;
        }
      }
      schedule(400);
    };

    schedule(0);
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [
    flushTaskCompletion,
    foregroundActive,
    localTaskCompletionEpoch,
    localTaskScope,
    markCompletionSynced,
    online,
  ]);

  const pullLedger = useCallback(
    (connection: MobileConnectionPreferences, _startCursor: string | null): Promise<void> => {
      const sourceConnectionKey = mobileAccountConnectionKey(connection);
      if (accountTransitionOperation.current !== null) return Promise.resolve();
      return ledgerPulls.run(sourceConnectionKey, async () => {
        const sourceNativeLease = nativeConnectionLease;
        const pullStartedAt = Date.now();
        ledgerPullTrace.current = {
          connectionKey: sourceConnectionKey,
          startedAt: pullStartedAt,
          finishedAt: null,
        };
        ledgerRequest.current?.abort();
        const controller = new AbortController();
        const generation = ledgerGeneration.current + 1;
        ledgerGeneration.current = generation;
        ledgerRequest.current = controller;
        setPullState('pulling');
        setLedgerNotice('正在拉取已结束会话账本…');

        const isCurrent = () =>
          isMobileAccountRequestCommitCurrent({
            requestCurrent:
              ledgerGeneration.current === generation &&
              ledgerRequest.current === controller &&
              !controller.signal.aborted,
            requestConnectionKey: sourceConnectionKey,
            currentConnectionKey: connectionKeyRef.current,
            transitionOperation: accountTransitionOperation.current,
          });

        try {
          const attemptedAt = Date.now();
          const synced = await runMobileSyncV2({
            endpoint: connection.endpoint,
            token: connection.token,
            deviceId,
            signal: controller.signal,
          });
          if (!isCurrent()) return;
          const snapshot = await readMobileCache();
          if (!isCurrent()) return;
          const pending = await readPendingDeviceSyncBundles();
          if (!isCurrent()) return;
          const confirmedAt = Date.now();
          const presentation = presentMobileLedgerSync({
            uploaded: synced.uploaded,
            downloaded: synced.downloaded,
            bundleCount: snapshot.bundles.length,
            outstandingCount: countOutstandingLedgerEntities(
              pending,
              synced.outstandingEntityIds,
              deviceId,
            ),
            conflicts: synced.conflicts,
            unresolvedConflicts: synced.unresolvedConflicts,
            rejected: synced.rejected,
          });
          await updateNativeAuthorityProjectionHistory({
            deviceId,
            connectionLease: sourceNativeLease,
            records: snapshot.bundles,
            lastVerifiedAt: mobileLedgerProjectionVerifiedAt(
              presentation.pullState,
              synced.lastVerifiedAt,
              synced.lastVerifiedAt ?? confirmedAt,
            ),
            lastAttemptAt: attemptedAt,
            pendingCount: presentation.pendingCount,
            lastErrorCode: presentation.lastErrorCode,
          }).catch(() => false);
          if (!isCurrent()) return;
          setPendingUploadCount(presentation.pendingCount);
          cacheRef.current = snapshot;
          setCache(snapshot);
          setPullState(presentation.pullState);
          setLedgerNotice(presentation.notice);
          ledgerRetryAttempts.current = 0;
          setLedgerRetryAt(null);
          setLedgerRejectedCount(synced.rejected);
          const conflicts = await readMobileV2Conflicts().catch(() => []);
          if (!isCurrent()) return;
          setSyncConflicts(conflicts);
        } catch (error) {
          if (!isCurrent() || isAbortError(error)) return;
          const [pending, v2Status] = await Promise.all([
            readPendingDeviceSyncBundles().catch(() => []),
            readMobileV2Status(deviceId).catch(() => null),
          ]);
          if (!isCurrent()) return;
          const presentation = presentMobileLedgerSync({
            uploaded: 0,
            downloaded: 0,
            bundleCount: cacheRef.current.bundles.length,
            outstandingCount: countOutstandingLedgerEntities(
              pending,
              v2Status?.outstandingEntityIds ?? [],
              deviceId,
            ),
            conflicts: v2Status?.conflicts ?? 0,
            unresolvedConflicts: v2Status?.conflicts ?? 0,
            rejected: v2Status?.rejected ?? 0,
          });
          if (!isCurrent()) return;
          setLedgerRejectedCount(v2Status?.rejected ?? 0);
          await updateNativeAuthorityProjectionHistory({
            deviceId,
            connectionLease: sourceNativeLease,
            records: cacheRef.current.bundles,
            lastVerifiedAt: v2Status?.lastVerifiedAt ?? null,
            lastAttemptAt: Date.now(),
            pendingCount: presentation.pendingCount,
            lastErrorCode: classifySyncV2Error(error),
          }).catch(() => false);
          if (!isCurrent()) return;
          // Retry classification: transport/backpressure failures are retried on
          // the exponential schedule (15 s doubling to 15 min, server Retry-After
          // as a floor); contract/credential failures are parked and wait for a
          // user action instead of being retried on the network cadence.
          const retryState = await readMobileV2RetryState(deviceId).catch(() => null);
          if (!isCurrent()) return;
          const attemptCount = Math.max(retryState?.attemptCount ?? 0, ledgerRetryAttempts.current);
          const retry = decideMobileV2Retry({
            code: classifySyncV2Error(error),
            attemptCount,
            retryAfterMs: error instanceof SyncV2ClientError ? error.retryAfterMs : null,
          });
          ledgerRetryAttempts.current = retry.retryable ? attemptCount + 1 : 0;
          const retryDelayMs = retryState?.nextRetryAt
            ? Math.max(1_000, retryState.nextRetryAt - Date.now())
            : retry.delayMs;
          setPendingUploadCount(presentation.pendingCount);
          setPullState('error');
          setLedgerNotice(
            [
              errorMessage(error),
              presentation.pullState === 'partial' ? presentation.notice : null,
              cacheRef.current.bundles.length > 0 ? '已结束账本继续显示本机缓存' : null,
              retry.retryable ? describeMobileV2RetryWait(retryDelayMs) : null,
            ]
              .filter(Boolean)
              .join('；'),
          );
          setLedgerRetryAt(
            retry.retryable ? (retryState?.nextRetryAt ?? Date.now() + retry.delayMs) : null,
          );
          const conflicts = await readMobileV2Conflicts().catch(() => []);
          if (!isCurrent()) return;
          setSyncConflicts(conflicts);
        } finally {
          if (ledgerRequest.current === controller) ledgerRequest.current = null;
          const trace = ledgerPullTrace.current;
          if (trace === null || trace.startedAt === pullStartedAt) {
            ledgerPullTrace.current = {
              connectionKey: sourceConnectionKey,
              startedAt: pullStartedAt,
              finishedAt: Date.now(),
            };
          }
        }
      });
    },
    [deviceId, ledgerPulls, nativeConnectionLease],
  );

  // Single entry point for every automatic ledger pull. Identity and freshness
  // come from the pure policy, so a resume storm, a rebuilt pull callback and a
  // drained native command cannot stack three identical round trips.
  const requestLedgerPull = useCallback(
    (reason: MobileLedgerPullReason): Promise<void> => {
      const connection = preferencesRef.current;
      if (!connection.endpoint || !connection.token) return Promise.resolve();
      const decision = decideMobileLedgerPull({
        reason,
        connectionKey: mobileAccountConnectionKey(connection),
        now: Date.now(),
        trace: ledgerPullTrace.current,
      });
      if (!decision.start) {
        // A joined trigger is replayed once instead of dropped, otherwise a
        // native command that finished during an in-flight pull would leave the
        // new ledger row unconfirmed until some unrelated trigger happened.
        if (decision.skipReason === 'in-flight') pendingLedgerPull.current = reason;
        return Promise.resolve();
      }
      const settled = pullLedger(connection, cacheRef.current.cursor);
      void settled.then(
        () => {
          if (pendingLedgerPull.current === null) return;
          pendingLedgerPull.current = null;
          const next = preferencesRef.current;
          if (!next.endpoint || !next.token) return;
          if (accountTransitionOperation.current !== null) return;
          // The replay bypasses the freshness window on purpose: it represents a
          // trigger that arrived while the previous pull was already running.
          void pullLedger(next, cacheRef.current.cursor);
        },
        () => undefined,
      );
      return settled;
    },
    [pullLedger],
  );

  // A retryable ledger failure schedules exactly one follow-up pull on the
  // backoff its outbox rows already carry. The timer is dropped while the app is
  // suspended, during an account transition, or once the connection changed
  // underneath it; nothing here is durable state.
  useEffect(() => {
    if (ledgerRetryAt === null) return undefined;
    const delay = Math.max(1_000, ledgerRetryAt - Date.now());
    const timer = window.setTimeout(() => {
      setLedgerRetryAt(null);
      if (!mobileAppActive.current) return;
      if (accountTransitionOperation.current !== null) return;
      void requestLedgerPull('retry');
    }, delay);
    return () => window.clearTimeout(timer);
  }, [ledgerRetryAt, requestLedgerPull]);

  // Conflict decisions run through the normal exchange: the cloud has no
  // conflict row for a revision divergence, so the choice becomes a fresh
  // mutation based on the remote revision this device already materialized.
  const resolveSyncConflict = useCallback(
    async (conflictId: string, side: MobileV2ConflictSide) => {
      const record = syncConflicts.find((item) => item.conflictId === conflictId);
      if (!record) {
        setConflictNotice('这条冲突已经不在列表里，刷新一次账本再看。');
        return;
      }
      const checkpoint = await readMobileV2Bootstrap().catch(() => null);
      if (!checkpoint) {
        setConflictNotice('本机还没有同步基线，先配对设备并刷新一次账本。');
        return;
      }
      const resolution = buildMobileV2ConflictResolution({ conflict: record, side, checkpoint });
      if (!resolution.ok) {
        setConflictNotice(resolution.reason);
        return;
      }
      setConflictBusyId(conflictId);
      setConflictNotice('正在把你的选择提交到云端…');
      try {
        // The decision replaces whatever this device had queued for the same
        // entity; keeping the superseded upload would race the choice.
        await supersedeMobileV2PendingMutations(checkpoint, {
          entityType: resolution.mutation.entityType,
          entityId: resolution.mutation.entityId,
          keepOpId: resolution.opId,
        }).catch(() => 0);
        await enqueueMobileV2Mutation(resolution.mutation, checkpoint);
        await requestLedgerPull('manual');
        const history = (await readMobileV2OperationHistory().catch(() => [])) as Array<{
          opId?: unknown;
          status?: unknown;
          errorCode?: unknown;
        }>;
        const entry = history.find((item) => item.opId === resolution.opId);
        setConflictNotice(
          describeMobileV2ConflictResolution(
            normalizeMobileV2ConflictResolutionOutcome(entry?.status),
            typeof entry?.errorCode === 'string' ? entry.errorCode : null,
          ),
        );
        const conflicts = await readMobileV2Conflicts().catch(() => []);
        setSyncConflicts(conflicts);
      } catch (error) {
        setConflictNotice(
          isAbortError(error)
            ? '账号连接在提交过程中变了，这次选择没有提交。'
            : `提交选择失败：${errorMessage(error)}`,
        );
      } finally {
        setConflictBusyId(null);
      }
    },
    [requestLedgerPull, syncConflicts],
  );

  useEffect(() => {
    let cancelled = false;
    void readMobileV2Conflicts()
      .then((records) => {
        if (!cancelled) setSyncConflicts(records);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connectionEpoch, deviceId]);

  useEffect(() => {
    preferencesRef.current = preferences;
    connectionKeyRef.current = mobileAccountConnectionKey(preferences);
    // A non-remembered WebView token lives in sessionStorage and can disappear when
    // Android reclaims the renderer. That must not silently erase the encrypted native
    // connection which still powers an active notification. Explicit token removal and
    // cache reset paths clear the native connection themselves.
  }, [preferences]);

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  useEffect(() => {
    let active = true;
    const generation = ledgerGeneration.current;
    const taskCacheGeneration = taskRequests.generation();
    const cachePreferences = preferencesRef.current;
    const cacheAccountId = mobileAccountId(cachePreferences);
    const cacheConnectionKey = mobileAccountConnectionKey(cachePreferences);
    const cacheConnectionConfigured = Boolean(
      cachePreferences.endpoint && cachePreferences.token && cacheAccountId,
    );
    void Promise.all([
      readMobileCache(),
      readCachedLiveFocusSnapshot(cacheAccountId),
      readCachedTaskSnapshot(cacheAccountId),
      readCachedTaskSnapshotConfirmedAt(cacheAccountId),
      readOfflineFocusRuntime(),
      readPendingDeviceSyncBundles(),
      readMobileV2Bootstrap(),
      readMobileV2Status(deviceId),
    ])
      .then(
        ([
          storedLedger,
          cachedLive,
          cachedTasks,
          cachedTaskConfirmedAt,
          savedOfflineRuntime,
          pendingUploads,
          checkpoint,
          v2Status,
        ]) => {
          if (
            !active ||
            ledgerGeneration.current !== generation ||
            connectionKeyRef.current !== cacheConnectionKey
          ) {
            return;
          }
          const ledger =
            !cacheConnectionConfigured || checkpoint?.boundAccountId === cacheAccountId
              ? storedLedger
              : EMPTY_CACHE;
          const currentV2Status =
            cacheConnectionConfigured &&
            checkpoint?.boundAccountId === cacheAccountId &&
            checkpoint.boundDeviceId === deviceId
              ? v2Status
              : null;
          const cachedPresentation = presentMobileLedgerSync({
            uploaded: 0,
            downloaded: 0,
            bundleCount: ledger.bundles.length,
            outstandingCount: countOutstandingLedgerEntities(
              pendingUploads,
              currentV2Status?.outstandingEntityIds ?? [],
              deviceId,
            ),
            conflicts: currentV2Status?.conflicts ?? 0,
            unresolvedConflicts: currentV2Status?.conflicts ?? 0,
            rejected: currentV2Status?.rejected ?? 0,
          });
          void updateNativeAuthorityProjectionHistory({
            deviceId,
            connectionLease: nativeConnectionLease,
            records: ledger.bundles,
            lastVerifiedAt: currentV2Status?.lastVerifiedAt ?? null,
            lastAttemptAt: ledger.lastSyncAt ?? 0,
            pendingCount: cachedPresentation.pendingCount,
            lastErrorCode: currentV2Status?.lastErrorCode ?? cachedPresentation.lastErrorCode,
          }).catch(() => false);
          cacheRef.current = ledger;
          setCache(ledger);
          const restoredLive = savedOfflineRuntime
            ? offlineRuntimeSnapshot(savedOfflineRuntime, deviceId)
            : restoreCachedLiveSnapshot(cachedLive, cacheConnectionConfigured);
          if (savedOfflineRuntime) {
            offlineRuntimeRef.current = savedOfflineRuntime;
            setOfflineRuntime(savedOfflineRuntime);
            void readLocalSessionSyncMeta(savedOfflineRuntime.id).then((meta) => {
              const mode = meta?.authorityMode ?? 'local-offline';
              authorityModeRef.current = mode;
              setAuthorityMode(mode);
            });
            setLiveSnapshotSource('local');
          }
          if (restoredLive) {
            liveSnapshotRef.current = restoredLive;
            setLiveSnapshot(restoredLive);
            if (!savedOfflineRuntime) setLiveSnapshotSource('cache');
          }
          setPendingUploadCount(cachedPresentation.pendingCount);
          setLedgerRejectedCount(currentV2Status?.rejected ?? 0);
          // 离线冷启动时 refresh 已尝试过并失败（generation 已推进），
          // 只要当前还没有任何快照，就必须让缓存顶上，否则任务页会显示「还没有任务」。
          if (
            cachedTasks &&
            cacheConnectionConfigured &&
            (taskRequests.generation() === taskCacheGeneration || taskSnapshotRef.current === null)
          ) {
            taskSnapshotRef.current = cachedTasks;
            setTaskSnapshot(cachedTasks);
            setTaskConfirmedAt(cachedTaskConfirmedAt);
          }
          if (cachedPresentation.pullState === 'partial') {
            setPullState('partial');
            setLedgerNotice(cachedPresentation.notice);
          } else {
            setLedgerNotice(
              ledger.bundles.length > 0
                ? `已从本机缓存载入 ${ledger.bundles.length} 场会话`
                : '本机还没有已结束会话',
            );
          }
        },
      )
      .catch((error: unknown) => {
        if (!active) return;
        setPullState('error');
        setLedgerNotice(`无法读取本机缓存：${errorMessage(error)}`);
      })
      .finally(() => {
        if (active) setCacheReady(true);
      });
    return () => {
      active = false;
      ledgerGeneration.current += 1;
      liveGeneration.current += 1;
      taskRequests.invalidate();
      ledgerRequest.current?.abort();
      liveRequest.current?.abort();
    };
  }, [deviceId, nativeConnectionLease, preferences.endpoint, preferences.token, taskRequests]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let removeAppStateListener: (() => Promise<void>) | null = null;
    const applyLifecycle = () => {
      if (disposed) return;
      setAppActive(mobileAppActive.current);
      setDocumentVisible(document.visibilityState === 'visible');
      const action = resolveMobileLiveLifecycleAction({
        appActive: mobileAppActive.current,
        documentVisible: document.visibilityState === 'visible',
        online: navigator.onLine,
        configured: Boolean(preferencesRef.current.endpoint && preferencesRef.current.token),
      });
      if (action === 'suspend') {
        // The next visible event must replace this aborted loop even when OEM lifecycle events
        // arrive less than a second apart; the timestamp only deduplicates active-side events.
        lastResumeRefreshAt.current = 0;
        liveRequest.current?.abort();
        // Commands in flight are cancelled with the connection. Their rows stay
        // durable in the native store and drain on the next visible resume.
        nativeCommandAbort.current?.abort();
        nativeCommandAbort.current = null;
        return;
      }
      if (action === 'wait') {
        if (!navigator.onLine) setOnline(false);
        return;
      }
      const now = Date.now();
      if (now - lastResumeRefreshAt.current < 1_000) return;
      lastResumeRefreshAt.current = now;
      setOnline(true);
      setConnectionEpoch((value) => value + 1);
    };
    const handleVisibilityChange = () => applyLifecycle();
    const reconnectAfterPageShow = () => applyLifecycle();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', reconnectAfterPageShow);
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      mobileAppActive.current = isActive;
      applyLifecycle();
    }).then((handle) => {
      if (disposed) void handle.remove();
      else removeAppStateListener = () => handle.remove();
    });
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', reconnectAfterPageShow);
      if (removeAppStateListener) void removeAppStateListener();
    };
  }, []);

  useEffect(() => {
    if (!cacheReady || !online || !preferences.endpoint || !preferences.token) return;
    void requestLedgerPull('foreground');
    void refreshTasks(preferences);
  }, [cacheReady, connectionEpoch, online, preferences, requestLedgerPull, refreshTasks]);

  useEffect(() => {
    if (!cacheReady || !online || !preferences.endpoint || !preferences.token) return;
    const refreshVisibleTasks = () => {
      if (document.visibilityState === 'visible') void refreshTasks(preferencesRef.current);
    };
    // Task snapshots poll while the user is watching and not at all once the app goes behind
    // another app; the next foreground transition refreshes before the first tick. The delay
    // starts at 5 s and widens while the cloud register keeps answering "unchanged", so an idle
    // screen stops paying a round trip every 5 s.
    if (foregroundActive) taskSnapshotCadence.current.unchangedStreak = 0;
    const stopInterval = foregroundActive
      ? startVisibleTaskSnapshotRefresh(
          () => void refreshTasks(preferencesRef.current),
          () => mobileAppActive.current && document.visibilityState === 'visible',
          {
            delayMs: () =>
              nextMobileTaskSnapshotDelayMs(taskSnapshotCadence.current.unchangedStreak),
          },
        )
      : () => undefined;
    document.addEventListener('visibilitychange', refreshVisibleTasks);
    window.addEventListener('focus', refreshVisibleTasks);
    window.addEventListener('pageshow', refreshVisibleTasks);
    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', refreshVisibleTasks);
      window.removeEventListener('focus', refreshVisibleTasks);
      window.removeEventListener('pageshow', refreshVisibleTasks);
    };
  }, [cacheReady, online, preferences.endpoint, preferences.token, refreshTasks, foregroundActive]);

  useEffect(() => {
    liveRequest.current?.abort();
    const configured = Boolean(preferences.endpoint && preferences.token);
    if (!configured) {
      setConnectionState('unconfigured');
      setLiveConnectionNotice(null);
      const localRuntime = offlineRuntimeRef.current;
      if (localRuntime) {
        const localSnapshot = offlineRuntimeSnapshot(localRuntime, deviceId);
        liveSnapshotRef.current = localSnapshot;
        setLiveSnapshot(localSnapshot);
        setLiveSnapshotSource('local');
        const localMode =
          authorityModeRef.current === 'forked-local' ? 'forked-local' : 'local-offline';
        authorityModeRef.current = localMode;
        setAuthorityMode(localMode);
      } else {
        liveSnapshotRef.current = null;
        setLiveSnapshot(null);
        setLiveSnapshotSource('none');
        void enqueueMutation(cacheMutationQueue, clearCachedLiveFocusSnapshot);
      }
      return;
    }
    if (!online) {
      if (offlineRuntimeRef.current) {
        const offlineMode =
          authorityModeRef.current === 'forked-local' ? 'forked-local' : 'local-offline';
        authorityModeRef.current = offlineMode;
        setAuthorityMode(offlineMode);
      }
      setConnectionState('offline');
      setLiveConnectionNotice(null);
      return;
    }
    if (
      resolveMobileLiveLifecycleAction({
        appActive: mobileAppActive.current,
        documentVisible: document.visibilityState === 'visible',
        online,
        configured,
      }) !== 'reconnect'
    ) {
      return;
    }

    const controller = new AbortController();
    const generation = liveGeneration.current + 1;
    liveGeneration.current = generation;
    liveRequest.current = controller;
    let lastRevision: number | null = null;
    let retryDelay = 750;

    const isCurrent = () =>
      liveGeneration.current === generation &&
      liveRequest.current === controller &&
      !controller.signal.aborted;

    const run = async () => {
      if (offlineRuntimeRef.current) {
        authorityModeRef.current = 'reconnecting';
        setAuthorityMode('reconnecting');
      }
      setLiveConnectionNotice(null);
      setConnectionState('connecting');
      while (isCurrent()) {
        try {
          const response =
            lastRevision === null
              ? await fetchLiveFocusSnapshot({
                  endpoint: preferences.endpoint,
                  token: preferences.token,
                  signal: controller.signal,
                })
              : await waitForLiveFocusSnapshot({
                  endpoint: preferences.endpoint,
                  token: preferences.token,
                  afterRevision: lastRevision,
                  signal: controller.signal,
                });
          if (!isCurrent()) return;
          const mapped = await commitLiveSnapshot(
            response,
            mobileAccountConnectionKey(preferences),
          );
          if (!isCurrent()) return;
          if (!mapped) return;
          lastRevision = response.snapshot.revision;
          setConnectionState('live');
          setLiveConnectionNotice(null);
          retryDelay = 750;
        } catch (error) {
          if (!isCurrent() || isAbortError(error)) return;
          const failure = classifyMobileLiveRequestError(error);
          setConnectionState(navigator.onLine ? 'error' : 'offline');
          setLiveConnectionNotice(
            failure.retryable ? `${failure.message}；正在自动重连` : failure.message,
          );
          if (!failure.retryable) return;
          try {
            await abortableDelay(retryDelay, controller.signal);
          } catch {
            return;
          }
          retryDelay = Math.min(retryDelay * 2, 15_000);
          lastRevision = null;
          if (isCurrent()) setConnectionState('connecting');
        }
      }
    };

    void run();
    return () => {
      controller.abort();
      if (liveRequest.current === controller) liveRequest.current = null;
    };
  }, [
    commitLiveSnapshot,
    connectionEpoch,
    deviceId,
    offlineRuntime,
    online,
    preferences,
    setConnectionState,
  ]);

  useEffect(() => {
    const snapshot = liveSnapshot ?? makeIdleSnapshot();
    const push = () => {
      void updateNativeFocusSnapshot(
        snapshot,
        deviceId,
        nativeConnectionLease,
        liveConnection === 'live' && offlineRuntime === null,
        Date.now(),
        offlineRuntime !== null,
      ).catch(() => {
        // Native controls are optional; Web/PWA live sync remains usable if the bridge is absent.
      });
    };
    push();
    // 原生侧 validUntil 只有 30 分钟：会话进行中每 60 秒补推一次，
    // 否则前台通知会被判定过期而不再展示，超级岛也随之消失。
    const heartbeat = window.setInterval(push, 60_000);
    return () => window.clearInterval(heartbeat);
  }, [deviceId, liveConnection, liveSnapshot, nativeConnectionLease, offlineRuntime]);

  const refreshNativeDisplayStatus = useCallback(async () => {
    if (!nativeSystemControls.available) return;
    const status = await readNativeFocusStatus();
    if (!status) return;
    setNativeSystemControls((current) => ({
      ...current,
      immersiveSystemBars: status.immersiveSystemBars === true,
      pictureInPictureSupported: status.pictureInPictureSupported === true,
      pictureInPictureActive: status.pictureInPictureActive === true,
    }));
  }, [nativeSystemControls.available]);

  useEffect(() => {
    if (!nativeSystemControls.available) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshNativeDisplayStatus();
    };
    void refreshNativeDisplayStatus();
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [nativeSystemControls.available, refreshNativeDisplayStatus]);

  useEffect(() => {
    const active = liveSnapshot?.state === 'running' || liveSnapshot?.state === 'paused';
    if (active || !nativeSystemControls.immersiveSystemBars) return;
    void setNativeImmersiveSystemBars(false)
      .then(() => {
        setNativeSystemControls((current) => ({ ...current, immersiveSystemBars: false }));
      })
      .catch(() => {
        // The next foreground status refresh reconciles native display state.
      });
  }, [liveSnapshot?.state, nativeSystemControls.immersiveSystemBars]);

  const processNativeQueue = useCallback(async () => {
    if (nativeQueueRunning.current) return;
    if (
      !shouldDrainNativeCommands({
        appActive: mobileAppActive.current,
        documentVisible: document.visibilityState === 'visible',
        liveConnection: liveConnectionRef.current === 'live',
        offlineRuntime: offlineRuntimeRef.current !== null,
      })
    ) {
      return;
    }
    nativeQueueRunning.current = true;
    const sourceNativeLease = nativeConnectionLease;
    const controller = new AbortController();
    nativeCommandAbort.current = controller;
    const signal = controller.signal;
    let finishedLedgerCommand = false;
    try {
      const commands = await drainNativeFocusCommands(deviceId, sourceNativeLease);
      for (const nativeCommand of commands) {
        if (signal.aborted) break;
        const connection = preferencesRef.current;
        if (!connection.endpoint || !connection.token || liveConnectionRef.current !== 'live') {
          break;
        }
        try {
          const sourceConnectionKey = mobileAccountConnectionKey(connection);
          const response = await sendNativeCommand(connection, deviceId, nativeCommand, signal);
          // Suspending, switching accounts or clearing the pairing while the
          // command was in flight must not commit its snapshot or clear its
          // durable native row.
          if (signal.aborted) break;
          const committed = await commitLiveSnapshot(response, sourceConnectionKey);
          if (!committed || connectionKeyRef.current !== sourceConnectionKey) break;
          if (signal.aborted) break;
          if (
            response.ack.status === 'applied' ||
            response.ack.status === 'duplicate' ||
            response.ack.status === 'conflict' ||
            response.ack.status === 'rejected'
          ) {
            if (nativeConnectionLeaseRef.current !== sourceNativeLease) break;
            await completeNativeFocusCommands([nativeCommand.id], deviceId, sourceNativeLease);
          }
          if (response.ack.status === 'applied' || response.ack.status === 'duplicate') {
            setCommandNotice(
              nativeCommandAckNotice(
                nativeCommand.source,
                nativeCommand.type,
                nativeCommand.stateRevision,
                response,
              ),
            );
            if (nativeCommand.type === 'finish') finishedLedgerCommand = true;
          } else {
            setCommandNotice(
              nativeCommandAckNotice(
                nativeCommand.source,
                nativeCommand.type,
                nativeCommand.stateRevision,
                response,
              ),
            );
          }
        } catch (error) {
          if (!isAbortError(error) && !signal.aborted) {
            setCommandNotice(`${errorMessage(error)}；系统动作已保留，将自动重试`);
          }
          break;
        }
      }
    } catch (error) {
      if (!isAbortError(error)) {
        setCommandNotice(`无法读取系统快捷动作：${errorMessage(error)}；将自动重试`);
      }
    } finally {
      nativeQueueRunning.current = false;
      if (nativeCommandAbort.current === controller) nativeCommandAbort.current = null;
    }
    // One ledger pull per drained batch instead of one per finished command.
    if (finishedLedgerCommand && !signal.aborted) void requestLedgerPull('command');
  }, [commitLiveSnapshot, deviceId, nativeConnectionLease, requestLedgerPull]);

  useEffect(() => {
    if (liveConnection !== 'live') return;
    let disposed = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    void subscribeToNativeFocusCommands(() => {
      if (!disposed) void processNativeQueue();
    })
      .then((remove) => {
        if (disposed) void remove();
        else unsubscribe = remove;
      })
      .catch(() => {
        // The persisted queue and foreground/interval checks remain the delivery fallback.
      });
    const processWhenForegrounded = () => {
      if (!disposed && document.visibilityState === 'visible') void processNativeQueue();
    };
    if (foregroundActive) void processNativeQueue();
    // A backgrounded app keeps its queued commands durable in the native store;
    // polling it every 5 s while invisible is pure battery cost. The interval only
    // exists while the console is in front; the durable queue drains on resume.
    const interval = foregroundActive
      ? window.setInterval(() => {
          if (mobileAppActive.current && document.visibilityState === 'visible') {
            void processNativeQueue();
          }
        }, 5_000)
      : 0;
    document.addEventListener('visibilitychange', processWhenForegrounded);
    window.addEventListener('focus', processWhenForegrounded);
    window.addEventListener('pageshow', processWhenForegrounded);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', processWhenForegrounded);
      window.removeEventListener('focus', processWhenForegrounded);
      window.removeEventListener('pageshow', processWhenForegrounded);
      if (unsubscribe) void unsubscribe();
    };
  }, [liveConnection, processNativeQueue, foregroundActive]);

  const handleCommand = useCallback(
    async (action: MobileFocusCommand, taskOverride?: SyncedTask, titleOverride?: string) => {
      if (!cacheReady) {
        setCommandNotice('正在恢复本机记录，请稍候');
        return;
      }
      if (pendingCommandRef.current) return;
      const snapshot = liveSnapshotRef.current ?? makeIdleSnapshot();
      const connection = preferencesRef.current;
      const sourceConnectionKey = mobileAccountConnectionKey(connection);
      const sourceNativeLease = nativeConnectionLeaseRef.current;
      if (action !== 'start' && !snapshot.sessionId && !offlineRuntimeRef.current) {
        setCommandNotice('当前没有可控制的活动会话');
        return;
      }

      const selectedTask =
        taskOverride ??
        taskSnapshot?.snapshot?.tasks.find((task) => task.id === selectedTaskId) ??
        localTaskCreates.filter((task) => task.id === selectedTaskId).map(localTaskFromCreate)[0];
      const title =
        (titleOverride ?? titleDraft).trim() || selectedTask?.title.trim() || '自由专注';
      const canStartOffline =
        action === 'start' &&
        !offlineRuntimeRef.current &&
        (liveConnectionRef.current !== 'live' ||
          localTaskCreates.some((task) => task.id === selectedTask?.id));
      if (offlineRuntimeRef.current || canStartOffline) {
        pendingCommandRef.current = action;
        setPendingCommand(action);
        setCommandNotice(null);
        try {
          const now = Date.now();
          let nextRuntime: OfflineFocusRuntime | null = offlineRuntimeRef.current;
          if (action === 'start') {
            nextRuntime = startOfflineFocus({
              id: `mobile_${crypto.randomUUID()}`,
              segmentId: `segment_${crypto.randomUUID()}`,
              title,
              task: selectedTask ?? null,
              now,
            });
            const meta: LocalSessionSyncMeta = {
              sessionId: nextRuntime.id,
              authorityMode: 'local-offline',
              originDeviceId: deviceId,
              baseCloudRevision: snapshot.revision > 0 ? snapshot.revision : null,
              suspectedRemoteSessionId: snapshot.state === 'idle' ? null : snapshot.sessionId,
              detectedRemoteRevision: snapshot.state === 'idle' ? null : snapshot.revision,
              detectedAt: snapshot.state === 'idle' ? null : now,
            };
            await createOfflineFocusRuntime(nextRuntime, meta);
            authorityModeRef.current = 'local-offline';
            setAuthorityMode('local-offline');
            setTitleDraft('');
            setSelectedTaskId('');
            setCommandNotice('已开始本机离线专注；结束后联网将自动补传');
          } else if (action === 'pause' && nextRuntime) {
            nextRuntime = pauseOfflineFocus(nextRuntime, `pause_${crypto.randomUUID()}`, now);
            await writeOfflineFocusRuntime(nextRuntime);
            setCommandNotice('本机专注已暂停');
          } else if (action === 'resume' && nextRuntime) {
            nextRuntime = resumeOfflineFocus(nextRuntime, now);
            await writeOfflineFocusRuntime(nextRuntime);
            setCommandNotice('本机专注已继续');
          } else if (action === 'finish' && nextRuntime) {
            const bundle = finishOfflineFocus(nextRuntime, now);
            const completion = await persistCompletedOfflineFocus(
              bundle,
              deviceId,
              sourceNativeLease,
            );
            setCommandNotice(offlineCompletionNotice(completion));
            if (!completion.pending) return;
            nextRuntime = null;
            authorityModeRef.current = 'cloud-live';
            setAuthorityMode('cloud-live');
            setPendingUploadCount((count) => count + 1);
          } else {
            throw new Error('本机离线专注状态与操作不匹配');
          }
          offlineRuntimeRef.current = nextRuntime;
          setOfflineRuntime(nextRuntime);
          const nextSnapshot = nextRuntime
            ? offlineRuntimeSnapshot(nextRuntime, deviceId, now)
            : makeIdleSnapshot(snapshot.revision + 1, now, now);
          liveSnapshotRef.current = nextSnapshot;
          setLiveSnapshot(nextSnapshot);
          setLiveSnapshotSource('local');
          if (!nextRuntime && online && connection.endpoint && connection.token) {
            setConnectionEpoch((value) => value + 1);
          }
        } catch (error) {
          setCommandNotice(errorMessage(error));
        } finally {
          pendingCommandRef.current = null;
          setPendingCommand(null);
        }
        return;
      }

      if (liveConnectionRef.current !== 'live' || !connection.endpoint || !connection.token) {
        setCommandNotice(
          snapshot.state === 'idle'
            ? '尚未取得“云端空闲”的最后确认，暂不能安全开启离线计时'
            : '最后确认仍有活动会话，为避免双重计时已锁定控制',
        );
        return;
      }

      const command = makeUiCommand(action, snapshot, title, selectedTask);
      const request = commandRequests.issue(sourceConnectionKey);
      pendingCommandRef.current = action;
      setPendingCommand(action);
      setCommandNotice(null);
      try {
        const response = await sendLiveFocusCommand({
          endpoint: connection.endpoint,
          token: connection.token,
          deviceId,
          command,
          signal: request.signal,
        });
        if (!request.isCurrent() || connectionKeyRef.current !== sourceConnectionKey) return;
        const committed = await commitLiveSnapshot(response, sourceConnectionKey);
        if (
          !committed ||
          !request.isCurrent() ||
          connectionKeyRef.current !== sourceConnectionKey
        ) {
          return;
        }
        setCommandNotice(commandAckNotice(action, command.expectedRevision, response));
        if (response.ack.status === 'applied' || response.ack.status === 'duplicate') {
          if (action === 'start') setTitleDraft('');
          if (action === 'start') setSelectedTaskId('');
          if (action === 'finish') void requestLedgerPull('command');
        }
      } catch (error) {
        if (
          request.isCurrent() &&
          connectionKeyRef.current === sourceConnectionKey &&
          !isAbortError(error)
        ) {
          setCommandNotice(errorMessage(error));
        }
      } finally {
        const shouldClear = request.isCurrent() && connectionKeyRef.current === sourceConnectionKey;
        request.finish();
        if (shouldClear) {
          pendingCommandRef.current = null;
          setPendingCommand(null);
        }
      }
    },
    [
      commandRequests,
      cacheReady,
      commitLiveSnapshot,
      deviceId,
      online,
      requestLedgerPull,
      selectedTaskId,
      taskSnapshot,
      localTaskCreates,
      titleDraft,
    ],
  );

  const handleRetry = () => {
    if (!preferences.endpoint || !preferences.token) {
      setConfigOpen(true);
      setCommandNotice('完成设备配对后即可自动同步');
      return;
    }
    // The explicit refresh must never be dropped by the de-duplication policy;
    // joining an in-flight pull is the one case where it does no new work.
    void requestLedgerPull('manual');
    void retryLocalTaskCreates(localTaskScope)
      .then(() => setLocalTaskQueueEpoch((n) => n + 1))
      .catch(() => setCommandNotice('待同步任务仍保留，暂未能重新安排同步'));
    setConnectionEpoch((value) => value + 1);
  };

  const handleToggleImmersiveSystemBars = async () => {
    if (nativeSystemControls.busy !== null) return;
    const enabled = !nativeSystemControls.immersiveSystemBars;
    setNativeSystemControls((current) => ({ ...current, busy: 'immersive' }));
    try {
      const result = await setNativeImmersiveSystemBars(enabled);
      setNativeSystemControls((current) => ({
        ...current,
        immersiveSystemBars: result.supported && result.enabled,
      }));
      if (!result.supported) setCommandNotice('当前系统不支持沉浸显示');
    } catch (error) {
      setCommandNotice(`无法切换沉浸显示：${errorMessage(error)}`);
    } finally {
      setNativeSystemControls((current) => ({ ...current, busy: null }));
    }
  };

  const handleEnterPictureInPicture = async () => {
    if (nativeSystemControls.busy !== null) return;
    setNativeSystemControls((current) => ({ ...current, busy: 'picture-in-picture' }));
    try {
      const result = await enterNativePictureInPicture();
      setNativeSystemControls((current) => ({
        ...current,
        pictureInPictureSupported: result.supported,
        pictureInPictureActive: result.active,
      }));
      if (!result.entered) {
        setCommandNotice(result.supported ? '系统未允许进入画中画' : '当前系统不支持画中画');
      }
    } catch (error) {
      setCommandNotice(`无法进入画中画：${errorMessage(error)}`);
    } finally {
      setNativeSystemControls((current) => ({ ...current, busy: null }));
    }
  };

  const handleForgetToken = async () => {
    if (offlineRuntimeRef.current || pendingUploadCount > 0 || localTaskCreates.length > 0) {
      setCommandNotice('还有本机专注或任务未同步，暂不能退出此设备同步');
      return;
    }
    const operation = accountLifecycle.invalidate();
    const operationSignal = accountLifecycle.signal(operation);
    invalidateOwnerAccountBootstrap();
    setAccountLoginPolling(false);
    setAccountBusy(true);
    setCommandNotice('正在从 Android 安全存储移除设备同步凭据…');
    beginAccountTransition(operation);
    try {
      const transition = await runMobileAccountLogout(
        accountLifecycle,
        operation,
        {
          read: () => readNativeFocusConnectionState(operationSignal),
          mutate: (baseline) =>
            clearNativeFocusConnection(baseline.connectionLease, operationSignal),
          async restore(baseline, applied) {
            const restored = await restoreNativeFocusConnectionState(
              baseline,
              applied.connectionLease,
            );
            commitNativeConnectionLease(restored.connectionLease);
          },
        },
        resetAccountScopedState,
      );
      if (!transition.current) return;
      commitNativeConnectionLease(null);
      const next = { ...preferencesRef.current, token: '', rememberToken: false };
      connectionKeyRef.current = mobileAccountConnectionKey(next);
      const accountStateIssues = transition.issues;
      let browserPersistenceFailed = false;
      try {
        clearSavedToken();
        clearMobileAccountProfile();
      } catch {
        browserPersistenceFailed = true;
      }
      preferencesRef.current = next;
      setPreferences(next);
      setAccountProfile(null);
      setPairingOffer(null);
      setPairingCode('');
      pairingAutoGeneratedRef.current = false;
      setConnectionState('unconfigured');
      setConfigOpen(true);
      setCommandNotice(
        browserPersistenceFailed || accountStateIssues.length > 0
          ? '设备同步凭据已移除；本机缓存清理未完全落盘，下次启动会继续隔离旧同步空间'
          : '这台设备已退出同步；本机历史缓存仍保留',
      );
    } catch (error) {
      if (accountLifecycle.isCurrent(operation)) {
        setConnectionEpoch((value) => value + 1);
        setCommandNotice(`退出设备同步失败，原同步连接仍保留：${errorMessage(error)}`);
      }
    } finally {
      finishAccountTransition(operation);
      if (accountLifecycle.isCurrent(operation)) setAccountBusy(false);
    }
  };

  const handleClearCache = async () => {
    if (offlineRuntimeRef.current) {
      setCommandNotice('本机离线专注仍在进行，结束本轮后才能清除缓存');
      return;
    }
    ledgerGeneration.current += 1;
    liveGeneration.current += 1;
    taskRequests.invalidate();
    ledgerRequest.current?.abort();
    liveRequest.current?.abort();
    try {
      await enqueueMutation(cacheMutationQueue, clearMobileCache);
      cacheRef.current = EMPTY_CACHE;
      liveSnapshotRef.current = null;
      setCache(EMPTY_CACHE);
      setLiveSnapshot(null);
      setLiveSnapshotSource('none');
      taskSnapshotRef.current = null;
      setTaskSnapshot(null);
      setTaskConfirmedAt(null);
      setSelectedTaskId('');
      setPullState('idle');
      setLedgerNotice('本机缓存已清除；云端与桌面端数据未受影响');
      setCommandNotice('本机缓存已清除，正在重新确认云端状态');
      setConnectionEpoch((value) => value + 1);
    } catch (error) {
      setCommandNotice(`清理失败：${errorMessage(error)}`);
    }
  };

  const configured = Boolean(preferences.endpoint && preferences.token);
  const displaySnapshot = useMemo(
    () => resolveMobileDisplaySnapshot(offlineRuntime, liveSnapshot, deviceId),
    [offlineRuntime, liveSnapshot, deviceId],
  );
  // The sync chip doubles as the manual-refresh receipt: while a ledger check runs it
  // says so, instead of looking like the tap did nothing until the pull settles.
  const syncActivity = presentMobileSyncActivity({ configured, pullState });
  const activeViewTitle =
    activeView === 'focus'
      ? '专注'
      : activeView === 'tasks'
        ? '任务'
        : activeView === 'history'
          ? '统计'
          : '设置';

  // 非专注页的活动专注条：规范要求 64px、位于导航上方、只显示任务简称 + 当前时间 + 暂停/继续，
  // 没有活动会话时完全移除。计时只在可见时按秒推进，页面不可见时不占帧。
  const [activityNow, setActivityNow] = useState(() => Date.now());
  const activityState = displaySnapshot?.state ?? 'idle';
  const activityActive = activityState === 'running' || activityState === 'paused';
  const activityVisible = activeView !== 'focus' && activityActive;
  useEffect(() => {
    // 顶栏状态点在任何页面都要显示已专注时长，所以只要会话在跑就按秒推进；没有会话时完全不启时器。
    if (!activityActive) return undefined;
    setActivityNow(Date.now());
    const timer = window.setInterval(() => setActivityNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activityActive]);
  const liveActivity = useMemo(() => {
    if (!activityVisible || !displaySnapshot) return null;
    const durations = projectLiveFocusDurations(displaySnapshot, activityNow);
    const title = displaySnapshot.title?.trim() || displaySnapshot.taskTitle?.trim() || '自由专注';
    return { state: activityState, title, elapsedMs: durations.primaryElapsedMs };
  }, [activityState, activityNow, activityVisible, displaySnapshot]);
  // 顶栏只保留一个状态点：运行/暂停时显示已专注时长 + 状态词，空闲时显示同步状态。
  const sessionChip = useMemo(() => {
    if (!activityActive || !displaySnapshot) return null;
    const durations = projectLiveFocusDurations(displaySnapshot, activityNow);
    return {
      state: activityState,
      elapsed: formatClockDuration(durations.primaryElapsedMs),
      label: activityState === 'paused' ? '已暂停' : '专注中',
    };
  }, [activityActive, activityNow, activityState, displaySnapshot]);

  return (
    <div className={`mobile-shell view-${activeView}${liveActivity ? ' has-live-activity' : ''}`}>
      <header className="mobile-topbar">
        <div className="brand-lockup">
          <BrandMark />
          {/* 版本号与 commit 是排查问题时才需要的信息，不该常驻在产品标题旁边。
              已移到设置页的「关于」里，那里才是找它的地方。 */}
          <div className="mobile-title-copy">
            <p className="eyebrow">FOCUSLINK</p>
            <div className="brand-title-line">
              <h1>{activeViewTitle}</h1>
            </div>
          </div>
        </div>
        <div className="mobile-topbar-actions">
          <button
            className={`mobile-sync-pill state-${configured ? liveConnection : 'local'}`}
            type="button"
            onClick={configured ? handleRetry : () => setConfigOpen(true)}
            disabled={configured && (pullState === 'pulling' || liveConnection === 'connecting')}
            title={
              configured
                ? (liveConnectionNotice ?? connectionTitle(liveConnection))
                : '本机模式；点击打开多端同步'
            }
            aria-label={
              sessionChip
                ? `本次专注 ${sessionChip.elapsed}，${sessionChip.label}；点击打开本机与同步状态`
                : configured
                  ? `多端同步：${syncActivity.detail ?? connectionTitle(liveConnection)}，点击刷新`
                  : '当前为本机模式，点击打开多端同步'
            }
          >
            <span
              className={`network-dot ${sessionChip || online ? 'online' : 'offline'}`}
              aria-hidden="true"
            />
            {sessionChip ? (
              <>
                <span className="mobile-sync-pill-time">{sessionChip.elapsed}</span>
                <span className="mobile-sync-pill-state">{sessionChip.label}</span>
              </>
            ) : (
              <span>
                {configured ? (syncActivity.label ?? connectionTitle(liveConnection)) : '本机'}
              </span>
            )}
          </button>
          {/* 顶栏只保留同步状态。设置已有底部导航第四个入口，再放一个齿轮会重复且抢走焦点。 */}
        </div>
      </header>

      <div className="app-frame">
        {liveActivity && (
          <div className="live-activity-bar" role="status" aria-live="polite">
            <span className={`live-activity-dot state-${liveActivity.state}`} aria-hidden="true" />
            <span className="live-activity-label">{liveActivity.title}</span>
            <span className="live-activity-time">
              {formatClockDuration(liveActivity.elapsedMs)}
            </span>
            <button
              type="button"
              disabled={pendingCommand !== null}
              onClick={() =>
                void handleCommand(liveActivity.state === 'paused' ? 'resume' : 'pause')
              }
            >
              {liveActivity.state === 'paused' ? '继续' : '暂停'}
            </button>
          </div>
        )}
        <AppNavigation activeView={activeView} onChange={setActiveView} />
        <main className="mobile-main">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className="mobile-workspace"
              key={activeView}
              variants={
                reduceMotion
                  ? { initial: { opacity: 1 }, enter: { opacity: 1 }, exit: { opacity: 1 } }
                  : {
                      initial: { opacity: 0, y: 8 },
                      // 页面交接 320ms（规范 4.2：页面/面板 320–420ms），入场用 expo-out 前置曲线，
                      // 截图驱动等待约 80ms 时已完成绝大部分位移；退出近乎瞬时，保证新视图立即挂载。
                      enter: {
                        opacity: 1,
                        y: 0,
                        transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
                      },
                      exit: { opacity: 0, transition: { duration: 0.01 } },
                    }
              }
              initial="initial"
              animate="enter"
              exit="exit"
            >
              {activeView === 'focus' && (
                <FocusConsole
                  snapshot={displaySnapshot}
                  connection={liveConnection}
                  connectionNotice={liveConnectionNotice}
                  titleDraft={titleDraft}
                  pendingCommand={pendingCommand}
                  commandNotice={commandNotice}
                  localDeviceId={deviceId}
                  tasks={visibleTaskSnapshot.snapshot?.tasks ?? []}
                  selectedTaskId={selectedTaskId}
                  onTaskChange={(taskId) => {
                    setSelectedTaskId(taskId);
                    const task = visibleTaskSnapshot.snapshot?.tasks.find(
                      (item) => item.id === taskId,
                    );
                    if (task) setTitleDraft(task.title);
                  }}
                  onTitleChange={setTitleDraft}
                  onCommand={(command) => void handleCommand(command)}
                  onOpenConnection={() => setConfigOpen(true)}
                  onOpenTasks={() => setActiveView('tasks')}
                  snapshotSource={liveSnapshotSource}
                  nativeSystemControls={nativeSystemControls}
                  onToggleImmersiveSystemBars={() => void handleToggleImmersiveSystemBars()}
                  onEnterPictureInPicture={() => void handleEnterPictureInPicture()}
                  localOfflineMode={offlineRuntime !== null}
                  authorityMode={authorityMode}
                  allowOfflineStart={offlineRuntime === null && liveConnection !== 'live'}
                  timerStyle={appearance.timerStyle}
                  runtimeReady={cacheReady}
                  appActive={appActive}
                  documentVisible={documentVisible}
                />
              )}
              {activeView === 'tasks' && (
                <TickTickTaskPage
                  tasks={visibleTaskSnapshot.snapshot?.tasks ?? []}
                  projects={visibleTaskSnapshot.snapshot?.projects ?? []}
                  pendingLocalCount={localTaskCreates.length + localTaskCompletions.length}
                  pendingLocalIssue={
                    localTaskCreates.map(localTaskCreateIssue).find(Boolean) ??
                    localTaskCompletions.map(localTaskCompletionIssue).find(Boolean) ??
                    null
                  }
                  publishedAt={taskSnapshot?.snapshot?.publishedAt ?? null}
                  revision={taskSnapshot?.revision ?? 0}
                  selectedTaskId={selectedTaskId}
                  canStart={
                    cacheReady &&
                    pendingCommand === null &&
                    offlineRuntime === null &&
                    (liveConnection !== 'live' || (liveSnapshot?.state ?? 'idle') === 'idle')
                  }
                  onSelect={(task) => {
                    setSelectedTaskId(task.id);
                    setTitleDraft(task.title);
                  }}
                  onStart={(task) => {
                    setSelectedTaskId(task.id);
                    setTitleDraft(task.title);
                    setActiveView('focus');
                    void handleCommand('start', task, task.title);
                  }}
                  onUpdateTask={updateCloudTask}
                  onDeleteTask={deleteCloudTask}
                  onCreate={createCloudTask}
                  onCreateProject={createCloudProject}
                  onUpdateProject={updateCloudProject}
                  onDeleteProject={deleteCloudProject}
                  onMoveTask={moveCloudTask}
                  completionStates={taskCompletionStates}
                  onToggleComplete={async (task, completed) => {
                    if (localTaskCreates.some((record) => record.id === task.id)) {
                      throw new Error('这条任务还没同步到云端，联网确认后才能勾选');
                    }
                    await setCloudTaskCompleted(task, completed);
                  }}
                />
              )}
              {activeView === 'history' && (
                <DashboardView
                  records={cache.bundles}
                  ready={cacheReady}
                  configured={configured}
                  lastSyncAt={cache.lastSyncAt}
                  cursor={cache.cursor}
                  tasks={taskSnapshot?.snapshot?.tasks ?? null}
                  onStartFocus={() => setActiveView('focus')}
                />
              )}
              {activeView === 'settings' && (
                <SettingsView
                  connection={liveConnection}
                  online={online}
                  accountLabel={accountProfile?.accountLabel ?? null}
                  authenticated={configured}
                  lastSyncAt={cache.lastSyncAt}
                  pullState={pullState}
                  ledgerNotice={ledgerNotice}
                  taskCount={taskSnapshot?.snapshot?.tasks.length ?? 0}
                  taskRevision={taskSnapshot?.revision ?? 0}
                  taskConfirmedAt={taskConfirmedAt}
                  ledgerPendingCount={pendingUploadCount}
                  ledgerRejectedCount={ledgerRejectedCount}
                  ledgerCount={cache.bundles.length}
                  onOpenAccount={() => setConfigOpen(true)}
                  appearance={appearance}
                  onAppearanceChange={setAppearance}
                  conflicts={presentMobileV2Conflicts(syncConflicts)}
                  conflictBusyId={conflictBusyId}
                  conflictNotice={conflictNotice}
                  retryNotice={
                    ledgerRetryAt === null
                      ? null
                      : describeMobileV2RetryWait(Math.max(1_000, ledgerRetryAt - Date.now()))
                  }
                  onResolveConflict={(conflictId, side) =>
                    void resolveSyncConflict(conflictId, side)
                  }
                  foregroundActive={foregroundActive}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>
        {configOpen && (
          <ConnectionSheet
            authenticated={configured}
            connection={liveConnection}
            online={online}
            lastSyncAt={cache.lastSyncAt}
            accountLabel={accountProfile?.accountLabel ?? null}
            busy={accountBusy || pullState === 'pulling' || liveConnection === 'connecting'}
            notice={commandNotice}
            pairingCode={pairingCode}
            pairingOffer={pairingOffer}
            devices={managedDevices}
            currentDeviceId={deviceId}
            onClose={() => setConfigOpen(false)}
            onPairingCodeChange={(value) => setPairingCode(normalizePairingCodeInput(value))}
            onPair={(value) => void redeemPairingCode(value)}
            onCreatePairingCode={() => void createPairingCode()}
            onRevokeDevice={(deviceIdToRevoke) => void revokeManagedDevice(deviceIdToRevoke)}
            onLogout={handleForgetToken}
            onClearCache={() => setClearCacheDialogOpen(true)}
          />
        )}
      </AnimatePresence>
      <MobileConfirmDialog
        open={clearCacheDialogOpen}
        title="清除本机缓存？"
        description="只删除这台设备缓存的已结束账本与实时快照；待补传的离线会话、云端和电脑端记录都不会删除。"
        confirmLabel="清除缓存"
        danger
        onCancel={() => setClearCacheDialogOpen(false)}
        onConfirm={() => {
          setClearCacheDialogOpen(false);
          void handleClearCache();
        }}
      />
    </div>
  );
}

function mapLiveSnapshot(
  response: LiveFocusSnapshotResponse,
  observedAt: number,
): LiveFocusSnapshotLike {
  const { snapshot, serverTime } = response;
  if (!snapshot.session) {
    return makeIdleSnapshot(snapshot.revision, serverTime, observedAt);
  }
  const session = snapshot.session;
  return {
    state: session.state,
    revision: snapshot.revision,
    sessionId: session.id,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    serverTime,
    observedAt,
    activeElapsedMs: session.activeElapsedMs,
    pauseElapsedMs: session.pauseElapsedMs,
    wallElapsedMs: session.wallElapsedMs,
    currentStateStartedAt:
      session.state === 'paused' ? session.currentPauseStartedAt : session.updatedAt,
    segments: session.segments.map((segment) => ({ ...segment })),
    pauses: session.pauses.map((pause) => ({ ...pause })),
    title: session.title,
    ownerDeviceId: session.lastCommandDeviceId,
    taskId: session.task?.taskId ?? null,
    taskSource: session.task?.taskSource ?? null,
    taskTitle: session.task?.taskTitle ?? null,
  };
}

function makeUiCommand(
  action: MobileFocusCommand,
  snapshot: LiveFocusSnapshotLike,
  title: string,
  task?: SyncedTask,
): LiveFocusCommand {
  const commandId = `command_${crypto.randomUUID()}`;
  if (action === 'start') {
    return {
      commandId,
      action,
      expectedRevision: snapshot.revision,
      sessionId: `live_${crypto.randomUUID()}`,
      title,
      task: task ? { taskId: task.id, taskSource: task.source, taskTitle: task.title } : null,
    };
  }
  return {
    commandId,
    action,
    expectedRevision: snapshot.revision,
    sessionId: snapshot.sessionId ?? '',
  };
}

async function sendNativeCommand(
  connection: MobileConnectionPreferences,
  deviceId: string,
  nativeCommand: NativeFocusCommand,
  signal: AbortSignal,
) {
  return sendLiveFocusCommand({
    endpoint: connection.endpoint,
    token: connection.token,
    deviceId,
    command: {
      commandId: nativeCommand.id,
      action: nativeCommand.type,
      expectedRevision: nativeCommand.stateRevision,
      sessionId: nativeCommand.sessionId,
    },
    signal,
  });
}

function mobileAccountId(connection: MobileConnectionPreferences): string | null {
  return parseDeviceToken(connection.token.trim())?.accountPublicId ?? null;
}

function enqueueMutation(
  queue: { current: Promise<void> },
  operation: () => Promise<void>,
): Promise<void> {
  const queued = queue.current.then(operation);
  queue.current = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function connectionTitle(state: LiveConnectionState): string {
  if (state === 'live') return '实时状态已连接';
  if (state === 'connecting') return '连接中 · 本机可用';
  if (state === 'offline') return '未连接 · 本机专注可用';
  if (state === 'error') return '未连接';
  return '尚未配对设备';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  if (error instanceof SyncV2ClientError) return syncV2ErrorMessage(error.code);
  return error instanceof Error ? error.message : String(error);
}

function syncV2ErrorMessage(code: SyncV2ClientErrorCode): string {
  if (code === 'authentication_failed') return '设备凭据已失效，请重新配对';
  if (code === 'authorization_failed') return '当前设备没有账本同步权限';
  if (code === 'network_error') return '暂时无法连接云端';
  if (code === 'timeout') return '云端连接超时';
  if (code === 'rate_limited') return '云端暂时限流，稍后自动重试';
  if (code === 'server_error') return '云端暂时不可用，稍后自动重试';
  if (code === 'response_too_large') return '云端账本超过单次同步上限';
  if (code === 'cursor_ahead' || code === 'contract_error') return '云端账本响应异常';
  if (code === 'aborted') return '本次同步已取消';
  return '账本同步暂时失败';
}

function BrandMark() {
  return (
    <svg className="mobile-brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path className="brand-mark-f" d="M5 20V4h12M5 11h9" />
      <path className="brand-mark-l" d="M15 9v11h5" />
      <path className="brand-mark-cross" d="M12 11h3" />
    </svg>
  );
}
