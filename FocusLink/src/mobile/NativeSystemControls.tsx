import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  DEFAULT_NATIVE_PAUSE_REMINDER_DELAY_MINUTES,
  MAX_NATIVE_PAUSE_REMINDER_DELAY_MINUTES,
  MIN_NATIVE_PAUSE_REMINDER_DELAY_MINUTES,
  isNativeFocusRuntimeAvailable,
  openNativeAutoStartSettings,
  openNativeBackgroundSettings,
  openNativeOverlayPermissionSettings,
  readNativeFocusStatus,
  readNativePauseReminderPreference,
  requeueNativeTerminalLedger,
  requestNativeAllPermissions,
  requestNativeNotificationPermission,
  requestNativeQuickSettingsTile,
  setNativeOverlayEnabled,
  setNativePauseReminderPreference,
  waitForNativeFocusRuntimeStartup,
  type NativePauseReminderPreference,
  type NativeAllPermissionsResult,
  type NativeFocusStatus,
  type NativePermissionState,
} from './nativeFocusRuntime';

export interface NativeSystemControlsProps {
  /**
   * Whether the app is actually in front. The settings card re-reads the native runtime
   * only then; a backgrounded app must not wake every 15 s just to repaint a card nobody sees.
   */
  foregroundActive?: boolean;
}

type NativeRowTone = 'ok' | 'warning' | 'danger' | 'neutral';

export function NativeSystemControls({ foregroundActive = true }: NativeSystemControlsProps = {}) {
  const [available, setAvailable] = useState(() => isNativeFocusRuntimeAvailable());
  const [readinessEpoch, setReadinessEpoch] = useState(0);
  const [status, setStatus] = useState<NativeFocusStatus | null>(null);
  const [permissionBatch, setPermissionBatch] = useState<NativeAllPermissionsResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pauseReminder, setPauseReminder] = useState<NativePauseReminderPreference>({
    enabled: true,
    delayMinutes: DEFAULT_NATIVE_PAUSE_REMINDER_DELAY_MINUTES,
  });
  const [busy, setBusy] = useState<
    | 'notification'
    | 'all-permissions'
    | 'tile'
    | 'background'
    | 'autostart'
    | 'overlay'
    | 'pause-reminder'
    | 'terminal-ledger'
    | null
  >(null);

  const refreshStatus = useCallback(async () => {
    const next = await readNativeFocusStatus();
    setStatus(next);
  }, []);

  useEffect(() => {
    if (available) return;
    const controller = new AbortController();
    void waitForNativeFocusRuntimeStartup({ signal: controller.signal }).then((ready) => {
      if (ready) setAvailable(true);
    });
    return () => controller.abort();
  }, [available, readinessEpoch]);

  useEffect(() => {
    if (available) return;
    const retryWhenVisible = () => {
      if (document.visibilityState === 'visible') setReadinessEpoch((value) => value + 1);
    };
    document.addEventListener('visibilitychange', retryWhenVisible);
    window.addEventListener('focus', retryWhenVisible);
    window.addEventListener('pageshow', retryWhenVisible);
    return () => {
      document.removeEventListener('visibilitychange', retryWhenVisible);
      window.removeEventListener('focus', retryWhenVisible);
      window.removeEventListener('pageshow', retryWhenVisible);
    };
  }, [available]);

  useEffect(() => {
    if (!available || !foregroundActive) return;
    let active = true;
    const read = () => {
      void Promise.all([readNativeFocusStatus(), readNativePauseReminderPreference()])
        .then(([nextStatus, nextPauseReminder]) => {
          if (!active) return;
          setStatus(nextStatus);
          if (nextPauseReminder) setPauseReminder(nextPauseReminder);
        })
        .catch(() => {
          // Native capability actions remain available for an explicit retry.
        });
    };
    // The interval exists only while the card is in front. Returning to the foreground
    // re-runs this effect, which reads once before the first tick instead of after it.
    read();
    const interval = window.setInterval(read, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [available, foregroundActive]);

  if (!available) {
    // 浏览器里没有 Android 运行时：不渲染空面板，逐条说明这些能力只在应用内可用。
    return (
      <section className="native-system-controls" aria-label="Android 系统控制">
        <p className="settings-hint">
          通知、悬浮条、华为胶囊、小米系统表面与权限回读由 Android
          应用提供；当前运行在浏览器中，这些能力不可用。
        </p>
        <div className="m-card native-system-card" role="group" aria-label="系统显示能力">
          <NativeRow label="通知控制" value="仅 Android 应用" />
          <NativeRow label="悬浮条" value="仅 Android 应用" />
          <NativeRow label="华为胶囊" value="仅 Android 应用" />
          <NativeRow label="小米系统表面" value="仅 Android 应用" />
          <NativeRow label="权限回读" value="仅 Android 应用" />
        </div>
      </section>
    );
  }

  const permission = status?.notificationPermission ?? null;
  const poll = status?.cloudPoll;
  const terminalLedgerCount = Math.max(0, poll?.terminalLedgerCount ?? 0);
  const activeSnapshot =
    status?.snapshot?.state === 'running' || status?.snapshot?.state === 'paused';
  const pollHealthy =
    !activeSnapshot ||
    (poll?.lastSuccessAtEpochMs != null && Date.now() - poll.lastSuccessAtEpochMs < 70_000);

  const enableNotifications = async () => {
    setBusy('notification');
    setNotice(null);
    try {
      const result = await requestNativeNotificationPermission();
      setNotice(
        result.granted
          ? '通知控制已启用；活动会话可从通知暂停、继续或结束。'
          : result.settingsOpened
            ? '已打开系统通知设置；允许 FocusLink 通知后返回应用即可启用控制。'
            : '通知权限未开启，可稍后在系统设置中授权。',
      );
      await refreshStatus();
    } catch (error) {
      setNotice(`无法启用通知控制：${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const grantAllPermissions = async () => {
    setBusy('all-permissions');
    setNotice(null);
    try {
      const result = await requestNativeAllPermissions();
      if (!result) {
        setNotice('当前运行环境没有 Android 原生权限桥。');
        return;
      }
      setStatus(null);
      setPermissionBatch(result);
      const granted = result.items.filter((item) => item.state === 'granted').length;
      const manual = result.items.filter((item) => item.state === 'manual-required').length;
      setNotice(
        result.rootAvailable
          ? `已逐项执行并回读权限：${granted}/${result.items.length} 项确认，${manual} 项需手动设置。`
          : '没有检测到可用 root；已保留每项真实状态，请按提示打开系统设置。',
      );
      await refreshStatus().catch(() => undefined);
    } catch (error) {
      setNotice(`一键获取权限失败：${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const addQuickSettingsTile = async () => {
    setBusy('tile');
    setNotice(null);
    try {
      const result = await requestNativeQuickSettingsTile();
      setNotice(
        result.added
          ? '已请求添加 FocusLink 快捷设置按钮。'
          : result.manualRequired
            ? '请下拉系统快捷设置，点“编辑”，再把 FocusLink 拖入常用按钮。'
            : '系统没有确认添加；可在快捷设置的“编辑”中手动查找 FocusLink。',
      );
    } catch (error) {
      setNotice(`无法请求快捷设置按钮：${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const openBackgroundSettings = async () => {
    setBusy('background');
    setNotice(null);
    try {
      setNotice(
        (await openNativeBackgroundSettings())
          ? '已打开省电设置；请把 FocusLink 设为“不受限制”或加入允许名单。'
          : '系统没有提供统一入口，请在应用详情的电池设置中允许后台活动。',
      );
    } catch (error) {
      setNotice(`无法打开后台设置：${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const openAutoStartSettings = async () => {
    setBusy('autostart');
    setNotice(null);
    try {
      setNotice(
        (await openNativeAutoStartSettings())
          ? '已打开系统自启动设置；请允许 FocusLink 自启动和关联启动。'
          : '系统没有独立自启动入口，请在 FocusLink 应用详情中手动允许。',
      );
    } catch (error) {
      setNotice(`无法打开自启动设置：${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const enableDesktopTimer = async () => {
    setBusy('overlay');
    setNotice(null);
    try {
      await setNativeOverlayEnabled(true);
      const result = await openNativeOverlayPermissionSettings();
      setNotice(
        result.granted
          ? '可移动悬浮计时已启用；长按后拖动可保存位置。'
          : result.opened
            ? '请允许 FocusLink 显示在其他应用上层；返回后可长按拖动。'
            : '系统没有打开悬浮窗设置，请在应用详情中手动允许。',
      );
      await refreshStatus();
    } catch (error) {
      setNotice(`无法打开桌面计时权限：${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const disableDesktopTimer = async () => {
    setBusy('overlay');
    setNotice(null);
    try {
      await setNativeOverlayEnabled(false);
      setNotice('悬浮计时已关闭；系统常驻通知仍会继续显示。');
      await refreshStatus();
    } catch (error) {
      setNotice(`无法关闭悬浮计时：${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const savePauseReminder = async (next: NativePauseReminderPreference) => {
    if (busy !== null) return;
    setBusy('pause-reminder');
    setNotice(null);
    try {
      const saved = await setNativePauseReminderPreference(next);
      if (saved) setPauseReminder(saved);
      setNotice(
        next.enabled ? `暂停超过 ${next.delayMinutes} 分钟时将提醒继续专注。` : '暂停提醒已关闭。',
      );
    } catch (error) {
      setNotice(`无法保存暂停提醒：${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const requeueTerminalLedger = async () => {
    if (busy !== null) return;
    setBusy('terminal-ledger');
    setNotice(null);
    try {
      const deviceId = status?.nativeConnectionDeviceId;
      const connectionLease = status?.nativeConnectionLease ?? null;
      if (!deviceId || !connectionLease) {
        setNotice('账号连接已变化，请重新打开设置后再试。');
        return;
      }
      const requeued = await requeueNativeTerminalLedger(deviceId, connectionLease);
      setNotice(terminalLedgerRequeueNotice(requeued));
      await refreshStatus();
    } catch (error) {
      setNotice(terminalLedgerRequeueFailureCopy(error));
      await refreshStatus().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  const notificationRowTone: NativeRowTone = status?.canPostNotification ? 'ok' : 'warning';
  const overlayRowTone: NativeRowTone = status?.overlayEnabled
    ? 'ok'
    : status?.overlayPermissionGranted
      ? 'warning'
      : 'neutral';
  const huaweiSurface = huaweiCapsuleStatus(status);
  const xiaomiSurface = xiaomiSurfaceStatus(status);
  const currentSurface = systemSurfaceStatus(status);
  const batteryRowTone: NativeRowTone = status?.batteryOptimizationExempt
    ? 'ok'
    : status?.backgroundRestricted
      ? 'danger'
      : 'warning';

  return (
    <section className="native-system-controls" aria-label="Android 系统控制">
      <p className="settings-hint">
        {permission === 'granted'
          ? '通知权限已开启；下面由你主动启用，不会在启动时自动弹出权限。'
          : '以下能力由你主动启用，不会在启动时自动弹出权限。'}
      </p>

      <div className="m-card native-system-card" role="group" aria-label="系统能力">
        <NativeRow
          label="通知控制"
          value={status?.canPostNotification ? '已开启' : '未开启'}
          tone={notificationRowTone}
        >
          <button
            type="button"
            className="m-text-action"
            aria-label="启用通知控制"
            onClick={() => void enableNotifications()}
            disabled={busy !== null}
          >
            {busy === 'notification' ? '请求中…' : '启用'}
          </button>
        </NativeRow>

        <NativeRow
          label="悬浮条"
          value={
            status?.overlayEnabled
              ? '已开启'
              : status?.overlayPermissionGranted
                ? '已授权 · 未开启'
                : '未授权'
          }
          tone={overlayRowTone}
        >
          <button
            type="button"
            className="m-text-action"
            aria-label="启用可移动悬浮计时"
            onClick={() => void enableDesktopTimer()}
            disabled={busy !== null}
          >
            {busy === 'overlay' ? '正在处理…' : status?.overlayEnabled ? '重新授权' : '启用'}
          </button>
          {status?.overlayEnabled && (
            <button
              type="button"
              className="m-text-action"
              aria-label="关闭悬浮计时"
              onClick={() => void disableDesktopTimer()}
              disabled={busy !== null}
            >
              关闭
            </button>
          )}
        </NativeRow>

        <NativeRow label="华为胶囊" value={huaweiSurface.value} tone={huaweiSurface.tone} />

        <NativeRow label="小米系统表面" value={xiaomiSurface.value} tone={xiaomiSurface.tone} />

        <NativeRow
          label="当前系统展示"
          value={currentSurface.value}
          tone={currentSurface.tone}
          detail={
            status?.overlayPermissionGranted
              ? '悬浮层已授权'
              : status?.overlayPermissionGranted === false
                ? '悬浮层未授权'
                : undefined
          }
        />

        <NativeRow
          label="后台同步"
          value={status?.nativeConnectionConfigured ? '凭据已保存' : '未配对'}
          tone={status?.nativeConnectionConfigured ? 'ok' : 'neutral'}
          detail="配对后启用后台同步"
        />

        <NativeRow
          label="同步轮询"
          value={activeSnapshot ? (pollHealthy ? '正常' : '待恢复') : '无进行中的专注'}
          tone={activeSnapshot ? (pollHealthy ? 'ok' : 'warning') : 'neutral'}
          detail={
            activeSnapshot
              ? `第 ${poll?.attemptCount ?? 0} 轮${
                  pollHealthy
                    ? ''
                    : ` · ${nativeCloudPollErrorCopy(poll?.lastErrorCode ?? poll?.lastError)}`
                }`
              : '回到前台时每 15 秒回读一次'
          }
        />

        {poll?.lastSuccessAtEpochMs ? (
          <NativeRow label="最近确认" value={formatStatusTime(poll.lastSuccessAtEpochMs)} />
        ) : null}

        <TerminalLedgerRepairControl
          count={terminalLedgerCount}
          errorCode={poll?.terminalLedgerErrorCode}
          disabled={busy !== null}
          requeueing={busy === 'terminal-ledger'}
          onRequeue={() => void requeueTerminalLedger()}
        />

        <NativeRow
          label="后台运行"
          value={
            status?.backgroundRestricted
              ? '系统已限制'
              : status?.batteryOptimizationExempt
                ? '省电限制已豁免'
                : '仍受省电限制'
          }
          tone={batteryRowTone}
          detail={status?.backgroundAppOpsAllowed === false ? '后台活动被系统拒绝' : undefined}
        >
          <button
            type="button"
            className="m-text-action"
            aria-label="关闭省电限制"
            onClick={() => void openBackgroundSettings()}
            disabled={busy !== null}
          >
            {busy === 'background' ? '正在打开…' : '关闭省电限制'}
          </button>
        </NativeRow>

        <NativeRow
          label="系统自启动"
          value="需手动确认"
          tone="warning"
          detail="系统不提供自动授权接口"
        >
          <button
            type="button"
            className="m-text-action"
            aria-label="允许系统自启动"
            onClick={() => void openAutoStartSettings()}
            disabled={busy !== null}
          >
            {busy === 'autostart' ? '正在打开…' : '允许系统自启动'}
          </button>
        </NativeRow>

        <NativeRow label="快捷设置" value="按需添加" detail="下拉快捷设置里放一个专注按钮">
          <button
            type="button"
            className="m-text-action"
            aria-label="添加到快捷设置"
            onClick={() => void addQuickSettingsTile()}
            disabled={busy !== null}
          >
            {busy === 'tile' ? '请求中…' : '添加到快捷设置'}
          </button>
        </NativeRow>

        <NativeRow
          label="暂停超时提醒"
          value={pauseReminder.enabled ? `${pauseReminder.delayMinutes} 分钟` : '已关闭'}
          detail="暂停超时后提醒继续专注"
        >
          <span className="native-reminder-controls">
            <label className="native-reminder-switch">
              <input
                type="checkbox"
                checked={pauseReminder.enabled}
                disabled={busy !== null}
                onChange={(event) =>
                  void savePauseReminder({ ...pauseReminder, enabled: event.target.checked })
                }
              />
              <span>{pauseReminder.enabled ? '开启' : '关闭'}</span>
            </label>
            <label className="native-reminder-field">
              <span>上限</span>
              <input
                type="number"
                inputMode="numeric"
                min={MIN_NATIVE_PAUSE_REMINDER_DELAY_MINUTES}
                max={MAX_NATIVE_PAUSE_REMINDER_DELAY_MINUTES}
                value={pauseReminder.delayMinutes}
                disabled={!pauseReminder.enabled || busy !== null}
                onChange={(event) =>
                  setPauseReminder((current) => ({
                    ...current,
                    delayMinutes: Number(event.target.value),
                  }))
                }
                onBlur={() => void savePauseReminder(pauseReminder)}
              />
              <span>分钟</span>
            </label>
          </span>
        </NativeRow>
      </div>

      <PermissionBatchPanel
        status={status}
        batch={permissionBatch}
        busy={busy !== null}
        running={busy === 'all-permissions'}
        onGrant={() => void grantAllPermissions()}
      />

      {notice && (
        <p className="native-system-notice" role="status" aria-live="polite">
          {notice}
        </p>
      )}
    </section>
  );
}

function NativeRow({
  label,
  value,
  tone = 'neutral',
  detail,
  children,
}: {
  label: string;
  value: string;
  tone?: NativeRowTone;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`native-system-row tone-${tone}`}>
      <div className="native-system-row-line">
        <span className="native-system-copy">
          <strong>{label}</strong>
          {detail ? <small>{detail}</small> : null}
        </span>
        <span className="native-system-value">{value}</span>
      </div>
      {children ? <div className="native-system-row-actions">{children}</div> : null}
    </div>
  );
}

function PermissionBatchPanel({
  status,
  batch,
  busy,
  running,
  onGrant,
}: {
  status: NativeFocusStatus | null;
  batch: NativeAllPermissionsResult | null;
  busy: boolean;
  running: boolean;
  onGrant: () => void;
}) {
  const items = presentNativePermissionItems(status, batch);
  const labels: Record<PermissionDisplayItem['id'], string> = {
    notification: '通知控制',
    overlay: '悬浮计时',
    battery: '省电豁免',
    background: '后台运行',
    autostart: '系统自启动',
  };
  return (
    <div className="m-card native-permission-panel" aria-label="权限回读">
      <div className="native-permission-heading">
        <strong>权限回读</strong>
        <small>
          {batch?.rootAvailable
            ? 'root 已确认；可自动项已执行并回读，自启动需手动'
            : '等待 root 检查；系统自启动需手动确认'}
        </small>
      </div>
      <ul className="native-permission-list">
        {items.map((item) => (
          <li key={item.id} className={`native-permission-item state-${item.state}`}>
            <span className="native-permission-label">{labels[item.id]}</span>
            <span className="native-permission-state">{permissionStateLabel(item.state)}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="m-button-secondary native-permission-action"
        onClick={onGrant}
        disabled={busy}
      >
        {running ? '正在逐项获取并验证…' : '一键获取全部权限'}
      </button>
    </div>
  );
}

type PermissionDisplayItem = {
  id: 'notification' | 'overlay' | 'battery' | 'background' | 'autostart';
  state: NativePermissionState;
};

export function presentNativePermissionItems(
  status: NativeFocusStatus | null,
  batch: NativeAllPermissionsResult | null,
): PermissionDisplayItem[] {
  const prior = new Map(batch?.items.map((item) => [item.id, item.state] as const) ?? []);
  const verifiedState = (
    id: PermissionDisplayItem['id'],
    value: boolean | undefined,
  ): NativePermissionState =>
    typeof value === 'boolean'
      ? value
        ? 'granted'
        : 'not-granted'
      : (prior.get(id) ?? 'not-granted');
  return [
    { id: 'notification', state: verifiedState('notification', status?.canPostNotification) },
    { id: 'overlay', state: verifiedState('overlay', status?.overlayPermissionGranted) },
    { id: 'battery', state: verifiedState('battery', status?.batteryOptimizationExempt) },
    { id: 'background', state: verifiedState('background', status?.backgroundAppOpsAllowed) },
    { id: 'autostart', state: 'manual-required' },
  ];
}

function permissionStateLabel(state: NativePermissionState): string {
  if (state === 'granted') return '已确认';
  if (state === 'manual-required') return '需手动';
  if (state === 'root-unavailable') return '未检测到 root';
  if (state === 'not-granted') return '未开启';
  return '执行失败';
}

export function TerminalLedgerRepairControl({
  count,
  errorCode,
  disabled,
  requeueing,
  onRequeue,
}: {
  count: number;
  errorCode: string | undefined;
  disabled: boolean;
  requeueing: boolean;
  onRequeue: () => void;
}) {
  const safeCount = Math.max(0, Math.trunc(count));
  if (safeCount === 0) return null;
  return (
    <div className="native-terminal-ledger-repair">
      <span className="is-warning">{terminalLedgerDiagnosticCopy(safeCount, errorCode)}</span>
      <small>请先在电脑端处理冲突或拒绝，再点“重新检查”；不会自动重试。</small>
      <button type="button" onClick={onRequeue} disabled={disabled}>
        {requeueing ? '正在重新检查…' : '重新检查已结束专注'}
      </button>
    </div>
  );
}

export function nativeCloudPollErrorCopy(code: string | undefined): string {
  if (code === 'network_error') return '暂时无法连接云端';
  if (code === 'timeout') return '云端连接超时';
  if (code === 'rate_limited') return '云端暂时限流，稍后自动重试';
  if (code === 'server_error') return '云端暂时不可用，稍后自动重试';
  if (code === 'authentication_failed') return '设备凭据已失效，请重新配对';
  if (code === 'authorization_failed') return '当前设备没有云端同步权限';
  if (code === 'contract_error') return '云端响应异常';
  if (code === 'revision_conflict' || code === 'revision_rollback') return '云端状态存在版本差异';
  return '后台同步暂时失败';
}

export function terminalLedgerDiagnosticCopy(count: number, code: string | undefined): string {
  const safeCount = Math.max(0, Math.trunc(count));
  if (code === 'conflict_present') {
    return `已暂停自动补传 · ${safeCount} 场已结束专注与云端存在差异，请在电脑端处理`;
  }
  if (code === 'rejected_operation') {
    return `已暂停自动补传 · ${safeCount} 场已结束专注被云端拒绝，请在电脑端处理`;
  }
  return `已暂停自动补传 · ${safeCount} 场已结束专注需要处理`;
}

export function terminalLedgerRequeueNotice(requeued: number): string {
  const safeCount = Math.max(0, Math.trunc(requeued));
  if (safeCount === 0) return '没有可重新检查的已结束专注；请刷新状态后再试。';
  return `已安排重新检查 ${safeCount} 场已结束专注；仅本次由你手动触发。`;
}

export function terminalLedgerRequeueFailureCopy(error: unknown): string {
  const code = nativeErrorCode(error);
  if (
    code === 'stale_connection' ||
    (error instanceof DOMException && error.name === 'AbortError')
  ) {
    return '账号连接已变化，请重新打开设置后再试。';
  }
  return '暂时无法重新检查已结束专注，请稍后再试。';
}

/** Android 侧会返回华为胶囊，但共享类型尚未列出这个取值，所以按字符串比较。 */
function selectedSurface(status: NativeFocusStatus | null): string | undefined {
  return status?.systemSurface?.selected as string | undefined;
}

function huaweiCapsuleStatus(status: NativeFocusStatus | null): {
  value: string;
  tone: NativeRowTone;
} {
  if (selectedSurface(status) === 'huawei-live-capsule') {
    return { value: '使用中 · 计时胶囊', tone: 'ok' };
  }
  const manufacturer = (status?.manufacturer ?? '').toLowerCase();
  if (manufacturer.includes('huawei') || manufacturer.includes('honor')) {
    return { value: '可用 · 未启用', tone: 'warning' };
  }
  return { value: '本机非华为', tone: 'neutral' };
}

function xiaomiSurfaceStatus(status: NativeFocusStatus | null): {
  value: string;
  tone: NativeRowTone;
} {
  const surface = status?.systemSurface;
  if (selectedSurface(status) === 'xiaomi-island') {
    if (surface?.xiaomiEvidenceLevel === 'visually-verified') {
      return { value: '使用中 · 真机已验收', tone: 'ok' };
    }
    if (surface?.xiaomiEvidenceLevel === 'systemui-accepted') {
      return { value: '使用中 · SystemUI 已接收', tone: 'ok' };
    }
    return { value: '使用中 · 待真机确认', tone: 'warning' };
  }
  const protocol = surface?.xiaomiFocusProtocol ?? 0;
  if (protocol >= 3 && surface?.xiaomiFocusPermission) {
    return { value: '协议就绪 · 未启用', tone: 'warning' };
  }
  const manufacturer = (status?.manufacturer ?? '').toLowerCase();
  if (
    manufacturer.includes('xiaomi') ||
    manufacturer.includes('redmi') ||
    manufacturer.includes('poco')
  ) {
    return {
      value: protocol >= 3 ? '权限未授予' : `协议 v${protocol} · 不支持岛`,
      tone: 'warning',
    };
  }
  return { value: '本机非小米', tone: 'neutral' };
}

function systemSurfaceStatus(status: NativeFocusStatus | null): {
  value: string;
  tone: NativeRowTone;
} {
  const selected = selectedSurface(status);
  if (selected === 'xiaomi-island') return { value: '小米超级岛', tone: 'ok' };
  if (selected === 'huawei-live-capsule') return { value: '华为实时胶囊', tone: 'ok' };
  if (selected === 'android-live-update') return { value: 'Android 实时更新', tone: 'ok' };
  if (selected === 'ongoing-notification') return { value: '常驻通知', tone: 'neutral' };
  return { value: '等待能力检测', tone: 'neutral' };
}

function formatStatusTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nativeErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
