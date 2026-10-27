import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Maximize2, Minimize2, Pause, PictureInPicture2, Play } from 'lucide-react';
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
import { MobileTimerInstrument } from './MobileTimerInstrument';
import { MobileRibbon } from './MobileRibbon';
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
  runtimeReady?: boolean;
  /**
   * Foreground flags. The once-per-second readout must not keep waking a backgrounded or
   * locked app; when either flag is off the ticker stops and only the last reading stays.
   */
  appActive?: boolean;
  documentVisible?: boolean;
}

/** 最近任务行数上限：sheet 只留「最近」5 条，完整清单走「全部任务」。 */
const RECENT_TASK_LIMIT = 5;

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
  runtimeReady = true,
  appActive = true,
  documentVisible = true,
}: FocusConsoleProps) {
  const [now, setNow] = useState(() => Date.now());
  const [finishDialogOpen, setFinishDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [freeStartToken, setFreeStartToken] = useState(0);
  const [tabletViewport, setTabletViewport] = useState(() =>
    isTabletFocusViewport(window.innerWidth, window.innerHeight),
  );
  const freeStartPending = useRef(false);
  const sheetDialogRef = useRef<HTMLDivElement | null>(null);
  const current = snapshot ?? idleLiveFocusSnapshot(0, now);
  const timerSnapshot = useMemo(() => liveFocusSnapshotToTimerSnapshot(current), [current]);
  const active = current.state !== 'idle';
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

  // Sheet 打开时把焦点交给面板本体，Esc 关闭。
  useEffect(() => {
    if (!sheetOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheetOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    const frame = window.requestAnimationFrame(() => sheetDialogRef.current?.focus());
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.cancelAnimationFrame(frame);
    };
  }, [sheetOpen]);

  /**
   * 「直接开始，不写名字」：先清掉任务与标题草稿，等父级把这两项真的清空后再发 start，
   * 否则 onCommand 仍会读到上一次的 selectedTaskId / titleDraft。
   */
  useEffect(() => {
    if (!freeStartPending.current) return;
    if (titleDraft.trim() || selectedTaskId) return;
    freeStartPending.current = false;
    onCommand('start');
  }, [freeStartToken, titleDraft, selectedTaskId, onCommand]);

  const durations = useMemo(() => projectLiveFocusDurations(current, now), [current, now]);
  const controls = runtimeControlAvailability({
    snapshot: current,
    connection,
    pending: pendingCommand !== null || !runtimeReady,
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

  const recentTasks = useMemo(() => {
    return [...tasks]
      .filter((task) => !task.isCompleted)
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
      .slice(0, RECENT_TASK_LIMIT);
  }, [tasks]);

  const taskTitle = current.taskTitle?.trim() || '';
  const sessionTitle = current.title?.trim() || '';
  const activeTaskLabel = taskTitle || sessionTitle || '自由专注';
  const draftLabel = selectedTask?.title ?? (titleDraft.trim() || '自由专注');
  const statusLabel = localOfflineMode
    ? `${liveStateLabel(current.state)} · 本机`
    : showingCachedSnapshot
      ? `${liveStateLabel(current.state)} · 缓存`
      : liveStateLabel(current.state);

  const requestFinish = () => {
    if (!controls.finish) return;
    setFinishDialogOpen(true);
  };

  const openSheet = () => {
    if (pendingCommand !== null) return;
    setSheetOpen(true);
  };

  const chooseTask = (taskId: string) => {
    onTaskChange(taskId);
    setSheetOpen(false);
  };

  const startWithoutName = () => {
    freeStartPending.current = true;
    setSheetOpen(false);
    onTitleChange('');
    onTaskChange('');
    setFreeStartToken((token) => token + 1);
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
          {/* 1 · 一行任务入口：左侧当前任务名或「自由专注」，整行点开底部 sheet。 */}
          {active ? (
            <div className="focus-task-entry is-static">
              <span className="focus-task-entry-title">{activeTaskLabel}</span>
            </div>
          ) : (
            <button
              className="focus-task-entry"
              type="button"
              onClick={openSheet}
              disabled={pendingCommand !== null}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
            >
              <span className="focus-task-entry-title">{draftLabel}</span>
              <ChevronRight className="focus-task-entry-chevron" aria-hidden="true" />
            </button>
          )}

          {/* 2 · 一行状态 + 主读数 */}
          <div
            className="focus-readout"
            key={current.state}
            aria-label={`${liveStateLabel(current.state)}计时`}
          >
            <p className="focus-readout-status">
              <i aria-hidden="true" />
              {statusLabel}
            </p>
            <MobileTimerInstrument
              ms={durations.primaryElapsedMs}
              state={current.state}
              style={timerStyle}
            />
          </div>

          {/* 3 · 主操作：单主按钮；运行或暂停时与「结束」并排。 */}
          <div className="focus-actions">
            {current.state === 'idle' && (
              <button
                className="focus-action primary start-action"
                type="button"
                disabled={!controls.start}
                onClick={() => onCommand('start')}
              >
                <Play className="focus-action-icon" aria-hidden="true" />
                {!runtimeReady
                  ? '正在恢复本机记录…'
                  : pendingCommand === 'start'
                    ? '正在开始…'
                    : '开始专注'}
              </button>
            )}
            {current.state === 'running' && (
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
            {current.state === 'paused' && (
              <button
                className="focus-action primary resume-action"
                type="button"
                disabled={!controls.resume}
                onClick={() => onCommand('resume')}
              >
                <Play className="focus-action-icon" aria-hidden="true" />
                {pendingCommand === 'resume' ? '正在继续…' : '继续'}
              </button>
            )}
            {active && (
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

          {/* 4 · 时间之带（移动端三模式：流线 / 光栅 / 时段） */}
          <MobileRibbon
            snapshot={timerSnapshot}
            wallMs={durations.wallElapsedMs}
            activeMs={durations.activeElapsedMs}
            state={timerSnapshot.state}
          />

          {/* 5 · 三时间一行等宽列 */}
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
            <RuntimeMetric label="总时长" value={formatClockDuration(durations.wallElapsedMs)} />
          </div>

          {/* 原生系统能力（沉浸 / 画中画）只在支持的真机上、且专注进行中出现。 */}
          {active && nativeSystemControls.available && (
            <section
              className="focus-system-tools"
              aria-label={tabletViewport ? '平板专注显示' : '手机专注显示'}
            >
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

          {/* 多端细节不再占视觉，只留给读屏；顶栏负责同步状态点。 */}
          <aside className="live-context sr-only" aria-label="多端状态">
            <strong>多端连接</strong>
            <span>{`${connectionCopy.title}；${connectionCopy.detail}`}</span>
            <span>{`数据来源 ${observation.source}，${observation.freshness}`}</span>
            <span>{`最近确认 ${observation.lastConfirmed}`}</span>
            <span>{`关联任务 ${current.taskTitle || '未关联'}`}</span>
            <span>{`实时版本 rev ${current.revision}`}</span>
            <span>{`最近操作设备 ${recentDevice}`}</span>
            <span>
              {`状态开始 ${
                current.currentStateStartedAt
                  ? formatMoment(current.currentStateStartedAt)
                  : '尚未开始'
              }`}
            </span>
            {authorityMode === 'forked-local' && (
              <span>本机离线会话正在运行：其他设备另有云端会话，两份会话独立控制、独立入账</span>
            )}
          </aside>

          {commandNotice && (
            <p className="focus-command-notice" role="status" aria-live="polite">
              {commandNotice}
              {connection !== 'live' && (
                <button type="button" onClick={onOpenConnection}>
                  同步详情
                </button>
              )}
            </p>
          )}
        </div>
      </div>

      {sheetOpen && (
        <>
          <div className="m-sheet-scrim" role="presentation" onClick={() => setSheetOpen(false)} />
          <div
            className="m-sheet focus-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="focus-sheet-title"
            tabIndex={-1}
            ref={sheetDialogRef}
          >
            <h2 className="focus-sheet-title" id="focus-sheet-title">
              这次专注做什么
            </h2>

            <section className="focus-sheet-block">
              <div className="focus-sheet-block-head">
                <h3 className="focus-sheet-heading">最近任务</h3>
                <button
                  className="focus-sheet-link"
                  type="button"
                  onClick={() => {
                    setSheetOpen(false);
                    onOpenTasks();
                  }}
                >
                  全部任务
                </button>
              </div>
              {recentTasks.length > 0 ? (
                <ul className="focus-sheet-list">
                  {recentTasks.map((task) => (
                    <li key={task.id}>
                      <button
                        className={
                          task.id === selectedTaskId
                            ? 'focus-task-row focus-sheet-task is-selected'
                            : 'focus-task-row focus-sheet-task'
                        }
                        type="button"
                        onClick={() => chooseTask(task.id)}
                      >
                        {task.title}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="focus-sheet-empty">还没有任务，可以直接开始自由专注</p>
              )}
            </section>

            <details className="focus-title-details focus-sheet-block" open>
              <summary className="focus-sheet-heading">输入这次专注的名字</summary>
              <div className="focus-title-input">
                <input
                  id="focus-title"
                  value={titleDraft}
                  onChange={(event) => onTitleChange(event.target.value)}
                  maxLength={1_000}
                  placeholder="例如：整理化学错题"
                  autoComplete="off"
                  enterKeyHint="done"
                  aria-label="这次专注的名字"
                />
                <button
                  className="focus-sheet-name-apply"
                  type="button"
                  disabled={!titleDraft.trim()}
                  onClick={() => setSheetOpen(false)}
                >
                  用这个名字
                </button>
              </div>
            </details>

            <button className="focus-sheet-free" type="button" onClick={startWithoutName}>
              直接开始，不写名字
            </button>
          </div>
        </>
      )}

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
