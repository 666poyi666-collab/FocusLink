import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  ListTree,
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
} from 'lucide-react';
import {
  formatClockDuration,
  idleLiveFocusSnapshot,
  liveConnectionCopy,
  liveStateLabel,
  projectLiveFocusDurations,
  runtimeControlAvailability,
  type LiveConnectionState,
  type LiveFocusSnapshotLike,
} from './runtimeModel';
import type { SyncedTask } from '@shared/sync/taskSnapshotProtocol';
import type { LiveSnapshotSource } from './liveSnapshotPolicy';
import type { MobileAuthorityMode } from './cache';
import { MobileConfirmDialog } from './MobileConfirmDialog';
import { liveFocusSnapshotToTimerSnapshot } from './liveTimerSnapshotAdapter';
import { focusDeviceLabel, isTabletFocusViewport } from './viewportPolicy';
import { MobileFocusChronograph } from './MobileFocusChronograph';
import { TemporalRibbon } from '../features/focus/TemporalRibbon';
import type { MobileAppearance } from './appearance';
import { createMobileSecondTicker } from './backgroundPolicy';

export type MobileFocusCommand = 'start' | 'pause' | 'resume' | 'finish';

export interface NativeFocusConsoleControls {
  available: boolean;
  immersiveSystemBars: boolean;
  pictureInPictureSupported: boolean;
  pictureInPictureActive: boolean;
  busy: 'immersive' | 'picture-in-picture' | null;
}

export interface FocusConsoleProps {
  snapshot: LiveFocusSnapshotLike | null;
  connection: LiveConnectionState;
  connectionNotice: string | null;
  titleDraft: string;
  pendingCommand: MobileFocusCommand | null;
  commandNotice: string | null;
  localDeviceId: string;
  tasks: readonly SyncedTask[];
  selectedTaskId: string;
  onTaskChange: (taskId: string) => void;
  onTitleChange: (value: string) => void;
  onCommand: (command: MobileFocusCommand) => void;
  onOpenConnection: () => void;
  onOpenTasks: () => void;
  snapshotSource: LiveSnapshotSource;
  nativeSystemControls: NativeFocusConsoleControls;
  onToggleImmersiveSystemBars: () => void;
  onEnterPictureInPicture: () => void;
  localOfflineMode: boolean;
  authorityMode: MobileAuthorityMode;
  allowOfflineStart: boolean;
  timerStyle: MobileAppearance['timerStyle'];
  /**
   * Foreground flags. The once-per-second readout must not keep waking a backgrounded or
   * locked app; when either flag is off the ticker stops and only the last reading stays.
   */
  appActive?: boolean;
  documentVisible?: boolean;
}

export function FocusConsole({
  snapshot,
  connection,
  connectionNotice,
  titleDraft,
  pendingCommand,
  commandNotice,
  localDeviceId,
  tasks,
  selectedTaskId,
  onTaskChange,
  onTitleChange,
  onCommand,
  onOpenConnection,
  onOpenTasks,
  snapshotSource,
  nativeSystemControls,
  onToggleImmersiveSystemBars,
  onEnterPictureInPicture,
  localOfflineMode,
  authorityMode,
  allowOfflineStart,
  timerStyle,
  appActive = true,
  documentVisible = true,
}: FocusConsoleProps) {
  const [now, setNow] = useState(() => Date.now());
  const [finishDialogOpen, setFinishDialogOpen] = useState(false);
  const [tabletViewport, setTabletViewport] = useState(() =>
    isTabletFocusViewport(window.innerWidth, window.innerHeight),
  );
  const current = snapshot ?? idleLiveFocusSnapshot(0, now);
  const timerSnapshot = useMemo(() => liveFocusSnapshotToTimerSnapshot(current), [current]);
  const active = current.state !== 'idle';
  const cachedRemoteOnly = allowOfflineStart && !localOfflineMode;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const ticker = createMobileSecondTicker(
      {
        now: () => Date.now(),
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (handle) => window.clearTimeout(handle),
      },
      setNow,
    );
    ticker.setGate({ active, appActive, documentVisible });
    return () => ticker.dispose();
  }, [active, appActive, documentVisible]);

  // A new live revision can arrive mid-second; realign the readout without restarting the ticker.
  useEffect(() => {
    setNow(Date.now());
  }, [current.revision, current.serverTime, current.state]);

  useEffect(() => {
    const update = () =>
      setTabletViewport(isTabletFocusViewport(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const durations = useMemo(() => projectLiveFocusDurations(current, now), [current, now]);
  const controls = runtimeControlAvailability({
    snapshot: current,
    connection,
    pending: pendingCommand !== null,
    localSession: localOfflineMode,
    allowOfflineStart,
  });
  const connectionCopy = liveConnectionCopy(connection, snapshot !== null, connectionNotice);
  const recentDevice = focusDeviceLabel(current.ownerDeviceId, localDeviceId, tabletViewport);
  const showingCachedSnapshot = snapshotSource === 'cache' && connection !== 'live';
  const observation = presentLiveObservation(
    connection,
    snapshotSource,
    snapshot?.observedAt ?? null,
    now,
  );
  const phaseLabel = focusPhaseLabel(current.state);
  const readoutHint = localOfflineMode
    ? '本机计时 · 结束后安全保存'
    : showingCachedSnapshot
      ? '上次确认状态 · 当前可另开本机专注'
      : current.state === 'paused'
        ? `累计专注 ${formatClockDuration(durations.activeElapsedMs)}`
        : current.state === 'running'
          ? '本轮有效专注'
          : '计时尚未开始';
  const taskTitle = current.taskTitle?.trim() || '';
  const sessionTitle = current.title?.trim() || '';

  const requestFinish = () => {
    if (!controls.finish) return;
    setFinishDialogOpen(true);
  };

  return (
    <section
      className={`focus-console phase-${current.state}`}
      aria-labelledby="focus-console-title"
      data-timer-style={timerStyle}
    >
      <h2 className="focus-console-title" id="focus-console-title">
        当前专注
      </h2>

      <div className="focus-console-body">
        <div className="focus-instrument">
          {/* 2 · 任务选择：当前任务行 + 切换入口；标题输入走 disclosure，不常驻表单。 */}
          <div className="focus-task-block">
            <p className="focus-field-label">当前任务</p>
            {active ? (
              <div className="focus-task-card is-readonly">
                <div className="focus-task-row">
                  <span className="focus-task-glyph" aria-hidden="true">
                    <ListTree />
                  </span>
                  <span className="focus-task-copy">
                    <strong>{taskTitle || sessionTitle || '自由专注'}</strong>
                    <small>{taskTitle ? '已关联 FocusLink 任务' : '本轮未关联任务'}</small>
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="focus-task-card">
                  <button
                    className="focus-task-row is-picker"
                    type="button"
                    onClick={onOpenTasks}
                    disabled={pendingCommand !== null}
                    aria-label={
                      selectedTask
                        ? `当前已选择 ${selectedTask.title}，展开任务树重新选择`
                        : '展开任务树选择任务'
                    }
                  >
                    <span className="focus-task-glyph" aria-hidden="true">
                      <ListTree />
                    </span>
                    <span className="focus-task-copy">
                      <strong>{selectedTask?.title ?? '自由专注'}</strong>
                      <small>
                        {selectedTask ? '已关联 FocusLink 任务' : '轻触选择，也可以保持自由专注'}
                      </small>
                    </span>
                    <ChevronRight className="focus-task-chevron" aria-hidden="true" />
                  </button>
                  <details className="focus-title-details">
                    <summary>
                      <span className="focus-title-summary">
                        {titleDraft.trim() || '给这次专注起个名字'}
                      </span>
                      <span className="focus-title-optional">选填</span>
                      <ChevronRight className="focus-title-chevron" aria-hidden="true" />
                    </summary>
                    <label className="focus-title-input" htmlFor="focus-title">
                      <span>专注标题</span>
                      <input
                        id="focus-title"
                        value={titleDraft}
                        onChange={(event) => onTitleChange(event.target.value)}
                        maxLength={1_000}
                        placeholder="例如：整理化学错题"
                        autoComplete="off"
                        enterKeyHint="done"
                        disabled={pendingCommand !== null}
                        aria-describedby="focus-title-help"
                      />
                      <small id="focus-title-help">标题可留空；直接开始时会记为“自由专注”。</small>
                    </label>
                  </details>
                  {selectedTask && (
                    <button
                      className="focus-task-clear"
                      type="button"
                      onClick={() => onTaskChange('')}
                      disabled={pendingCommand !== null}
                    >
                      改为自由专注
                    </button>
                  )}
                </div>
                <p className="focus-task-note">
                  {tasks.length > 0
                    ? `${tasks.length} 个本机任务可选`
                    : '先去「任务」创建待办；配对只用于多端同步'}
                </p>
              </>
            )}
          </div>

          {/* 3 · 状态点 + 主读数 */}
          <div
            className="focus-readout"
            key={current.state}
            aria-label={`${liveStateLabel(current.state)}计时`}
          >
            <p className="focus-readout-status">
              <i aria-hidden="true" />
              {localOfflineMode
                ? `本机 · ${phaseLabel}`
                : showingCachedSnapshot
                  ? `缓存 · ${phaseLabel}`
                  : phaseLabel}
            </p>
            <MobileFocusChronograph ms={durations.primaryElapsedMs} state={current.state} />
            <p className="focus-readout-hint">{readoutHint}</p>
          </div>

          {/* 4 · 主操作：单主按钮；运行或暂停时与「结束」并排。全部在流内，不做粘底覆盖。 */}
          <div className="focus-actions">
            {(current.state === 'idle' || cachedRemoteOnly) && (
              <button
                className="focus-action primary start-action"
                type="button"
                disabled={!controls.start}
                onClick={() => onCommand('start')}
              >
                <Play className="focus-action-icon" aria-hidden="true" />
                {pendingCommand === 'start'
                  ? '正在开始…'
                  : cachedRemoteOnly
                    ? '开始本机专注'
                    : '开始专注'}
              </button>
            )}
            {current.state === 'running' && !cachedRemoteOnly && (
              <button
                className="focus-action primary pause-action"
                type="button"
                disabled={!controls.pause}
                onClick={() => onCommand('pause')}
              >
                <Pause className="focus-action-icon" aria-hidden="true" />
                {pendingCommand === 'pause' ? '正在暂停…' : '暂停'}
              </button>
            )}
            {current.state === 'paused' && !cachedRemoteOnly && (
              <button
                className="focus-action primary resume-action"
                type="button"
                disabled={!controls.resume}
                onClick={() => onCommand('resume')}
              >
                <Play className="focus-action-icon" aria-hidden="true" />
                {pendingCommand === 'resume' ? '正在继续…' : '继续专注'}
              </button>
            )}
            {active && !cachedRemoteOnly && (
              <button
                className="focus-action finish-action"
                type="button"
                disabled={!controls.finish}
                onClick={requestFinish}
              >
                {pendingCommand === 'finish' ? '正在结束…' : '结束'}
              </button>
            )}
          </div>

          {commandNotice && (
            <p className="focus-command-notice" role="status" aria-live="polite">
              {commandNotice}
            </p>
          )}

          {/* 5 · 时间之带 */}
          <TemporalRibbon snapshot={timerSnapshot} state={timerSnapshot.state} now={now} />

          {/* 6 · 三时间同一行等宽列 */}
          <div className="runtime-metrics" aria-label="本轮三时间">
            <RuntimeMetric
              label="累计专注"
              value={formatClockDuration(durations.activeElapsedMs)}
              tone="focus"
            />
            <RuntimeMetric
              label="累计暂停"
              value={formatClockDuration(durations.pauseElapsedMs)}
              tone="pause"
            />
            <RuntimeMetric label="总历时" value={formatClockDuration(durations.wallElapsedMs)} />
          </div>

          {active && nativeSystemControls.available && (
            <section
              className="focus-system-tools"
              aria-label={tabletViewport ? '平板专注显示' : '手机专注显示'}
            >
              <div className="focus-system-tools-copy">
                <strong>{tabletViewport ? '平板专注显示' : '手机专注显示'}</strong>
                <small>
                  {nativeSystemControls.pictureInPictureActive
                    ? '画中画正在运行'
                    : nativeSystemControls.immersiveSystemBars
                      ? '沉浸显示已开启，轻触屏幕边缘可暂时唤出系统栏'
                      : '进入沉浸显示可收起系统状态栏与导航栏'}
                </small>
              </div>
              <div className="focus-system-tool-actions">
                <button
                  className={nativeSystemControls.immersiveSystemBars ? 'is-active' : ''}
                  type="button"
                  onClick={onToggleImmersiveSystemBars}
                  disabled={nativeSystemControls.busy !== null}
                  aria-pressed={nativeSystemControls.immersiveSystemBars}
                  title={nativeSystemControls.immersiveSystemBars ? '退出沉浸显示' : '进入沉浸显示'}
                >
                  {nativeSystemControls.immersiveSystemBars ? (
                    <Minimize2 aria-hidden="true" />
                  ) : (
                    <Maximize2 aria-hidden="true" />
                  )}
                  <span>{nativeSystemControls.immersiveSystemBars ? '退出沉浸' : '沉浸显示'}</span>
                </button>
                {nativeSystemControls.pictureInPictureSupported && (
                  <button
                    type="button"
                    onClick={onEnterPictureInPicture}
                    disabled={
                      nativeSystemControls.busy !== null ||
                      nativeSystemControls.pictureInPictureActive
                    }
                    title="进入系统画中画"
                  >
                    <PictureInPicture2 aria-hidden="true" />
                    <span>
                      {nativeSystemControls.busy === 'picture-in-picture' ? '正在进入…' : '画中画'}
                    </span>
                  </button>
                )}
              </div>
            </section>
          )}

          {/* 7 · 同步状态：正常态只是页脚一行低权重入口，展开才是多端细节。 */}
          <details className="focus-sync-panel" data-connection={connection}>
            <summary>
              <span
                className={connection === 'live' ? 'focus-sync-dot is-live' : 'focus-sync-dot'}
                aria-hidden="true"
              />
              <span className="focus-sync-label">{connectionCopy.title}</span>
              <span className="focus-sync-meta">{observation.freshness}</span>
              <ChevronRight className="focus-sync-chevron" aria-hidden="true" />
            </summary>
            <div className="focus-sync-body">
              <aside className="live-context" aria-label="多端状态">
                <div className="live-context-heading">
                  <strong>多端连接</strong>
                  <span>{observation.source}</span>
                </div>
                <div
                  className={`connection-callout connection-${connection} source-${snapshotSource}`}
                  data-live-source={snapshotSource}
                >
                  <span className="network-dot" aria-hidden="true" />
                  <div>
                    <strong>{connectionCopy.title}</strong>
                    <small>{connectionCopy.detail}</small>
                    <time dateTime={observation.dateTime ?? undefined}>
                      {observation.lastConfirmed}
                    </time>
                  </div>
                </div>
                {authorityMode === 'forked-local' && (
                  <div className="connection-callout connection-error" role="status">
                    <span className="network-dot" aria-hidden="true" />
                    <div>
                      <strong>本机离线会话正在运行</strong>
                      <small>其他设备另有云端活动会话；两份会话独立控制、独立入账</small>
                    </div>
                  </div>
                )}

                <dl className="runtime-facts">
                  <div>
                    <dt>关联任务</dt>
                    <dd>{current.taskTitle || '未关联'}</dd>
                  </div>
                  <div>
                    <dt>实时版本</dt>
                    <dd>rev {current.revision}</dd>
                  </div>
                  <div>
                    <dt>实时新鲜度</dt>
                    <dd>{observation.freshness}</dd>
                  </div>
                  <div>
                    <dt>最近确认</dt>
                    <dd>{observation.shortConfirmed}</dd>
                  </div>
                  <div>
                    <dt>最近操作设备</dt>
                    <dd>{recentDevice}</dd>
                  </div>
                  <div>
                    <dt>状态开始</dt>
                    <dd>
                      {current.currentStateStartedAt
                        ? formatMoment(current.currentStateStartedAt)
                        : '尚未开始'}
                    </dd>
                  </div>
                </dl>

                <div className="desktop-delivery-note">
                  <strong>FocusLink 负责多端同步</strong>
                  <p>这里显示实时专注链；任务清单与结束账本分别保留自己的最近同步时间。</p>
                </div>

                <button className="focus-sync-open" type="button" onClick={onOpenConnection}>
                  多端同步设置
                </button>
              </aside>
            </div>
          </details>
        </div>
      </div>

      <MobileConfirmDialog
        open={finishDialogOpen}
        title="结束本轮专注？"
        description="结束后会生成会话账本，此操作不能继续本轮计时。"
        confirmLabel={pendingCommand === 'finish' ? '正在结束…' : '结束'}
        danger
        onCancel={() => setFinishDialogOpen(false)}
        onConfirm={() => {
          setFinishDialogOpen(false);
          onCommand('finish');
        }}
      />
    </section>
  );
}

function RuntimeMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'focus' | 'pause';
}) {
  return (
    <div className={tone ? `runtime-metric tone-${tone}` : 'runtime-metric'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/** 状态点文案：正在专注 / 已暂停 / 待开始。 */
function focusPhaseLabel(state: LiveFocusSnapshotLike['state']): string {
  if (state === 'running') return '正在专注';
  if (state === 'paused') return '已暂停';
  return '待开始';
}

function formatMoment(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function presentLiveObservation(
  connection: LiveConnectionState,
  source: LiveSnapshotSource,
  observedAt: number | null,
  now: number,
): {
  source: string;
  freshness: string;
  lastConfirmed: string;
  shortConfirmed: string;
  dateTime: string | null;
} {
  const sourceLabel =
    source === 'server'
      ? '云端实时'
      : source === 'cache'
        ? '本机缓存'
        : source === 'local'
          ? '本机会话'
          : '尚未确认';
  if (source === 'local') {
    return {
      source: sourceLabel,
      freshness: '本机实时',
      lastConfirmed: '本机独立计时，联网后补传结束账本',
      shortConfirmed: '本机记录',
      dateTime: null,
    };
  }
  if (!observedAt) {
    return {
      source: sourceLabel,
      freshness: connection === 'connecting' ? '等待首次确认' : '尚未确认',
      lastConfirmed: connection === 'connecting' ? '正在等待首次确认' : '尚无实时状态确认',
      shortConfirmed: '尚未确认',
      dateTime: null,
    };
  }
  const date = new Date(observedAt);
  const timestamp = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
  const prefix = connection === 'live' && source === 'server' ? '最近实时确认' : '离线前最后确认';
  const relative = formatObservationAge(Math.max(0, now - observedAt));
  const freshness =
    connection === 'live' && source === 'server'
      ? `已连接 · ${relative}`
      : connection === 'offline'
        ? `离线 · ${relative}`
        : source === 'cache'
          ? `缓存 · ${relative}`
          : `待重连 · ${relative}`;
  return {
    source: sourceLabel,
    freshness,
    lastConfirmed: `${prefix} ${timestamp}`,
    shortConfirmed: timestamp,
    dateTime: date.toISOString(),
  };
}

function formatObservationAge(ageMs: number): string {
  if (ageMs < 15_000) return '刚刚确认';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1_000)} 秒前`;
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)} 分钟前`;
  return `${Math.floor(ageMs / (60 * 60_000))} 小时前`;
}
