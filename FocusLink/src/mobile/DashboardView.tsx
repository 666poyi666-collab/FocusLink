import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { CalendarDays, ChevronRight, Play, X } from 'lucide-react';
import type { DayLedgerAnalytics, DayLedgerInterval } from '@shared/dayLedgerAnalytics';
import type { SyncedTask } from '@shared/sync/taskSnapshotProtocol';
import {
  buildDashboardTaskAllocation,
  largestRemainderPercentages,
  type DashboardTaskAllocation,
} from '@shared/dashboardPresentation';
import type { CachedBundle } from './cache';
import {
  buildMobileDashboardInRange,
  mobileCustomStatsRange,
  mobileStatsRange,
  mobileTimelineIntervalAt,
  resolveMobileTimelineTasks,
  selectMobileDashboardLedger,
  type MobileStatsRange,
  type MobileTimelineTaskDetail,
} from './dashboardModel';
import { formatDurationText, SessionLedger } from './SessionLedger';

const RANGE_OPTIONS: ReadonlyArray<{ value: MobileStatsRange; label: string }> = [
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: '7d', label: '近 7 天' },
  { value: 'previous-7d', label: '上个 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'previous-30d', label: '上个 30 天' },
];

type DashboardRangeChoice = MobileStatsRange | 'custom';

const DAY_PERIODS = [
  { label: '深夜', startHour: 0, endHour: 7 },
  { label: '上午', startHour: 7, endHour: 12 },
  { label: '下午', startHour: 12, endHour: 18 },
  { label: '晚间', startHour: 18, endHour: 22 },
  { label: '深夜', startHour: 22, endHour: 24 },
] as const;

interface DashboardViewProps {
  records: readonly CachedBundle[];
  ready: boolean;
  configured: boolean;
  lastSyncAt: number | null;
  cursor: string | null;
  tasks?: readonly SyncedTask[] | null;
  referenceNow?: number;
  /** 空态入口：切到专注页；由外壳注入，统计页自己不改导航。 */
  onStartFocus?: () => void;
}

export function DashboardView({
  records,
  ready,
  configured,
  lastSyncAt,
  cursor,
  tasks = null,
  referenceNow = Date.now(),
  onStartFocus,
}: DashboardViewProps) {
  const defaultBounds = useMemo(() => mobileStatsRange('7d', referenceNow), [referenceNow]);
  const [range, setRange] = useState<DashboardRangeChoice>('7d');
  const [customStart, setCustomStart] = useState(() => dayKey(defaultBounds.start));
  const [customEnd, setCustomEnd] = useState(() => dayKey(defaultBounds.end - 1));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const customBounds = useMemo(
    () => mobileCustomStatsRange(customStart, customEnd),
    [customEnd, customStart],
  );
  const bounds = useMemo(
    () =>
      range === 'custom' ? (customBounds ?? defaultBounds) : mobileStatsRange(range, referenceNow),
    [customBounds, defaultBounds, range, referenceNow],
  );
  const rangeAnalytics = useMemo(
    () => buildMobileDashboardInRange(records, bounds, referenceNow),
    [bounds, records, referenceNow],
  );
  // 趋势固定看最近 7 天：无论当前范围是「今天」还是「近 30 天」，这条都是同一张周视图。
  const weeklyAnalytics = useMemo(
    () => buildMobileDashboardInRange(records, mobileStatsRange('7d', referenceNow), referenceNow),
    [records, referenceNow],
  );
  const selectedLedger = useMemo(
    () => selectMobileDashboardLedger(rangeAnalytics.dayLedgers, selectedDate),
    [rangeAnalytics.dayLedgers, selectedDate],
  );
  const analytics = useMemo(
    () =>
      selectedDate && selectedLedger
        ? buildMobileDashboardInRange(
            records,
            { start: selectedLedger.dayStartedAt, end: selectedLedger.dayEndedAt },
            referenceNow,
          )
        : rangeAnalytics,
    [records, referenceNow, rangeAnalytics, selectedDate, selectedLedger],
  );
  const dashboardFocus = analytics.totals.focusMs + analytics.totals.estimatedFocusMs;
  const dashboardPause = analytics.totals.pauseMs + analytics.totals.estimatedPauseMs;
  const [focusRate, pauseRate, gapRate] = largestRemainderPercentages([
    dashboardFocus,
    dashboardPause,
    analytics.totals.gapMs,
  ]);
  const taskAllocation = useMemo(
    () => buildDashboardTaskAllocation(analytics.tasks, dashboardFocus),
    [analytics.tasks, dashboardFocus],
  );
  const hasFocusData = dashboardFocus > 0 || dashboardPause > 0 || analytics.activeDays > 0;
  const visibleBounds =
    selectedDate && selectedLedger
      ? { start: selectedLedger.dayStartedAt, end: selectedLedger.dayEndedAt }
      : bounds;
  const visibleRecords = records.filter((record) => sessionOverlaps(record, visibleBounds));
  const finishedRecords = useMemo(
    () =>
      visibleRecords
        .filter((record) => record.bundle.session.status === 'finished')
        .sort(
          (left, right) =>
            sessionSortKey(right.bundle.session) - sessionSortKey(left.bundle.session),
        ),
    [visibleRecords],
  );
  const sessionCount = finishedRecords.length;
  const averageFocus = sessionCount > 0 ? Math.round(dashboardFocus / sessionCount) : 0;
  const longestFocus = finishedRecords.reduce(
    (longest, record) => Math.max(longest, Math.max(0, record.bundle.session.activeElapsedMs)),
    0,
  );
  const recentSessions = finishedRecords.slice(0, 6).map((record) => ({
    key: record.entityId,
    startedAt: record.bundle.session.startedAt,
    title: sessionTitle(record),
    durationMs: Math.max(0, record.bundle.session.activeElapsedMs),
  }));
  const scopeLabel =
    selectedDate && selectedLedger
      ? formatFullDate(selectedLedger.date)
      : formatRangeLabel(bounds.start, bounds.end, range);
  const scopeNoun =
    selectedDate && selectedLedger ? formatMonthDay(selectedLedger.date) : rangeNoun(range);

  const selectRange = (nextRange: DashboardRangeChoice) => {
    setRange(nextRange);
    setSelectedDate(null);
  };

  const updateCustomStart = (value: string) => {
    setCustomStart(value);
    if (value && customEnd && value > customEnd) setCustomEnd(value);
    setSelectedDate(null);
  };

  const updateCustomEnd = (value: string) => {
    setCustomEnd(value);
    if (value && customStart && value < customStart) setCustomStart(value);
    setSelectedDate(null);
  };

  useEffect(() => {
    if (!detailsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [detailsOpen]);

  return (
    <section className="dashboard-view view-surface" aria-labelledby="mobile-dashboard-title">
      {/* 顶栏已经给出「统计」页面标题，这里只保留无障碍名称，避免同一标题重复两次。 */}
      <h2 id="mobile-dashboard-title" className="sr-only">
        时间账本
      </h2>

      {/* 一句话范围说明：只在标题下方出现一次，不再随各区块重复。 */}
      <p className="dashboard-scope-caption">
        {scopeNoun} · {formatRangeCaption(bounds, selectedDate)}
      </p>

      <div id="dashboard-range-shell" className="dashboard-range-shell">
        {/* 文字分段：无胶囊、无边框，当前项靠字重与 2px 下划线标识。 */}
        <div className="dashboard-tabs" role="group" aria-label="统计范围">
          {RANGE_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={range === option.value ? 'is-active' : ''}
              aria-pressed={range === option.value}
              onClick={() => selectRange(option.value)}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            className={`dashboard-custom-range-trigger ${range === 'custom' ? 'is-active' : ''}`}
            aria-pressed={range === 'custom'}
            onClick={() => selectRange('custom')}
          >
            <CalendarDays aria-hidden="true" />
            <span>自定义</span>
          </button>
        </div>
        {range === 'custom' && (
          <div className="dashboard-custom-range" role="group" aria-label="自定义统计日期">
            <label>
              <span>开始日期</span>
              <input
                type="date"
                value={customStart}
                max={dayKey(referenceNow)}
                aria-invalid={customBounds === null}
                onChange={(event) => updateCustomStart(event.target.value)}
              />
            </label>
            <i aria-hidden="true">至</i>
            <label>
              <span>结束日期</span>
              <input
                type="date"
                value={customEnd}
                min={customStart || undefined}
                max={dayKey(referenceNow)}
                aria-invalid={customBounds === null}
                onChange={(event) => updateCustomEnd(event.target.value)}
              />
            </label>
            {customBounds === null && <p role="alert">请选择有效的开始和结束日期。</p>}
          </div>
        )}
      </div>

      {!ready ? (
        <DashboardSkeleton />
      ) : (
        <>
          {hasFocusData ? (
            <>
              <section className="dashboard-hero" aria-label="有效专注">
                <p className="dashboard-primary-label">有效专注</p>
                <strong className="dashboard-primary-value">
                  {formatDurationText(dashboardFocus)}
                </strong>
                <p className="dashboard-primary-note">
                  {scopeNoun} • {sessionCount} 场专注
                </p>
              </section>

              <dl className="dashboard-summary" aria-label="专注摘要">
                <div className="dashboard-summary-item">
                  <dt>专注次数</dt>
                  <dd>{sessionCount} 次</dd>
                </div>
                <div className="dashboard-summary-item">
                  <dt>平均每次</dt>
                  <dd>{formatDurationText(averageFocus)}</dd>
                </div>
                <div className="dashboard-summary-item">
                  <dt>最长单次</dt>
                  <dd>{formatDurationText(longestFocus)}</dd>
                </div>
              </dl>

              <section
                className="dashboard-band dashboard-trend"
                aria-labelledby="ledger-days-title"
              >
                <h3 id="ledger-days-title" className="dashboard-group-label">
                  每日专注
                </h3>
                <DailyLedgerTrend
                  ledgers={weeklyAnalytics.dayLedgers}
                  selectedDate={selectedDate}
                  onSelect={(date) =>
                    setSelectedDate((current) => (current === date ? null : date))
                  }
                />
              </section>

              <section
                className="dashboard-band dashboard-recent"
                aria-labelledby="dashboard-recent-title"
              >
                <h3 id="dashboard-recent-title" className="dashboard-group-label">
                  最近记录
                </h3>
                <RecentSessions sessions={recentSessions} />
              </section>

              <div className="dashboard-details-entry">
                <button
                  type="button"
                  className="m-text-action dashboard-details-action"
                  aria-expanded={detailsOpen}
                  aria-controls="dashboard-details"
                  onClick={() => setDetailsOpen(true)}
                >
                  <span>查看时间轴与账本</span>
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            </>
          ) : (
            <div className="dashboard-empty" role="status">
              <p>{records.length === 0 ? '还没有已结束的专注' : '这个范围没有可统计的专注'}</p>
              {onStartFocus && (
                <button type="button" className="m-button-primary" onClick={onStartFocus}>
                  <Play aria-hidden="true" />
                  <span>开始专注</span>
                </button>
              )}
            </div>
          )}

          {/* 详细分析不删功能：全部收进底部 sheet，默认隐藏但保留在文档里。 */}
          <div id="dashboard-details" className="dashboard-details" hidden={!detailsOpen}>
            <button
              type="button"
              className="m-sheet-scrim"
              aria-label="关闭时间轴与账本"
              onClick={() => setDetailsOpen(false)}
            />
            <div
              className="m-sheet dashboard-details-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="时间轴与账本"
            >
              <header className="dashboard-details-head">
                <h2>时间轴与账本</h2>
                <button
                  type="button"
                  className="dashboard-details-close"
                  aria-label="关闭时间轴与账本"
                  onClick={() => setDetailsOpen(false)}
                >
                  <X aria-hidden="true" />
                </button>
              </header>
              <div className="dashboard-details-body">
                {selectedDate && selectedLedger && (
                  <SelectedDaySummary
                    ledger={selectedLedger}
                    onClear={() => setSelectedDate(null)}
                  />
                )}
                <DayLedgerTimeline
                  key={selectedLedger?.date ?? 'no-ledger'}
                  ledger={selectedLedger}
                  records={records}
                  tasks={tasks}
                />
                <section
                  className="dashboard-band task-allocation-band"
                  aria-labelledby="dashboard-task-allocation-title"
                >
                  <AnalyticsHeading
                    id="dashboard-task-allocation-title"
                    title="任务投入"
                    detail="已关联 / 未关联 / 估算"
                  />
                  <MobileTaskAllocation allocation={taskAllocation} />
                </section>
                <GapLedger ledger={selectedLedger} />
                <MobileTimeBudget
                  focusRate={focusRate}
                  pauseRate={pauseRate}
                  gapRate={gapRate}
                  estimated={analytics.estimated}
                />
                <SessionLedger
                  records={visibleRecords}
                  ready={ready}
                  configured={configured}
                  lastSyncAt={lastSyncAt}
                  cursor={cursor}
                  showSummary={false}
                  scopeLabel={scopeLabel}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function AnalyticsHeading({ id, title, detail }: { id: string; title: string; detail: string }) {
  return (
    <header className="analytics-heading">
      <h3 id={id}>{title}</h3>
      <span>{detail}</span>
    </header>
  );
}

function DailyLedgerTrend({
  ledgers,
  selectedDate,
  onSelect,
}: {
  ledgers: readonly DayLedgerAnalytics[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const max = Math.max(
    1,
    ...ledgers.map((ledger) => ledger.totals.focusMs + ledger.totals.estimatedFocusMs),
  );
  return (
    <div className="daily-ledger-trend" role="group" aria-label="每日专注时长">
      {ledgers.map((ledger) => {
        const focus = ledger.totals.focusMs + ledger.totals.estimatedFocusMs;
        const pause = ledger.totals.pauseMs + ledger.totals.estimatedPauseMs;
        const scale = focus > 0 ? Math.max(8, Math.round((focus / max) * 100)) : 0;
        const selected = selectedDate === ledger.date;
        return (
          <button
            type="button"
            key={ledger.date}
            className={`${focus > 0 ? 'has-focus' : 'is-empty'}${selected ? ' is-selected' : ''}`}
            aria-pressed={selected}
            aria-label={`${formatFullDate(ledger.date)}，专注 ${formatDurationText(focus)}，暂停 ${formatDurationText(pause)}，空档 ${formatDurationText(ledger.totals.gapMs)}${ledger.estimated ? '，含估算' : ''}`}
            onClick={() => onSelect(ledger.date)}
          >
            <span className="daily-ledger-bar" aria-hidden="true">
              <i className="focus" style={focus > 0 ? { height: `${scale}%` } : undefined} />
            </span>
            <small>{formatWeekday(ledger.date)}</small>
          </button>
        );
      })}
    </div>
  );
}

function RecentSessions({
  sessions,
}: {
  sessions: ReadonlyArray<{ key: string; startedAt: number; title: string; durationMs: number }>;
}) {
  if (sessions.length === 0) {
    return <p className="analytics-empty">这个范围还没有已结束的专注。</p>;
  }
  const groups: Array<{ label: string; rows: typeof sessions }> = [];
  for (const session of sessions) {
    const label = sessionDayLabel(session.startedAt);
    const current = groups.at(-1);
    if (current && current.label === label) {
      current.rows = [...current.rows, session];
    } else {
      groups.push({ label, rows: [session] });
    }
  }
  return (
    <div className="dashboard-recent-list">
      {groups.map((group) => (
        <div className="dashboard-recent-day" key={group.label}>
          <p className="dashboard-group-label">{group.label}</p>
          {group.rows.map((session) => (
            <div className="dashboard-recent-row" key={session.key}>
              <time
                className="dashboard-recent-time"
                dateTime={new Date(session.startedAt).toISOString()}
              >
                {formatClock(session.startedAt)}
              </time>
              <strong className="dashboard-recent-title">{session.title}</strong>
              <span className="dashboard-recent-duration">
                {formatDurationText(session.durationMs, { seconds: true })}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DayLedgerTimeline({
  ledger,
  records,
  tasks,
}: {
  ledger: DayLedgerAnalytics | undefined;
  records: readonly CachedBundle[];
  tasks: readonly SyncedTask[] | null;
}) {
  const [selectedIntervalKey, setSelectedIntervalKey] = useState<string | null>(null);
  const intervalEntries = (ledger?.intervals ?? []).map((interval) => {
    const details = resolveMobileTimelineTasks(interval, records, tasks);
    return {
      interval,
      details,
      key: timelineIntervalKey(interval),
      label: `${intervalLabel(interval)}；${details
        .map((detail) => `${detail.title}（${timelineTaskStateLabel(detail.state)}）`)
        .join('、')}`,
    };
  });
  const span = ledger ? Math.max(1, ledger.dayEndedAt - ledger.dayStartedAt) : 1;
  const observation =
    ledger?.observationStartedAt === null || ledger?.observationStartedAt === undefined
      ? '尚未形成观察区间'
      : `${formatClock(ledger.observationStartedAt)}–${formatClock(ledger.observationEndedAt)}`;
  const timelineLabel = ledger
    ? `${ledger.date} 全天时间轴，00:00 至 24:00 完整统计；${ledger.intervals.map(intervalLabel).join('；') || observation}`
    : '尚无共享日账本数据';
  const hourTicks = Array.from({ length: 25 }, (_, hour) => hour);
  const nowPosition = ledger?.isToday
    ? Math.min(100, Math.max(0, ((ledger.observationEndedAt - ledger.dayStartedAt) / span) * 100))
    : null;
  return (
    <section className="dashboard-band mobile-ledger-band" aria-labelledby="mobile-ledger-title">
      <AnalyticsHeading id="mobile-ledger-title" title="24 小时时间轴" detail={observation} />
      {ledger ? (
        <div className="mobile-day-ledger" aria-label={timelineLabel}>
          <div className="mobile-day-map-scroll" tabIndex={0} aria-label="横向查看 24 小时">
            <div className="mobile-day-map">
              <div className="mobile-day-periods" aria-hidden="true">
                {DAY_PERIODS.map((period, index) => (
                  <span
                    key={`${period.label}-${index}`}
                    style={{
                      left: `${(period.startHour / 24) * 100}%`,
                      width: `${((period.endHour - period.startHour) / 24) * 100}%`,
                    }}
                  >
                    {period.label}
                  </span>
                ))}
              </div>
              <div className="mobile-day-map-axis" aria-hidden="true">
                {hourTicks.map((hour) => (
                  <span
                    key={hour}
                    className={hour % 6 === 0 ? 'major' : hour % 2 === 0 ? 'labelled' : ''}
                    style={{ left: `${(hour / 24) * 100}%` }}
                  >
                    {hour % 2 === 0 ? String(hour).padStart(2, '0') : ''}
                  </span>
                ))}
              </div>
              <div className="mobile-day-map-grid" aria-hidden="true">
                {hourTicks.slice(0, 24).map((hour) => (
                  <i key={hour} className={hour < 7 || hour >= 22 ? 'night' : 'day'} />
                ))}
              </div>
              {(['focus', 'pause', 'gap'] as const).map((kind) => {
                const entries = intervalEntries.filter((entry) => entry.interval.kind === kind);
                const totalMs = entries.reduce(
                  (total, entry) => total + entry.interval.durationMs,
                  0,
                );
                return (
                  <div className={`mobile-day-lane ${kind}`} key={kind}>
                    <span className="mobile-day-lane-label">
                      <strong>
                        {kind === 'focus' ? '专注' : kind === 'pause' ? '暂停' : '空档'}
                      </strong>
                      <small>{formatLaneDuration(totalMs)}</small>
                    </span>
                    {/* 车道条带是下方「时间段明细入口」按钮列表的指针快捷方式；对辅助技术隐藏，
                        避免暴露一个没有名称、无法聚焦却可点击的区域。 */}
                    <div
                      className="mobile-day-lane-track"
                      aria-hidden="true"
                      onClick={(event) =>
                        selectTimelineIntervalAt(
                          event,
                          entries,
                          ledger.dayStartedAt,
                          span,
                          setSelectedIntervalKey,
                        )
                      }
                    >
                      {entries.map(({ interval, key, label }) => {
                        const width = (interval.durationMs / span) * 100;
                        return (
                          <span
                            key={key}
                            className={`ledger-interval ${interval.kind} ${selectedIntervalKey === key ? 'is-selected' : ''}`}
                            title={label}
                            aria-hidden="true"
                            style={{
                              left: `${((interval.startedAt - ledger.dayStartedAt) / span) * 100}%`,
                              width: `${Math.max(0.22, width)}%`,
                            }}
                          >
                            {width >= 5 && <small>{formatClock(interval.startedAt)}</small>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {nowPosition !== null && (
                <div className="mobile-day-now-layer" aria-hidden="true">
                  <i className="mobile-day-now" style={{ left: `${nowPosition}%` }}>
                    <span>{formatClock(ledger.observationEndedAt)}</span>
                  </i>
                </div>
              )}
            </div>
          </div>
          {intervalEntries.length > 0 && (
            <div className="mobile-timeline-interval-list" role="group" aria-label="时间段明细入口">
              {intervalEntries.map(({ interval, key, label, details }) => (
                <button
                  type="button"
                  key={key}
                  className={`timeline-interval-choice ${interval.kind}`}
                  aria-label={label}
                  aria-pressed={selectedIntervalKey === key}
                  onClick={() => setSelectedIntervalKey(key)}
                >
                  <i aria-hidden="true" />
                  <span>
                    {formatClock(interval.startedAt)}–{formatClock(interval.endedAt)}
                  </span>
                  <small>{details.map(formatTimelineTaskDetail).join('；')}</small>
                </button>
              ))}
            </div>
          )}
          {selectedIntervalKey &&
            (() => {
              const selected = intervalEntries.find((entry) => entry.key === selectedIntervalKey);
              if (!selected) return null;
              return (
                <TimelineIntervalDetail
                  interval={selected.interval}
                  details={selected.details}
                  onClose={() => setSelectedIntervalKey(null)}
                />
              );
            })()}
          <div className="chart-legend mobile-ledger-legend" aria-hidden="true">
            <span className="legend-focus">专注</span>
            <span className="legend-pause">暂停</span>
            <span className="legend-gap">空档</span>
            <span className="legend-sleep">夜间时段</span>
          </div>
        </div>
      ) : (
        <p className="analytics-empty">尚无共享日账本数据。</p>
      )}
      <p className="dashboard-ledger-caption">
        每格 1 小时；专注、暂停、空档共用 00:00–24:00 比例，夜间底色不计入空档。
      </p>
    </section>
  );
}

function formatTimelineTaskDetail(detail: MobileTimelineTaskDetail): string {
  return `${detail.title}，${timelineTaskStateLabel(detail.state)}`;
}

function timelineIntervalKey(interval: DayLedgerInterval): string {
  return `${interval.kind}-${interval.startedAt}-${interval.endedAt}`;
}

function selectTimelineIntervalAt(
  event: MouseEvent<HTMLDivElement>,
  entries: ReadonlyArray<{ interval: DayLedgerInterval; key: string }>,
  dayStartedAt: number,
  span: number,
  select: (key: string) => void,
): void {
  const bounds = event.currentTarget.getBoundingClientRect();
  if (bounds.width <= 0) return;
  const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
  const timestamp = dayStartedAt + ratio * span;
  const selectedInterval = mobileTimelineIntervalAt(
    entries.map((entry) => entry.interval),
    timestamp,
  );
  const selected = entries.find((entry) => entry.interval === selectedInterval);
  if (selected) select(selected.key);
}

function timelineTaskStateLabel(state: MobileTimelineTaskDetail['state']): string {
  switch (state) {
    case 'completed':
      return '任务已完成';
    case 'pending':
      return '任务待办';
    case 'missing':
      return '任务已不在当前清单';
    case 'unknown':
      return '任务状态待同步';
    case 'unlinked':
      return '未关联任务';
    case 'not-applicable':
      return '不适用';
  }
}

function TimelineIntervalDetail({
  interval,
  details,
  onClose,
}: {
  interval: DayLedgerInterval;
  details: readonly MobileTimelineTaskDetail[];
  onClose: () => void;
}) {
  const kind = interval.kind === 'focus' ? '专注' : interval.kind === 'pause' ? '暂停' : '空档';
  return (
    <aside className={`mobile-timeline-detail ${interval.kind}`} aria-label="时间段详情">
      <div className="mobile-timeline-detail-heading">
        <div>
          <span>{kind}时间段</span>
          <strong>
            {formatClockWithDate(interval.startedAt)}–{formatClockWithDate(interval.endedAt)}
          </strong>
        </div>
        <button type="button" className="icon-button" aria-label="关闭时间段详情" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <p className="mobile-timeline-detail-duration">
        持续 {formatDurationText(interval.durationMs)}
      </p>
      {details.length > 0 && (
        <ul className="mobile-timeline-task-details">
          {details.map((detail) => (
            <li key={detail.key}>
              <span>{detail.title}</span>
              <strong className={`task-state-${detail.state}`}>
                {timelineTaskStateLabel(detail.state)}
              </strong>
            </li>
          ))}
        </ul>
      )}
      <p className="mobile-timeline-detail-note">
        任务状态来自最近任务同步；专注记录结束不代表任务自动完成。
      </p>
    </aside>
  );
}

function SelectedDaySummary({
  ledger,
  onClear,
}: {
  ledger: DayLedgerAnalytics;
  onClear: () => void;
}) {
  const focus = ledger.totals.focusMs + ledger.totals.estimatedFocusMs;
  const pause = ledger.totals.pauseMs + ledger.totals.estimatedPauseMs;
  return (
    <div className="selected-day-summary" role="status" aria-live="polite">
      <div>
        <span>已选日期</span>
        <strong>{formatFullDate(ledger.date)}</strong>
      </div>
      <dl>
        <div>
          <dt>专注</dt>
          <dd>{formatDurationText(focus)}</dd>
        </div>
        <div>
          <dt>暂停</dt>
          <dd>{formatDurationText(pause)}</dd>
        </div>
        <div>
          <dt>空档</dt>
          <dd>{formatDurationText(ledger.totals.gapMs)}</dd>
        </div>
      </dl>
      <button type="button" className="selected-day-clear" onClick={onClear}>
        <X aria-hidden="true" />
        <span>返回范围</span>
      </button>
    </div>
  );
}

function formatLaneDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${hours >= 10 || Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)}h`;
}

function GapLedger({ ledger }: { ledger: DayLedgerAnalytics | undefined }) {
  return (
    <section className="dashboard-band mobile-gap-ledger" aria-labelledby="mobile-gap-title">
      <AnalyticsHeading
        id="mobile-gap-title"
        title="精确空档"
        detail={ledger?.date ?? '所选日期'}
      />
      {ledger && ledger.gaps.length > 0 ? (
        <ol>
          {ledger.gaps.map((gap) => (
            <li
              key={`${gap.startedAt}-${gap.endedAt}`}
              aria-label={`${formatClock(gap.startedAt)} 至 ${formatClock(gap.endedAt)}，空档 ${formatDurationText(gap.durationMs)}`}
            >
              <time>{formatClock(gap.startedAt)}</time>
              <i aria-hidden="true" />
              <time>{formatClock(gap.endedAt)}</time>
              <strong>{formatDurationText(gap.durationMs)}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <p role="status">{gapEmptyMessage(ledger)}</p>
      )}
    </section>
  );
}

function MobileTaskAllocation({ allocation }: { allocation: DashboardTaskAllocation }) {
  if (allocation.items.length === 0) {
    return <p className="analytics-empty">这个范围还没有可归类的任务投入。</p>;
  }
  return (
    <div className="mobile-task-allocation">
      <div
        className="mobile-task-allocation-track"
        role="img"
        aria-label={`任务专注时间构成，${allocation.items.map((item) => `${item.title} ${item.share}%`).join('，')}`}
      >
        {allocation.items.map((item) => (
          <i
            key={item.key}
            className={`tone-${item.tone}`}
            style={{ width: `${item.width}%`, '--allocation-alpha': item.alpha } as CSSProperties}
          />
        ))}
      </div>
      <div className="mobile-task-allocation-list">
        {allocation.items.map((item) => (
          <div className={`mobile-task-allocation-row tone-${item.tone}`} key={item.key}>
            <i style={{ '--allocation-alpha': item.alpha } as CSSProperties} />
            <strong>{item.title}</strong>
            <span>{item.share}%</span>
            <small>{formatDurationText(item.activeMs)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileTimeBudget({
  focusRate,
  pauseRate,
  gapRate,
  estimated,
}: {
  focusRate: number;
  pauseRate: number;
  gapRate: number;
  estimated: boolean;
}) {
  return (
    <section className="dashboard-pause-cost" aria-label="专注、暂停与空档时间守恒">
      <header className="analytics-heading">
        <h3>时间构成</h3>
        <span>专注 / 暂停 / 空档</span>
      </header>
      <div
        className="mobile-pause-cost-track"
        role="img"
        aria-label={`已分类时间${estimated ? '，含估算旧记录' : ''}：专注 ${focusRate}%，暂停 ${pauseRate}%，空档 ${gapRate}%`}
      >
        <i className="focus" style={{ width: `${focusRate}%` }} />
        <i className="pause" style={{ left: `${focusRate}%`, width: `${pauseRate}%` }} />
        <i className="gap" style={{ left: `${focusRate + pauseRate}%`, width: `${gapRate}%` }} />
      </div>
      <ul className="mobile-pause-cost-legend">
        <li className="is-focus">
          <span>专注</span>
          <strong>{focusRate}%</strong>
        </li>
        <li className="is-pause">
          <span>暂停</span>
          <strong>{pauseRate}%</strong>
        </li>
        <li>
          <span>空档</span>
          <strong>{gapRate}%</strong>
        </li>
      </ul>
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" role="status" aria-live="polite">
      <span className="sr-only">正在读取统计缓存</span>
      <i />
      <i />
      <i />
    </div>
  );
}

function gapEmptyMessage(ledger: DayLedgerAnalytics | undefined): string {
  if (!ledger) return '尚无共享日账本数据。';
  if (ledger.status === 'estimated-only') return '旧记录缺少精确边界，只显示估算时长。';
  if (ledger.status === 'not-started') {
    return ledger.isToday ? '今日尚未启动，不把全天计算为空档。' : '当日没有真实专注起点。';
  }
  return '观察区间内没有空档。';
}

function intervalLabel(interval: DayLedgerInterval): string {
  const kind = interval.kind === 'focus' ? '专注' : interval.kind === 'pause' ? '暂停' : '空档';
  return `${kind} ${formatClock(interval.startedAt)}–${formatClock(interval.endedAt)}，${formatDurationText(interval.durationMs)}`;
}

function sessionOverlaps(record: CachedBundle, bounds: { start: number; end: number }): boolean {
  const { session } = record.bundle;
  const end = session.endedAt ?? session.startedAt + Math.max(1, session.wallElapsedMs);
  return session.startedAt < bounds.end && end > bounds.start;
}

function sessionSortKey(session: CachedBundle['bundle']['session']): number {
  return session.endedAt ?? session.startedAt + Math.max(1, session.wallElapsedMs);
}

function sessionTitle(record: CachedBundle): string {
  const { session, segments } = record.bundle;
  const title =
    session.defaultTaskTitle ??
    segments.find((segment) => segment.title)?.title ??
    segments[0]?.title ??
    null;
  return title && title.trim().length > 0 ? title.trim() : '未命名专注';
}

function sessionDayLabel(timestamp: number): string {
  const today = new Date();
  const target = new Date(timestamp);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfTarget = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  ).getTime();
  const diffDays = Math.round((startOfToday - startOfTarget) / 86_400_000);
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  return formatMonthDay(dayKey(timestamp));
}

function rangeNoun(range: DashboardRangeChoice): string {
  switch (range) {
    case 'today':
      return '今日';
    case 'yesterday':
      return '昨日';
    case '7d':
      return '近 7 天';
    case 'previous-7d':
      return '上个 7 天';
    case '30d':
      return '近 30 天';
    case 'previous-30d':
      return '上个 30 天';
    case 'custom':
      return '自定义范围';
  }
}

function formatRangeLabel(start: number, end: number, range: DashboardRangeChoice): string {
  if (range === 'today' || range === 'yesterday') return formatFullDate(dayKey(start));
  return `${formatMonthDay(dayKey(start))} — ${formatMonthDay(dayKey(end - 1))}`;
}

function formatRangeCaption(
  bounds: { start: number; end: number },
  selectedDate: string | null,
): string {
  if (selectedDate) return `${formatFullDate(selectedDate)} · 单日`;
  const start = dayKey(bounds.start);
  const end = dayKey(bounds.end - 1);
  if (start === end) return formatFullDate(start);
  return `${formatMonthDay(start)} — ${formatMonthDay(end)}`;
}

function formatMonthDay(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

function formatWeekday(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(
    new Date(year, month - 1, day),
  );
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatClockWithDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${formatClock(timestamp)}`;
}

function formatFullDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(year, month - 1, day));
}
