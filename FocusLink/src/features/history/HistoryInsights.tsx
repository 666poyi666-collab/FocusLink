// 统计工作台 v4：固定 12 栅格卡贴画卷、自适应高光防蓝光溢出、5 大核心卡片。
// 涵盖今日心流全景仪表、24h精力节律分布、清单分类占比、重点任务排行、24周心流热力矩阵。
import { useMemo, useState, type CSSProperties } from 'react';
import type { SessionAnalyticsDaily, SessionAnalyticsResult } from '@shared/ipc/api';
import type {
  DayLedgerAnalytics,
  DayLedgerInterval,
  DayLedgerTask,
} from '@shared/dayLedgerAnalytics';
import {
  buildDashboardTaskAllocation,
  formatDashboardDuration,
} from '@shared/dashboardPresentation';
import { formatClock, formatMinutes } from '../../lib/time';
import {
  ALLOCATION_COLORS,
  HEATMAP_WEEKS,
  ledgerTotalsOf,
  mergeLedgerTasks,
} from './statsLedgerModel';
import {
  isSameLocalDay,
  type RangePreset,
  type SessionSummary,
  type TimeRange,
} from './historyStats';

interface HistoryInsightsProps {
  summary: SessionSummary;
  range: TimeRange;
  analytics: SessionAnalyticsResult | null;
  slideDirection: -1 | 0 | 1;
  onSelectRange: (preset: RangePreset) => void;
  onOpenSession?: (sessionId: string) => void;
  /** 标题栏全局搜索框的关键词：只过滤重点任务排行（原型 handleSearch 口径）。 */
  taskQuery?: string;
}

const DAY_MS = 24 * 60 * 60_000;
const MINUTE = 60_000;
const DAY_PERIODS = [
  { label: '深夜', startHour: 0, endHour: 7 },
  { label: '上午', startHour: 7, endHour: 12 },
  { label: '下午', startHour: 12, endHour: 18 },
  { label: '晚间', startHour: 18, endHour: 22 },
  { label: '深夜', startHour: 22, endHour: 24 },
] as const;

function duration(ms: number): string {
  return formatMinutes(Math.max(0, ms));
}

function axisDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${hours >= 10 || Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)}h`;
}

/** Recorded values must remain visible even when viewport observation or animation is suspended. */
function StatValue({ value, format }: { value: number; format: (current: number) => string }) {
  return <>{format(value)}</>;
}

export function HistoryInsights({
  summary,
  range,
  analytics,
  slideDirection,
  onOpenSession,
  taskQuery,
}: HistoryInsightsProps) {
  const singleDay = isSameLocalDay(range.start, range.end - 1);
  const isToday = singleDay && isSameLocalDay(range.start, Date.now());
  const dayLedgers = useMemo(() => analytics?.dayLedgers ?? [], [analytics?.dayLedgers]);
  const selectedLedger = singleDay
    ? (dayLedgers.find(
        (item) => item.dayStartedAt === new Date(range.start).setHours(0, 0, 0, 0),
      ) ?? dayLedgers[0])
    : dayLedgers.at(-1);

  const ledgerTotals = ledgerTotalsOf(dayLedgers);

  const dashboardFocus = ledgerTotals.focusMs + ledgerTotals.estimatedFocusMs;
  const dashboardPause = ledgerTotals.pauseMs + ledgerTotals.estimatedPauseMs;

  const effectiveTasks = useMemo(() => mergeLedgerTasks(dayLedgers), [dayLedgers]);

  const activeDays = dayLedgers.filter(
    (ledger) => ledger.totals.focusMs + ledger.totals.estimatedFocusMs > 0,
  ).length;

  // 计算连续打卡天数
  const streakDays = useMemo(() => {
    if (!analytics?.daily || analytics.daily.length === 0) return activeDays > 0 ? activeDays : 0;
    let streak = 0;
    for (let i = analytics.daily.length - 1; i >= 0; i--) {
      if (analytics.daily[i].activeMs > 0) {
        streak++;
      } else {
        if (streak > 0) break;
      }
    }
    return streak || (activeDays > 0 ? activeDays : 0);
  }, [analytics?.daily, activeDays]);

  // 计算较昨日增减
  const yesterdayDiff = useMemo(() => {
    if (!analytics?.daily || analytics.daily.length < 2) return null;
    const todayDaily = analytics.daily[analytics.daily.length - 1];
    const yestDaily = analytics.daily[analytics.daily.length - 2];
    if (!todayDaily || !yestDaily) return null;
    return todayDaily.activeMs - yestDaily.activeMs;
  }, [analytics?.daily]);

  // 今日目标（默认 5 小时）
  const targetMs = singleDay ? 5 * 3600_000 : Math.max(1, dayLedgers.length) * 5 * 3600_000;
  const targetRate = Math.min(100, Math.round((dashboardFocus / targetMs) * 100));

  // 纯度计算
  const purity =
    dashboardFocus + dashboardPause > 0
      ? ((dashboardFocus / (dashboardFocus + dashboardPause)) * 100).toFixed(1)
      : '100.0';

  // 鼠标移动高光跟随
  const handleCardMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.style.setProperty('--mouse-x', `${x}px`);
    e.currentTarget.style.setProperty('--mouse-y', `${y}px`);
  };

  return (
    <section
      className="history-insights stats-dashboard"
      aria-label="专注统计 Dashboard"
      style={{ '--stats-shift': `${slideDirection * 7}px` } as CSSProperties}
    >
      {/* 🌟 固定 12 栅格卡贴工作台画卷 (The 5 Fixed Masterclass Cards)
          无数据时同样渲染完整画卷骨架（不再切换到「0 分钟」那一套空态页面）：
          零数据由各卡贴自己的空状态表达，页面结构与原型 100% 对齐。 */}
      <div className="stats-dashboard-grid" id="statsDashboardGrid">
        {/* 卡贴一：今日心流全景仪表 (THE FOCUS HERO CARD) */}
        <HeroFocusCard
          singleDay={singleDay}
          isToday={isToday}
          selectedLedger={selectedLedger}
          dashboardFocus={dashboardFocus}
          dashboardPause={dashboardPause}
          targetMs={targetMs}
          targetRate={targetRate}
          yesterdayDiff={yesterdayDiff}
          summaryCount={summary.count}
          purity={purity}
          effectiveTasks={effectiveTasks}
          streakDays={streakDays}
          estimatedFocusMs={ledgerTotals.estimatedFocusMs}
          onMouseMove={handleCardMouseMove}
        />

        {/* 卡贴二：24 小时精力节律时钟分布 (24h Chronological Rhythm) */}
        <div
          className="card-widget dashboard-card-tile span-12 section-panel anim-in-2"
          id="tileRhythm"
          onMouseMove={handleCardMouseMove}
        >
          {singleDay && selectedLedger ? (
            <DayActivityTimeline ledger={selectedLedger} onOpenSession={onOpenSession} />
          ) : (
            <DailyActivityChart daily={dayLedgers} />
          )}
        </div>

        {/* 卡贴三：清单分类投入占比 (Donut Allocation) */}
        <div
          className="card-widget dashboard-card-tile span-5 section-panel anim-in-3"
          id="tileDonut"
          onMouseMove={handleCardMouseMove}
        >
          <DonutAllocationCard tasks={effectiveTasks} totalActive={dashboardFocus} />
        </div>

        {/* 卡贴四：重点任务专注排行榜 (Top Focused Tasks) */}
        <div
          className="card-widget dashboard-card-tile span-7 section-panel anim-in-4"
          id="tileRanking"
          onMouseMove={handleCardMouseMove}
        >
          <TopTasksLeaderboard tasks={effectiveTasks} query={taskQuery} />
        </div>

        {/* 卡贴五：心流活跃热力 (24 周心流矩阵 (近半年)) */}
        <div
          className="card-widget dashboard-card-tile span-12 section-panel"
          id="tileHeatmap"
          onMouseMove={handleCardMouseMove}
        >
          <FlowHeatmapCard daily={analytics?.daily ?? []} />
        </div>
      </div>
    </section>
  );
}

/** 🌟 卡贴一：今日心流全景仪表 (THE FOCUS HERO CARD) */
function HeroFocusCard({
  singleDay,
  isToday,
  selectedLedger,
  dashboardFocus,
  dashboardPause,
  targetMs,
  targetRate,
  yesterdayDiff,
  summaryCount,
  purity,
  effectiveTasks,
  streakDays,
  estimatedFocusMs,
  onMouseMove,
}: {
  singleDay: boolean;
  isToday: boolean;
  selectedLedger?: DayLedgerAnalytics;
  dashboardFocus: number;
  dashboardPause: number;
  targetMs: number;
  targetRate: number;
  yesterdayDiff: number | null;
  summaryCount: number;
  purity: string;
  effectiveTasks: DayLedgerTask[];
  streakDays: number;
  estimatedFocusMs: number;
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const arcLength = 251.3;
  const strokeOffset = arcLength * (1 - targetRate / 100);

  // 时序谱带区间计算 (默认 08:00 - 22:00 = 14h)
  const intervals = selectedLedger?.intervals ?? [];
  const baseStartHour = 8;
  const baseEndHour = 22;
  const dayStart = selectedLedger?.dayStartedAt ?? new Date().setHours(0, 0, 0, 0);

  // 检查是否有区间超出 08:00-22:00
  const hasEarly = intervals.some((i) => i.startedAt < dayStart + baseStartHour * 3600_000);
  const hasLate = intervals.some((i) => i.endedAt > dayStart + baseEndHour * 3600_000);
  const spanStartMs = hasEarly ? 0 : baseStartHour * 3600_000;
  const spanEndMs = hasLate ? 24 * 3600_000 : baseEndHour * 3600_000;
  const totalSpan = Math.max(1, spanEndMs - spanStartMs);

  const linkedTasks = effectiveTasks.filter((t) => t.taskId !== null);

  return (
    <div
      className="card-widget dashboard-card-tile span-12 hero-focus-card anim-in-1"
      id="tileHero"
      onMouseMove={onMouseMove}
    >
      <div className="hero-top-grid">
        <div className="hero-focus-gauge-box">
          <div className="hero-dial-wrap" title={`目标达成率：${targetRate}%`}>
            <svg
              viewBox="0 0 100 100"
              className="hero-dial-svg"
              style={{ width: '96px', height: '96px', transform: 'rotate(-90deg)' }}
            >
              <circle cx="50" cy="50" r="40" fill="none" stroke="var(--bg-hover)" strokeWidth="8" />
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="8"
                strokeLinecap="round"
                id="heroDialArc"
                strokeDasharray="251.3"
                strokeDashoffset={strokeOffset}
                style={{
                  transition: 'stroke-dashoffset 0.85s cubic-bezier(0.16, 1, 0.3, 1)',
                  filter: 'drop-shadow(0 2px 6px var(--accent-soft))',
                }}
              />
            </svg>
            <div className="dial-center-content">
              <span className="dial-rate-big" id="heroRateText">
                {targetRate}%
              </span>
              <span className="dial-rate-lbl">达成率</span>
            </div>
          </div>

          <div className="hero-dial-details">
            <span className="hero-stat-badge">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                style={{ width: '11px', height: '11px' }}
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {singleDay ? (isToday ? '今日累计专注' : '当日有效专注') : '范围内有效专注'}
            </span>
            <div className="hero-time-massive" id="heroTimeValWrap">
              <StatValue value={dashboardFocus} format={formatDashboardDuration} />
            </div>
            <div className="hero-target-row" id="heroTargetVal">
              / 目标 {axisDuration(targetMs)}
            </div>
            {yesterdayDiff !== null ? (
              <div
                className={`hero-delta-pill ${yesterdayDiff >= 0 ? 'positive' : 'negative'}`}
                id="heroDiffText"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  style={{ width: '11px', height: '11px' }}
                >
                  <polyline points={yesterdayDiff >= 0 ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
                </svg>
                较昨日 {yesterdayDiff >= 0 ? '+' : '-'}
                {duration(Math.abs(yesterdayDiff))}
              </div>
            ) : (
              <div className="hero-delta-pill positive" id="heroDiffText">
                完成 {summaryCount} 轮
              </div>
            )}
            {/* 指标口径只保留原型的三个胶囊；旧版估算说明并入卡贴一，不再单开一整行指标带。 */}
            {estimatedFocusMs > 0 && <div className="hero-estimated-note">含 estimated 旧记录</div>}
          </div>
        </div>

        {/* 连续时序谱带 (纯净纯色专注与柔和暂停，严禁彩虹跳色) */}
        <div className="hero-spectrum-box">
          <div className="spectrum-head">
            <span className="spectrum-title">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ width: '13px', height: '13px', color: 'var(--accent)' }}
              >
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              {hasEarly || hasLate
                ? '全天时序谱带 (00:00 - 24:00)'
                : '今日时序谱带 (08:00 - 22:00)'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="spectrum-legend">
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '2px',
                      background: 'var(--accent)',
                    }}
                  />{' '}
                  专注
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '2px',
                      background: 'var(--pause-color)',
                    }}
                  />{' '}
                  暂停
                </span>
              </div>
            </div>
          </div>

          <div className="spectrum-bar-wrap" id="spectrumBar">
            {intervals.map((interval, idx) => {
              if (interval.kind === 'gap') return null;
              const relStart = interval.startedAt - (dayStart + spanStartMs);
              const leftPct = Math.max(0, Math.min(100, (relStart / totalSpan) * 100));
              const widthPct = Math.max(
                0.4,
                Math.min(100 - leftPct, (interval.durationMs / totalSpan) * 100),
              );
              const title = `${formatClock(interval.startedAt)} - ${formatClock(interval.endedAt)} ${interval.kind === 'focus' ? '专注' : '暂停'} (${duration(interval.durationMs)})`;
              return (
                <div
                  key={`${interval.kind}-${interval.startedAt}-${idx}`}
                  className={`spectrum-block ${interval.kind}`}
                  style={{ left: `${leftPct.toFixed(2)}%`, width: `${widthPct.toFixed(2)}%` }}
                  title={title}
                >
                  {widthPct > 5 ? duration(interval.durationMs) : ''}
                </div>
              );
            })}
            {intervals.filter((i) => i.kind !== 'gap').length === 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  fontSize: '11px',
                  color: 'var(--text-tertiary)',
                }}
              >
                {isToday ? '今日尚未启动' : '当日尚无专注记录'}
              </div>
            )}
          </div>

          <div className="spectrum-ticks-row">
            {hasEarly || hasLate ? (
              <>
                <span>00:00</span>
                <span>04:00</span>
                <span>08:00</span>
                <span>12:00</span>
                <span>16:00</span>
                <span>20:00</span>
                <span>24:00</span>
              </>
            ) : (
              <>
                <span>08:00</span>
                <span>10:00</span>
                <span>12:00</span>
                <span>14:00</span>
                <span>16:00</span>
                <span>18:00</span>
                <span>20:00</span>
                <span>22:00</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 下半区：三项关键质感指标胶囊 */}
      <div className="hero-bottom-capsules">
        <div className="hero-cap-item">
          <div className="cap-left">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ color: 'var(--success, #10B981)' }}
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>专注纯度</span>
          </div>
          <span className="cap-val" style={{ color: 'var(--success, #10B981)' }} id="capPurity">
            {purity}% · 损耗 {duration(dashboardPause)}
          </span>
        </div>

        <div className="hero-cap-item">
          <div className="cap-left">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ color: 'var(--accent)' }}
            >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <span>推进任务</span>
          </div>
          <span className="cap-val" id="capTasks">
            {effectiveTasks.length} 个 (已关联 {linkedTasks.length} 项)
          </span>
        </div>

        <div className="hero-cap-item">
          <div className="cap-left">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ color: 'var(--warning, #F59E0B)' }}
            >
              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
            </svg>
            <span>连续打卡</span>
          </div>
          <span className="cap-val" style={{ color: 'var(--warning, #F59E0B)' }} id="capStreak">
            {streakDays} 天
          </span>
        </div>
      </div>
    </div>
  );
}

/** 🌟 卡贴三：清单分类投入占比 (Donut Allocation) */
function DonutAllocationCard({
  tasks,
  totalActive,
}: {
  tasks: DayLedgerTask[];
  totalActive: number;
}) {
  const allocation = useMemo(
    () => buildDashboardTaskAllocation(tasks, totalActive),
    [tasks, totalActive],
  );

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // 与统计侧栏「清单分类」色点共用同一调色板（statsLedgerModel.ALLOCATION_COLORS）。
  const colors = ALLOCATION_COLORS;
  const circumference = 238.76; // 2 * PI * 38

  // 计算环形图 segment
  let currentOffset = 0;
  const segments = allocation.items.map((item, index) => {
    const dashLength = (item.share / 100) * circumference;
    const strokeDasharray = `${dashLength.toFixed(1)} ${(circumference - dashLength).toFixed(1)}`;
    const strokeDashoffset = -currentOffset;
    currentOffset += dashLength;
    return {
      ...item,
      color: colors[index % colors.length],
      strokeDasharray,
      strokeDashoffset,
    };
  });

  const activeItem = hoveredIndex !== null ? segments[hoveredIndex] : null;

  return (
    <>
      <div className="section-head">
        <div className="section-title-wrap">
          <h3>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ width: '15px', height: '15px', color: 'var(--accent)' }}
            >
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
              <path d="M22 12A10 10 0 0 0 12 2v10z" />
            </svg>
            清单分类投入占比
          </h3>
          <p>掌握不同任务与清单的时间分配与精力沉淀</p>
        </div>
      </div>

      <div className="donut-alloc-body">
        <div className="donut-top-display">
          <div className="donut-svg-wrap">
            <svg
              viewBox="0 0 100 100"
              width="135"
              height="135"
              style={{ transform: 'rotate(-90deg)' }}
            >
              <circle
                cx="50"
                cy="50"
                r="38"
                fill="transparent"
                stroke="var(--bg-hover)"
                strokeWidth="11"
              />
              {segments.map((seg, idx) => (
                <circle
                  key={seg.key}
                  cx="50"
                  cy="50"
                  r="38"
                  fill="transparent"
                  stroke={seg.color}
                  strokeWidth="11"
                  strokeDasharray={seg.strokeDasharray}
                  strokeDashoffset={seg.strokeDashoffset}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{ transition: 'all .2s ease', cursor: 'pointer' }}
                />
              ))}
            </svg>
            <div className="donut-center-metric" id="donutCenterBox">
              <span className="d-big" id="donutCenterVal">
                {activeItem
                  ? duration(activeItem.activeMs)
                  : `${(totalActive / 3600_000).toFixed(1)}h`}
              </span>
              <span className="d-lbl" id="donutCenterLbl">
                {activeItem ? activeItem.title : '总专注投入'}
              </span>
            </div>
          </div>
        </div>

        <div className="alloc-list">
          {segments.map((seg, idx) => (
            <div
              className="alloc-row"
              key={seg.key}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <div className="alloc-row-main">
                <div className="alloc-left">
                  <span className="alloc-color-dot" style={{ background: seg.color }} />
                  <span title={seg.title}>{seg.title}</span>
                </div>
                <div className="alloc-right">
                  <span className="alloc-dur">{duration(seg.activeMs)}</span>
                  <span className="alloc-pct-tag">{seg.share}%</span>
                </div>
              </div>
              <div className="alloc-micro-bar-track">
                <div
                  className="alloc-micro-bar-fill"
                  style={{ width: `${seg.share}%`, background: seg.color }}
                />
              </div>
            </div>
          ))}
          {segments.length === 0 && <p className="stats-caption">还没有可归类的任务投入时间。</p>}
        </div>
      </div>
    </>
  );
}

/** 🌟 卡贴四：重点任务专注排行榜 (Top Focused Tasks) */
function TopTasksLeaderboard({ tasks, query }: { tasks: DayLedgerTask[]; query?: string }) {
  const keyword = (query ?? '').trim().toLowerCase();
  // 标题栏搜索框口径对齐原型 handleSearch：命中任务标题或状态胶囊文案。
  const matched = keyword
    ? tasks.filter((task) => {
        const category = task.taskId !== null ? '已关联任务' : '未关联任务';
        return (
          task.title.toLowerCase().includes(keyword) || category.toLowerCase().includes(keyword)
        );
      })
    : tasks;
  const topTasks = matched.slice(0, 5);
  const maxMs = topTasks[0]?.activeMs || 1;

  return (
    <>
      <div className="section-head">
        <div className="section-title-wrap">
          <h3>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ width: '15px', height: '15px', color: 'var(--accent)' }}
            >
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            重点任务专注排行 (Top Focused Tasks)
          </h3>
          <p>周期内投入精力最多的关键事务 · 相对时长可视化</p>
        </div>
      </div>

      <div className="leaderboard-container">
        {topTasks.map((task, idx) => {
          const rankNum = String(idx + 1).padStart(2, '0');
          const pct = Math.round((task.activeMs / maxMs) * 100);
          const isLinked = task.taskId !== null;
          const category = isLinked ? '已关联任务' : '未关联任务';

          return (
            <div className="task-rank-card" key={task.key}>
              <div className="tr-top-row">
                <div className="tr-left">
                  <span className="tr-rank-num">{rankNum}</span>
                  <span className="tr-title" title={task.title}>
                    {task.title}
                  </span>
                  <span className="tr-cat-pill">{category}</span>
                </div>
                <div className="tr-right">
                  <span className="tr-time">{duration(task.activeMs)}</span>
                  <span className={`tr-status-pill ${isLinked ? 'done' : ''}`}>
                    {isLinked ? '✓ 已关联' : '未关联'}
                  </span>
                </div>
              </div>
              <div className="tr-bar-track">
                <div
                  className="tr-bar-fill"
                  style={{ width: `${pct}%`, background: 'var(--accent)' }}
                />
              </div>
            </div>
          );
        })}
        {topTasks.length === 0 && (
          <p className="stats-caption">
            {keyword ? `没有匹配「${query}」的任务投入记录。` : '周期内暂无任务专注记录。'}
          </p>
        )}
      </div>
    </>
  );
}

/** 🌟 卡贴五：心流活跃热力 (24 周心流矩阵 (近半年)) */
function FlowHeatmapCard({ daily }: { daily: SessionAnalyticsDaily[] }) {
  // 生成最近 168 天矩阵数据（HEATMAP_WEEKS = 24，与统计侧栏「心流热力全景」同一常量）
  const matrix = useMemo(() => {
    const map = new Map<string, { activeMs: number; sessionCount: number }>();
    for (const d of daily) {
      map.set(d.date, { activeMs: d.activeMs, sessionCount: d.sessionCount });
    }

    const today = new Date();
    const cols: Array<
      Array<{ date: string; activeMs: number; sessionCount: number; level: number }>
    > = [];

    // 计算起始日（保证最后一列的最后一天是今天或本周末）
    const dayOfWeek = today.getDay(); // 0 is Sun, 1 is Mon...
    const endOffset = (7 - dayOfWeek) % 7;
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + endOffset);

    for (let w = HEATMAP_WEEKS - 1; w >= 0; w--) {
      const colDays: Array<{
        date: string;
        activeMs: number;
        sessionCount: number;
        level: number;
      }> = [];
      for (let d = 0; d < 7; d++) {
        const curDate = new Date(endDate);
        const dayIdx = w * 7 + (6 - d);
        curDate.setDate(endDate.getDate() - dayIdx);
        const dateStr = curDate.toISOString().slice(0, 10);
        const match = map.get(dateStr) ?? { activeMs: 0, sessionCount: 0 };
        const mins = Math.round(match.activeMs / MINUTE);

        let level = 0;
        if (mins > 240) level = 4;
        else if (mins > 120) level = 3;
        else if (mins > 60) level = 2;
        else if (mins > 0) level = 1;

        colDays.push({
          date: dateStr,
          activeMs: match.activeMs,
          sessionCount: match.sessionCount,
          level,
        });
      }
      cols.unshift(colDays);
    }
    return cols;
  }, [daily]);

  return (
    <>
      <div className="section-head">
        <div className="section-title-wrap">
          <h3>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ width: '15px', height: '15px', color: 'var(--accent)' }}
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            心流节律活动热力 (24 周心流矩阵 (近半年))
          </h3>
          <p>记录过去 168 天每一个自然日的心流密度 · 见证时间积累的力量</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="hm-legend-row">
            <span>较少</span>
            <div className="hm-leg-box" style={{ background: 'var(--heatmap-0)' }} />
            <div className="hm-leg-box" style={{ background: 'var(--heatmap-1)' }} />
            <div className="hm-leg-box" style={{ background: 'var(--heatmap-2)' }} />
            <div className="hm-leg-box" style={{ background: 'var(--heatmap-3)' }} />
            <div className="hm-leg-box" style={{ background: 'var(--heatmap-4)' }} />
            <span>充沛</span>
          </div>
        </div>
      </div>

      <div className="heatmap-container-flex">
        <div className="hm-day-labels">
          <span className="hm-day-lbl">周一</span>
          <span className="hm-day-lbl">周三</span>
          <span className="hm-day-lbl">周五</span>
          <span className="hm-day-lbl">周日</span>
        </div>
        <div className="heatmap-strip-wrap" id="heatmapStrip">
          {matrix.map((col, cIdx) => (
            <div
              className="hm-col"
              key={cIdx}
              style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}
            >
              {col.map((cell) => {
                const title = `${cell.date}: 专注 ${duration(cell.activeMs)}, ${cell.sessionCount} 轮`;
                return (
                  <div
                    key={cell.date}
                    className="hm-box"
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '2px',
                      background: `var(--heatmap-${cell.level})`,
                      transition: 'transform 0.15s ease',
                      cursor: 'pointer',
                    }}
                    title={title}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function DayActivityTimeline({
  ledger,
  onOpenSession,
}: {
  ledger?: DayLedgerAnalytics;
  onOpenSession?: (sessionId: string) => void;
}) {
  const span = ledger ? Math.max(1, ledger.dayEndedAt - ledger.dayStartedAt) : DAY_MS;
  const observationLabel =
    ledger?.observationStartedAt !== null && ledger?.observationStartedAt !== undefined
      ? `${formatClock(ledger.observationStartedAt)}–${ledger.observationEndedAt === ledger.dayEndedAt ? '24:00' : formatClock(ledger.observationEndedAt)}`
      : '尚未形成观察区间';
  const hourTicks = Array.from({ length: 25 }, (_, hour) => hour);
  const nowPosition = ledger?.isToday
    ? Math.min(100, Math.max(0, ((ledger.observationEndedAt - ledger.dayStartedAt) / span) * 100))
    : null;

  // 24 小时精力分布柱体数据
  const hourlyData = useMemo(() => {
    const list = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      focusMs: 0,
      pauseMs: 0,
    }));
    if (!ledger) return list;

    for (const interval of ledger.intervals) {
      if (interval.kind === 'gap') continue;
      const startHour = new Date(interval.startedAt).getHours();
      const endHour = new Date(interval.endedAt).getHours();
      for (let h = startHour; h <= Math.min(23, endHour); h++) {
        if (interval.kind === 'focus') {
          list[h].focusMs += interval.durationMs / Math.max(1, endHour - startHour + 1);
        } else if (interval.kind === 'pause') {
          list[h].pauseMs += interval.durationMs / Math.max(1, endHour - startHour + 1);
        }
      }
    }
    return list;
  }, [ledger]);

  // 五大自然时段统计
  const periodStats = useMemo(() => {
    const periods = [
      { name: '深夜时段', range: '0-7h', ms: 0 },
      { name: '黄金上午', range: '7-12h', ms: 0 },
      { name: '沉浸下午', range: '12-18h', ms: 0 },
      { name: '晚间收尾', range: '18-22h', ms: 0 },
      { name: '深夜休整', range: '22-24h', ms: 0 },
    ];
    for (const h of hourlyData) {
      if (h.hour < 7) periods[0].ms += h.focusMs;
      else if (h.hour < 12) periods[1].ms += h.focusMs;
      else if (h.hour < 18) periods[2].ms += h.focusMs;
      else if (h.hour < 22) periods[3].ms += h.focusMs;
      else periods[4].ms += h.focusMs;
    }
    return periods;
  }, [hourlyData]);

  return (
    <article className="stats-panel stats-rhythm-panel">
      <div className="section-head stats-panel-head">
        <div className="section-title-wrap">
          <h3 id="chartHeaderTitle">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ width: '16px', height: '16px', color: 'var(--accent)' }}
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            24 小时精力节律时钟分布 (Chronological Rhythm)
          </h3>
          <p id="chartHeaderSub">按小时呈现每个自然时段的专注与暂停沉淀，洞察全天精力高峰</p>
        </div>
        <div className="stats-ledger-float" role="status" aria-live="polite">
          <strong>{ledger?.date ?? '—'}</strong>
          <span>{observationLabel}</span>
        </div>
      </div>

      {/* 24 小时精力节律柱状图 */}
      <div className="rhythm-chart-box">
        <div className="rhythm-grid-lines">
          <div className="rhythm-grid-line rhythm-target-guide">
            <span className="rhythm-grid-tag" id="rhythmGridGuideTag">
              基准 45m/h
            </span>
          </div>
          <div className="rhythm-grid-line">
            <span className="rhythm-grid-tag">30m</span>
          </div>
          <div className="rhythm-grid-line">
            <span className="rhythm-grid-tag">15m</span>
          </div>
        </div>

        <div className="bars-row" id="rhythmBarContainer">
          {hourlyData.map((item) => {
            const focusMinutes = Math.round(item.focusMs / MINUTE);
            const pauseMinutes = Math.round(item.pauseMs / MINUTE);
            const focusPct = Math.min(100, (item.focusMs / (60 * MINUTE)) * 100);
            const pausePct = Math.min(100, (item.pauseMs / (60 * MINUTE)) * 100);
            const hasData = focusMinutes > 0 || pauseMinutes > 0;
            // 原型口径：标签文本为 HH:00，且只在 h%4==0 与 23 点显示（24 个全显示会互相压字）。
            const hourLabel = `${String(item.hour).padStart(2, '0')}:00`;
            const showHourLabel = item.hour % 4 === 0 || item.hour === 23;

            return (
              <div
                key={item.hour}
                className="bar-col"
                title={`${hourLabel}:00 - ${String(item.hour + 1).padStart(2, '0')}:00 专注 ${focusMinutes}m · 暂停 ${pauseMinutes}m`}
              >
                <div className="bar-track">
                  {hasData ? (
                    <>
                      {focusPct > 0 && (
                        <div
                          className="bar-fill focus"
                          style={{ height: `${focusPct}%`, background: 'var(--accent)' }}
                        />
                      )}
                      {pausePct > 0 && (
                        <div
                          className="bar-fill pause"
                          style={{ height: `${pausePct}%`, background: 'var(--pause-color)' }}
                        />
                      )}
                    </>
                  ) : (
                    <div className="bar-empty-dot" />
                  )}
                </div>
                <span className="bar-time-lbl">{showHourLabel ? hourLabel : ''}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 五大自然时段胶囊 */}
      <div className="period-capsule-row" id="periodRow">
        {periodStats.map((p, idx) => {
          const isMax = p.ms > 0 && p.ms === Math.max(...periodStats.map((x) => x.ms));
          return (
            <div key={idx} className={`period-cap-card ${isMax ? 'active' : ''}`}>
              <div className="period-cap-head">
                <span>{p.name}</span>
                <span>{p.range}</span>
              </div>
              <div
                className="period-cap-val"
                style={isMax ? { color: 'var(--accent)' } : undefined}
              >
                {duration(p.ms)}
              </div>
            </div>
          );
        })}
      </div>

      {/* 24 小时精准轨道地图 (保证无障碍、全量时间轴与既有断言兼容) */}
      {ledger ? (
        <div
          className="stats-ledger-chart hm-fade-in"
          style={{ '--hm-delay': '80ms', marginTop: '16px' } as CSSProperties}
          role="group"
          aria-label={`${ledger.date} 全天时间轴；00:00 至 24:00 完整统计`}
        >
          <div className="stats-day-map-scroll" aria-label="完整 24 小时时间地图">
            <div className="stats-day-map">
              <div className="stats-day-periods" aria-hidden="true">
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
              <div className="stats-day-map-axis" aria-hidden="true">
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
              <div className="stats-day-map-grid" aria-hidden="true">
                {hourTicks.slice(0, 24).map((hour) => (
                  <i key={hour} className={hour < 7 || hour >= 22 ? 'night' : 'day'} />
                ))}
              </div>
              <TimelineLane
                label="专注"
                tone="focus"
                intervals={ledger.intervals.filter((interval) => interval.kind === 'focus')}
                dayStart={ledger.dayStartedAt}
                span={span}
                onOpenSession={onOpenSession}
              />
              <TimelineLane
                label="暂停"
                tone="pause"
                intervals={ledger.intervals.filter((interval) => interval.kind === 'pause')}
                dayStart={ledger.dayStartedAt}
                span={span}
                onOpenSession={onOpenSession}
              />
              <TimelineLane
                label="空档"
                tone="gap"
                intervals={ledger.intervals.filter((interval) => interval.kind === 'gap')}
                dayStart={ledger.dayStartedAt}
                span={span}
                onOpenSession={onOpenSession}
              />
              {nowPosition !== null && (
                <div className="stats-day-now-layer" aria-hidden="true">
                  <i
                    className="stats-day-now"
                    style={{ left: `${nowPosition}%` }}
                    title={`当前 ${formatClock(ledger.observationEndedAt)}`}
                  >
                    <span>{formatClock(ledger.observationEndedAt)}</span>
                  </i>
                </div>
              )}
            </div>
          </div>
          <div className="stats-ledger-legend" aria-label="时间分类图例">
            <span className="focus">专注</span>
            <span className="pause">暂停</span>
            <span className="gap">空档</span>
            <span className="sleep">夜间时段</span>
          </div>
        </div>
      ) : (
        <div className="stats-timeline-empty" role="status">
          尚无共享日账本数据。
        </div>
      )}
      <p className="stats-caption">
        24 小时时间轴：三条轨道共用同一 00:00–24:00
        比例；夜间记录同样计入统计，空档从首段专注开始计算。
      </p>
    </article>
  );
}

function TimelineLane({
  label,
  tone,
  intervals,
  dayStart,
  span,
  onOpenSession,
}: {
  label: string;
  tone: DayLedgerInterval['kind'];
  intervals: DayLedgerInterval[];
  dayStart: number;
  span: number;
  onOpenSession?: (sessionId: string) => void;
}) {
  const totalMs = intervals.reduce((total, interval) => total + interval.durationMs, 0);
  return (
    <div className={`stats-day-lane ${tone}`}>
      <span className="stats-day-lane-label">
        <strong>{label}</strong>
        <small>{axisDuration(totalMs)}</small>
      </span>
      <div className="stats-day-lane-track">
        {intervals.map((interval, index) => (
          <LedgerBlock
            key={`${interval.kind}-${interval.startedAt}-${index}`}
            interval={interval}
            dayStart={dayStart}
            span={span}
            onOpenSession={onOpenSession}
          />
        ))}
      </div>
    </div>
  );
}

function LedgerBlock({
  interval,
  dayStart,
  span,
  onOpenSession,
}: {
  interval: DayLedgerInterval;
  dayStart: number;
  span: number;
  onOpenSession?: (sessionId: string) => void;
}) {
  const left = ((interval.startedAt - dayStart) / span) * 100;
  const width = (interval.durationMs / span) * 100;
  const label = `${interval.kind === 'focus' ? '专注' : interval.kind === 'pause' ? '暂停' : '空档'} ${formatClock(interval.startedAt)}–${formatClock(interval.endedAt)}，${duration(interval.durationMs)}`;
  const sessionId = interval.sessionIds[0];
  if (sessionId && interval.kind !== 'gap' && onOpenSession) {
    return (
      <button
        type="button"
        className={`stats-ledger-block ${interval.kind}`}
        style={{ left: `${left}%`, width: `${Math.max(0.2, width)}%` }}
        title={label}
        aria-label={`${label}；打开会话详情`}
        onClick={() => onOpenSession(sessionId)}
      >
        {width >= 3.5 && <span>{formatClock(interval.startedAt)}</span>}
      </button>
    );
  }
  return (
    <span
      className={`stats-ledger-block ${interval.kind}`}
      style={{ left: `${left}%`, width: `${Math.max(0.2, width)}%` }}
      title={label}
      aria-label={label}
    >
      {width >= 3.5 && <span>{formatClock(interval.startedAt)}</span>}
    </span>
  );
}

function DailyActivityChart({ daily }: { daily: DayLedgerAnalytics[] }) {
  const width = 720;
  const height = 210;
  const padX = 48;
  const padY = 24;
  const max = Math.max(
    1,
    ...daily.map((day) => day.totals.focusMs + day.totals.pauseMs + day.totals.gapMs),
  );
  const plotHeight = height - padY * 2;
  const plotWidth = width - padX * 2;
  const slotWidth = plotWidth / Math.max(1, daily.length);
  const barWidth = Math.max(5, Math.min(24, slotWidth * 0.58));

  return (
    <article className="stats-panel stats-trend-panel">
      <div className="stats-panel-head">
        <div>
          <span>每日趋势</span>
          <h3>投入是否持续</h3>
        </div>
        <div className="stats-legend">
          <i />
          专注 <i className="pause" />
          暂停 <i className="gap" />
          空档
        </div>
      </div>
      <svg
        className="stats-trend-chart hm-fade-in"
        style={{ '--hm-delay': '80ms' } as CSSProperties}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label="每日专注、暂停与空档堆叠图"
      >
        {[0, 0.5, 1].map((ratio) => {
          const y = height - padY - ratio * plotHeight;
          return (
            <g key={ratio}>
              <line x1={padX} x2={width - padX} y1={y} y2={y} />
              <text className="axis-label" x={padX - 8} y={y + 3}>
                {axisDuration(max * ratio)}
              </text>
            </g>
          );
        })}
        {daily.map((day, index) => {
          const x = padX + slotWidth * index + (slotWidth - barWidth) / 2;
          const focusMs = day.totals.focusMs;
          const pauseMs = day.totals.pauseMs;
          const gapMs = day.totals.gapMs;
          const total = focusMs + pauseMs + gapMs;
          const activeShare = total > 0 ? focusMs / total : 0;
          const pauseShare = total > 0 ? pauseMs / total : 0;
          const gapShare = total > 0 ? gapMs / total : 0;
          const baseline = height - padY;
          const estimatedLabel = day.estimated
            ? ` · 另含 estimated 专注 ${duration(day.totals.estimatedFocusMs)}、暂停 ${duration(day.totals.estimatedPauseMs)}，不进入精确三分类`
            : '';
          const title = `${day.date} · 专注 ${duration(focusMs)} · 暂停 ${duration(pauseMs)} · 空档 ${duration(gapMs)}${estimatedLabel}`;
          return (
            <g
              className="stats-day-column"
              key={day.date}
              role="img"
              tabIndex={0}
              aria-label={title}
              style={{ '--bar-scale': total / max } as CSSProperties}
            >
              <title>{title}</title>
              <rect
                className="active-bar"
                x={x}
                y={baseline - activeShare * plotHeight}
                width={barWidth}
                height={activeShare * plotHeight}
              />
              <rect
                className="pause-bar"
                x={x}
                y={baseline - (activeShare + pauseShare) * plotHeight}
                width={barWidth}
                height={pauseShare * plotHeight}
              />
              <rect
                className="gap-bar"
                x={x}
                y={baseline - (activeShare + pauseShare + gapShare) * plotHeight}
                width={barWidth}
                height={gapShare * plotHeight}
              />
            </g>
          );
        })}
      </svg>
      <div className="stats-trend-labels">
        {daily.map((day, index) => (
          <span
            key={day.date}
            className={
              index % Math.max(1, Math.ceil(daily.length / 7)) === 0 || index === daily.length - 1
                ? 'show'
                : ''
            }
          >
            {day.date.slice(5).replace('-', '/')}
          </span>
        ))}
      </div>
      <p className="stats-caption">
        每根柱子的总高度是当天已分类时间；强调色为专注、红色为暂停、灰色为空档。旧边界只计入
        estimated，悬停或键盘聚焦可读精确值。
      </p>
    </article>
  );
}
