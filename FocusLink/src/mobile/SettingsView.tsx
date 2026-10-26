import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, Monitor, Moon, Sun } from 'lucide-react';
import { APP_COMMIT, APP_DISPLAY_VERSION } from '@shared/version';
import type { LiveConnectionState } from './runtimeModel';
import { NativeSystemControls } from './NativeSystemControls';
import { TimerDial } from '../features/focus/TimerDial';
import {
  FOCUS_COLORS,
  FONT_PROFILES,
  TIMER_STYLES,
  MOBILE_FOCUS_LABELS,
  MOBILE_FONT_LABELS,
  MOBILE_TIMER_LABELS,
  MOBILE_THEME_LABELS,
  type MobileAppearance,
} from './appearance';
import {
  presentMobileLedgerFreshness,
  presentMobileSettingsConnection,
  presentMobileSettingsLedgerQueue,
  presentMobileTaskSync,
  presentMobileThirdPartyDelivery,
  type MobileSettingsFactTone,
  type MobileSettingsPullState,
} from './settingsStatusPresentation';
import type { MobileV2ConflictPresentation, MobileV2ConflictSide } from './v2ConflictResolution';
import { presentMobileLedgerNotice } from './syncFeedback';

interface SettingsViewProps {
  connection: LiveConnectionState;
  online: boolean;
  accountLabel: string | null;
  authenticated: boolean;
  lastSyncAt: number | null;
  pullState: MobileSettingsPullState;
  /** The ledger pull's own sentence: what it is doing, or why it failed. Null hides it. */
  ledgerNotice: string | null;
  taskCount: number;
  taskRevision: number;
  /** Local receipt time of the last cloud-confirmed task snapshot. */
  taskConfirmedAt: number | null;
  /** Ledger queue domain: queued uploads and rejected operations. */
  ledgerPendingCount: number;
  ledgerCount: number;
  ledgerRejectedCount: number;
  onOpenAccount: () => void;
  appearance: MobileAppearance;
  onAppearanceChange: (value: MobileAppearance) => void;
  conflicts: MobileV2ConflictPresentation[];
  conflictBusyId: string | null;
  conflictNotice: string | null;
  retryNotice: string | null;
  onResolveConflict: (conflictId: string, side: MobileV2ConflictSide) => void;
  /** The settings card only polls the native runtime while the app is in front. */
  foregroundActive: boolean;
}

/**
 * 设置页只有一层分组行：外观 / 同步与设备 / 系统显示 / 关于。
 * 每组打开一个同页子面板，首屏不再铺开诊断卡与全部外观控件。
 */
type SettingsPanel = 'root' | 'appearance' | 'sync' | 'system' | 'about';

const PANEL_TITLES: Record<Exclude<SettingsPanel, 'root'>, string> = {
  appearance: '外观',
  sync: '同步与设备',
  system: '系统显示',
  about: '关于',
};

/** 首屏右侧只放当前值的短标签，完整名称留在子面板里。 */
const SHORT_THEME_LABELS: Record<MobileAppearance['theme'], string> = {
  light: '浅色',
  dark: '深色',
  system: '系统',
};

const SHORT_FONT_LABELS: Record<MobileAppearance['fontProfile'], string> = {
  noto: '思源黑',
  'noto-serif': '思源宋',
  wenkai: '文楷',
  zhisong: '致宋',
  marker: '漫黑',
  xihei: '晰黑',
  smiley: '得意',
  kuaile: '快乐',
};

const SHORT_COLOR_LABELS: Record<MobileAppearance['focusColor'], string> = {
  emerald: '翡翠',
  cobalt: '钴蓝',
  violet: '紫罗兰',
  amber: '琥珀',
  graphite: '石墨',
};

const SHORT_TIMER_LABELS: Record<MobileAppearance['timerStyle'], string> = {
  standard: '等宽',
  flip: '翻页',
  pixel: '点阵',
  thin: '编辑',
  segment: '数码',
  counter: '滚筒',
  analog: '表圈',
  vernier: '标尺',
  draft: '描线',
};

const THEME_ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

export function SettingsView({
  connection,
  online,
  accountLabel,
  authenticated,
  lastSyncAt,
  pullState,
  ledgerNotice,
  taskCount,
  taskRevision,
  taskConfirmedAt,
  ledgerPendingCount,
  ledgerCount,
  ledgerRejectedCount,
  onOpenAccount,
  appearance,
  onAppearanceChange,
  conflicts,
  conflictBusyId,
  conflictNotice,
  retryNotice,
  onResolveConflict,
  foregroundActive,
}: SettingsViewProps) {
  const [panel, setPanel] = useState<SettingsPanel>('root');
  const panelTitleRef = useRef<HTMLHeadingElement>(null);

  // 打开子面板后把焦点交给面板标题：屏幕阅读器会先读到新页面，Tab 也从这里继续。
  useEffect(() => {
    if (panel === 'root') return;
    panelTitleRef.current?.focus();
  }, [panel]);

  useEffect(() => {
    if (panel === 'root') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel('root');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panel]);

  const connectionFact = presentMobileSettingsConnection({
    authenticated,
    online,
    connection,
    accountLabel,
  });
  const ledgerFact = presentMobileLedgerFreshness({
    authenticated,
    lastSyncAt,
    pullState,
    retryNotice,
  });
  const taskFact = presentMobileTaskSync({
    authenticated,
    taskCount,
    revision: taskRevision,
    confirmedAt: taskConfirmedAt,
  });
  const ledgerQueueFact = presentMobileSettingsLedgerQueue({
    pending: ledgerPendingCount,
    conflicts: conflicts.length,
    rejected: ledgerRejectedCount,
  });
  const deliveryFact = presentMobileThirdPartyDelivery();
  const ledgerNoticeView = presentMobileLedgerNotice({ notice: ledgerNotice, pullState });

  const closePanel = () => setPanel('root');

  const appearanceSummary = [
    SHORT_THEME_LABELS[appearance.theme],
    SHORT_FONT_LABELS[appearance.fontProfile],
    SHORT_COLOR_LABELS[appearance.focusColor],
    SHORT_TIMER_LABELS[appearance.timerStyle],
  ].join(' · ');

  const pendingTotal = ledgerPendingCount + conflicts.length + ledgerRejectedCount;
  const syncSummary = !authenticated
    ? '本机 · 未配对'
    : connection === 'live'
      ? pendingTotal > 0
        ? `已连接 · ${pendingTotal} 条待处理`
        : '已连接'
      : connectionFact.value;

  return (
    <section className="settings-view view-surface" aria-label="设置">
      {panel === 'root' && (
        <div className="settings-root">
          <p className="m-aux settings-root-note">按你的方式专注。</p>
          <div className="m-card settings-groups" role="group" aria-label="设置分组">
            <SettingsGroupRow
              label="外观"
              value={appearanceSummary}
              onOpen={() => setPanel('appearance')}
            />
            <SettingsGroupRow
              label="同步与设备"
              value={syncSummary}
              onOpen={() => setPanel('sync')}
            />
            <SettingsGroupRow
              label="系统显示"
              value="通知 · 悬浮条 · 权限"
              onOpen={() => setPanel('system')}
            />
            <SettingsGroupRow
              label="关于"
              value={`v${APP_DISPLAY_VERSION}`}
              onOpen={() => setPanel('about')}
            />
          </div>
        </div>
      )}

      {panel !== 'root' && (
        <div className="settings-panel">
          <div className="settings-panel-bar">
            <button className="m-text-action settings-back" type="button" onClick={closePanel}>
              <ChevronLeft aria-hidden="true" />
              <span>设置</span>
            </button>
          </div>
          <h2 className="m-section-title settings-panel-title" tabIndex={-1} ref={panelTitleRef}>
            {PANEL_TITLES[panel]}
          </h2>

          {panel === 'appearance' && (
            <>
              <SettingsBlock title="主题" titleId="settings-theme-title">
                <div className="appearance-segmented" role="group" aria-label="移动端主题">
                  {Object.entries(MOBILE_THEME_LABELS).map(([value, label]) => {
                    const ThemeIcon = THEME_ICONS[value as MobileAppearance['theme']];
                    return (
                      <button
                        key={value}
                        type="button"
                        className={`appearance-segmented-option theme-${value} ${appearance.theme === value ? 'is-selected' : ''}`}
                        aria-pressed={appearance.theme === value}
                        onClick={() =>
                          onAppearanceChange({
                            ...appearance,
                            theme: value as MobileAppearance['theme'],
                          })
                        }
                      >
                        <ThemeIcon aria-hidden="true" />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </SettingsBlock>

              <SettingsBlock title="字体" titleId="settings-font-title">
                <div className="appearance-font-choices" role="group" aria-label="移动端界面字体">
                  {FONT_PROFILES.map((profile) => (
                    <button
                      key={profile}
                      type="button"
                      data-font-profile={profile}
                      className={`appearance-font-choice font-profile-${profile} ${appearance.fontProfile === profile ? 'is-selected' : ''}`}
                      aria-pressed={appearance.fontProfile === profile}
                      onClick={() => onAppearanceChange({ ...appearance, fontProfile: profile })}
                    >
                      <strong>{MOBILE_FONT_LABELS[profile]}</strong>
                      <span className="appearance-font-sample">专注进行中 · 12:48</span>
                      <small>{appearance.fontProfile === profile ? '当前使用' : '点击应用'}</small>
                    </button>
                  ))}
                </div>
              </SettingsBlock>

              <SettingsBlock title="强调色" titleId="settings-color-title">
                <div className="appearance-color-choices" role="group" aria-label="移动端强调色">
                  {FOCUS_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`appearance-color-choice focus-color-${color} ${appearance.focusColor === color ? 'is-selected' : ''}`}
                      aria-label={MOBILE_FOCUS_LABELS[color]}
                      aria-pressed={appearance.focusColor === color}
                      onClick={() => onAppearanceChange({ ...appearance, focusColor: color })}
                    >
                      <span className="settings-color-swatch" aria-hidden="true" />
                      <span className="settings-color-name">{SHORT_COLOR_LABELS[color]}</span>
                      <Check className="settings-color-check" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </SettingsBlock>

              <SettingsBlock title="计时仪表" titleId="settings-timer-title">
                <div className="appearance-timer-choices" role="group" aria-label="移动端计时仪表">
                  {TIMER_STYLES.map((style) => (
                    <button
                      key={style}
                      type="button"
                      className={`appearance-timer-choice ${appearance.timerStyle === style ? 'is-selected' : ''}`}
                      aria-pressed={appearance.timerStyle === style}
                      onClick={() => onAppearanceChange({ ...appearance, timerStyle: style })}
                    >
                      <span>{MOBILE_TIMER_LABELS[style]}</span>
                      <div className="appearance-timer-preview" aria-hidden="true">
                        <TimerDial
                          ms={25 * 60_000 + 16_000}
                          state="running"
                          style={style}
                          coreRatio={0.62}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </SettingsBlock>
            </>
          )}

          {panel === 'sync' && (
            <>
              <section className="m-card settings-block" aria-label="设备与账号">
                <button
                  type="button"
                  className="m-row settings-account-row"
                  onClick={onOpenAccount}
                >
                  <span className="settings-group-label">设备与账号</span>
                  <span className="settings-row-value">
                    {authenticated ? (accountLabel ?? '已配对') : '未配对'}
                  </span>
                  <ChevronRight className="settings-row-chevron" aria-hidden="true" />
                </button>
              </section>

              <SettingsBlock title="实时" titleId="settings-domain-live" domain>
                <SettingsFactRow
                  label="实时连接"
                  value={connectionFact.value}
                  detail={connectionFact.detail}
                  tone={connectionFact.tone}
                />
              </SettingsBlock>

              <SettingsBlock title="任务" titleId="settings-domain-task" domain>
                <SettingsFactRow
                  label="任务同步"
                  value={taskFact.value}
                  detail={taskFact.detail}
                  tone={taskFact.tone}
                />
              </SettingsBlock>

              <SettingsBlock title="账本" titleId="settings-domain-ledger" domain>
                <SettingsFactRow
                  label="账本新鲜度"
                  value={ledgerFact.value}
                  detail={ledgerFact.detail}
                  tone={ledgerFact.tone}
                />
                <SettingsFactRow
                  label="账本待处理"
                  value={ledgerQueueFact.value}
                  detail={ledgerQueueFact.detail}
                  tone={ledgerQueueFact.tone}
                />
                <SettingsFactRow
                  label="本机专注记录"
                  value={`${ledgerCount} 场`}
                  detail="已结束且保存在本机，不代表已上传"
                />
                {ledgerNoticeView !== null && (
                  <p
                    className={`settings-ledger-notice tone-${ledgerNoticeView.tone}`}
                    role="status"
                    aria-live="polite"
                  >
                    {ledgerNoticeView.text}
                  </p>
                )}
                <p className="settings-hint">
                  账本新鲜度 = 最近一次从云端确认专注记录的时间；它不是网速，也不代表任务同步状态。
                  这几格互不代偿：实时连接看当下连通性，任务同步看任务清单是否已确认，账本待处理看排队、冲突与被拒绝的条数。
                </p>
              </SettingsBlock>

              <SettingsBlock title="投递" titleId="settings-domain-delivery" domain>
                <SettingsFactRow
                  label="第三方投递"
                  value={deliveryFact.value}
                  detail={deliveryFact.detail}
                  tone={deliveryFact.tone}
                />
                <div className="settings-hint-group">
                  <strong>桌面端专属操作</strong>
                  <p className="settings-hint">
                    设备互相输入 8 位码后同步 FocusLink
                    任务、清单颜色与专注记录；外部导入与投递只在桌面端设置中管理。
                  </p>
                </div>
              </SettingsBlock>

              <SettingsBlock
                title="同步冲突"
                titleId="settings-conflicts-title"
                note={conflicts.length === 0 ? '没有待处理冲突' : `${conflicts.length} 条待决定`}
                domain
              >
                <p className="settings-hint">
                  同一场专注在两台设备上被改成了不同内容时，云端不会替谁选边。下面逐条列出差异；你选哪一边，云端就按哪一边收敛。
                </p>
                {conflictNotice !== null && (
                  <p className="settings-conflict-notice" role="status">
                    {conflictNotice}
                  </p>
                )}
                {conflicts.length === 0 ? (
                  <p className="settings-hint">本机与云端当前一致，没有需要你决定的差异。</p>
                ) : (
                  <ul className="settings-conflict-list">
                    {conflicts.map((conflict) => (
                      <li className="settings-conflict-row" key={conflict.conflictId}>
                        <div className="settings-conflict-head">
                          <strong>{conflict.headline}</strong>
                          <span className="m-aux">{conflict.reasonLabel}</span>
                        </div>
                        <dl className="settings-conflict-diff">
                          {conflict.differences.map((difference) => (
                            <div key={difference.field}>
                              <dt>{difference.label}</dt>
                              <dd>本机：{difference.localValue}</dd>
                              <dd>云端：{difference.remoteValue}</dd>
                            </div>
                          ))}
                        </dl>
                        <p className="settings-hint">
                          {conflict.blockedReason ??
                            '选一边作为这场专注的最终版本；另一边会被这次决定覆盖。'}
                        </p>
                        <div className="settings-conflict-actions">
                          <button
                            className="m-button-secondary settings-conflict-action"
                            type="button"
                            disabled={!conflict.resolvable || conflictBusyId !== null}
                            onClick={() => onResolveConflict(conflict.conflictId, 'local')}
                          >
                            <span>保留本机</span>
                          </button>
                          <button
                            className="m-button-primary settings-conflict-action"
                            type="button"
                            disabled={!conflict.resolvable || conflictBusyId !== null}
                            onClick={() => onResolveConflict(conflict.conflictId, 'remote')}
                          >
                            <span>采用云端</span>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </SettingsBlock>
            </>
          )}

          {panel === 'system' && <NativeSystemControls foregroundActive={foregroundActive} />}

          {panel === 'about' && (
            <>
              <section className="m-card settings-block" aria-label="版本与构建">
                <SettingsFactRow label="版本" value={`v${APP_DISPLAY_VERSION}`} />
                <SettingsFactRow label="构建" value={APP_COMMIT} />
                <p className="settings-hint">反馈问题时附上版本与构建标识。</p>
              </section>

              <section className="m-card settings-block" aria-label="帮助">
                <div className="settings-hint-group">
                  <strong>帮助</strong>
                  <p className="settings-hint">
                    配对、同步与第三方投递在移动端只读展示；需要修改导入、投递或导出的规则时，请到电脑端设置里操作。
                  </p>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function SettingsGroupRow({
  label,
  value,
  onOpen,
}: {
  label: string;
  value: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="m-row settings-group-row" onClick={onOpen}>
      <span className="settings-group-label">{label}</span>
      <span className="settings-row-value">{value}</span>
      <ChevronRight className="settings-row-chevron" aria-hidden="true" />
    </button>
  );
}

function SettingsBlock({
  title,
  titleId,
  note,
  domain = false,
  children,
}: {
  title: string;
  titleId: string;
  note?: string;
  domain?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="m-card settings-block" aria-labelledby={titleId}>
      <div className="settings-block-head">
        <h3 className={`settings-block-title ${domain ? 'is-domain' : ''}`} id={titleId}>
          {title}
        </h3>
        {note ? <span className="settings-block-note">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

function SettingsFactRow({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: MobileSettingsFactTone;
}) {
  return (
    <div className={`settings-fact-row ${tone ? `tone-${tone}` : ''}`}>
      <span className="settings-fact-copy">
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      <span className="settings-fact-value">{value}</span>
    </div>
  );
}
