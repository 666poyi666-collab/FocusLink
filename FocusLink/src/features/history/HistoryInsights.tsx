// 统计工作台：固定 12 栅格 5 大核心卡贴画卷 (The 5 Fixed Masterclass Cards)
// 100% 对齐设计原型：今日心流全景仪表、24h精力节律分布、清单分类占比、重点任务排行、24周心流热力矩阵。
// 彻底移除旧版时间轴与冗余轨道，纯粹沉浸呈现。
import React, { useMemo, useState, type CSSProperties } from 'react';
import type {
  SessionAnalyticsDaily,
  SessionAnalyticsHourly,
  SessionAnalyticsResult,
} from '@shared/ipc/api';
import type { DayLedgerAnalytics, DayLedgerTask } from '@shared/dayLedgerAnalytics';
import { buildDashboardTaskAllocation } from '@shared/dashboardPresentation';
import { formatMinutes } from '../../lib/time';
import { HEATMAP_WEEKS } from './statsLedgerModel';
import {
  isSameLocalDay,
  type RangePreset,
  type SessionSummary,
  type TimeRange,
} from './historyStats';

export interface HistoryInsightsProps {
  summary: SessionSummary;
  heatmapDaily?: SessionAnalyticsDaily[];
  range: TimeRange;
  analytics: SessionAnalyticsResult | null;
  slideDirection: -1 | 0 | 1;
  onSelectRange: (preset: RangePreset) => void;
  onOpenSession?: (sessionId: string) => void;
  taskQuery?: string;
  activePeriod?: number;
  onPeriodClick?: (idx: number) => void;
  onTaskSelect?: (taskId: string | null, title: string) => void;
  onTaskHover?: (index: number | null) => void;
  hoveredTaskIndex?: number | null;
  multiDayMode?: boolean;
}

const MINUTE = 60_000;

function duration(ms: number): string {
  return formatMinutes(Math.max(0, ms));
}

function axisDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = minutes / 60;
  return `${hours >= 10 || Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)} 小时`;
}

export function HistoryInsights({
  summary,
  heatmapDaily,
  range,
  analytics,
  slideDirection,
  taskQuery,
  activePeriod = -1,
  onPeriodClick,
  onTaskSelect,
  onTaskHover,
  hoveredTaskIndex = null,
  multiDayMode = false,
}: HistoryInsightsProps) {
  const singleDay = isSameLocalDay(range.start, range.end - 1);
  const dayLedgers = useMemo(() => analytics?.dayLedgers ?? [], [analytics?.dayLedgers]);
  const selectedLedger = singleDay
    ? (dayLedgers.find(
        (item) => item.dayStartedAt === new Date(range.start).setHours(0, 0, 0, 0),
      ) ?? dayLedgers[0])
    : dayLedgers.at(-1);

  const dashboardFocus = analytics?.totals.activeMs ?? 0;
  const dashboardPause = analytics?.totals.pauseMs ?? 0;
  const effectiveTasks = useMemo<DayLedgerTask[]>(
    () => (analytics?.tasks ?? []).map((task) => ({ ...task, estimated: false })),
    [analytics?.tasks],
  );

  // 计算连续打卡天数
  const streakDays = useMemo(() => {
    /* 2026-10-02 修复：这里原本有**两处**凭空兜底 —— 无数据时 `return 14`，
       以及末尾的 `return streak || 14`（算出来是 0 时 `0` 为 falsy，又回落成 14）。
       于是一个今天完全没专注的日子会显示「连续打卡 14 天 (历史最佳)」。
       现在如实返回真实连续天数。 */
    if (!analytics?.daily || analytics.daily.length === 0) return 0;
    let streak = 0;
    for (let i = analytics.daily.length - 1; i >= 0; i--) {
      if (analytics.daily[i].activeMs > 0) streak++;
      else if (streak > 0) break;
    }
    return streak;
  }, [analytics?.daily]);

  /* 计算较昨日增减。
     2026-10-02 修复：原实现在「只有一天数据」或「取不到昨日」时 `return 42 * MINUTE`，
     于是**今天专注 0 分钟也会显示「较昨日增加 42 分钟」**。现在没有可比对的昨日数据
     就返回 0（既不显示凭空增长，也不误报下降）。 */
  const yesterdayDiff = useMemo(() => {
    if (!singleDay || !analytics?.daily || analytics.daily.length < 2) return null;
    const todayDaily = analytics.daily[analytics.daily.length - 1];
    const yestDaily = analytics.daily[analytics.daily.length - 2];
    if (!todayDaily || !yestDaily) return 0;
    return todayDaily.activeMs - yestDaily.activeMs;
  }, [analytics?.daily, singleDay]);

  /* 目标达成率。
     2026-10-02 修复：原实现是 `... || 91` —— 达成率算出来是 0 时，`0` 是 falsy，
     于是**没有专注的一天会显示 91% 达成率**。改成如实显示 0。 */
  const targetMs = singleDay ? 5 * 3600_000 : Math.max(1, dayLedgers.length) * 5 * 3600_000;
  const targetRate = Math.min(100, Math.round((dashboardFocus / targetMs) * 100));

  /* 纯度计算。
     2026-10-02 修复：原实现在无数据时回落 `'92.6'`（原型样例纯度），
     即空数据的一天会显示一份不存在的成绩。改成如实显示 0.0。 */
  const purity =
    dashboardFocus + dashboardPause > 0
      ? ((dashboardFocus / (dashboardFocus + dashboardPause)) * 100).toFixed(1)
      : '0.0';

  // 鼠标移动高光跟随
  const handleCardMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    card.style.setProperty('--mouse-x', `${x}px`);
    card.style.setProperty('--mouse-y', `${y}px`);
  };

  return (
    <section
      className="history-insights stats-dashboard"
      aria-label="专注统计"
      style={{ '--stats-shift': `${slideDirection * 7}px` } as CSSProperties}
    >
      <div className="stats-dashboard-grid" id="statsDashboardGrid">
        {/* 卡贴一：今日心流全景仪表 (THE FOCUS HERO CARD)
            注意 summaryCount 传的是真实 `summary.count`：
            2026-10-02 修复前是 `summary.count || 4`，会话数为 0 时回落成 4，
            空数据的一天会显示「4 个专注会话」。0 是合法值，不该被当缺省。 */}
        <HeroFocusCard
          targetRate={targetRate}
          dashboardFocus={dashboardFocus}
          dashboardPause={dashboardPause}
          targetMs={targetMs}
          yesterdayDiff={yesterdayDiff}
          summaryCount={summary.count}
          purity={purity}
          effectiveTasks={effectiveTasks}
          streakDays={streakDays}
          selectedLedger={selectedLedger}
          onMouseMove={handleCardMouseMove}
        />

        {/* 卡贴二：24 小时精力节律时钟分布 (24h Chronological Rhythm) */}
        <div
          className="card-widget dashboard-card-tile span-12 section-panel anim-in-2"
          id="tileRhythm"
          onMouseMove={handleCardMouseMove}
        >
          <RhythmChartCard
            multiDay={multiDayMode}
            daily={analytics?.daily ?? []}
            hourly={analytics?.hourly ?? []}
            activePeriod={activePeriod}
            onPeriodClick={onPeriodClick}
          />
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
          <TopTasksLeaderboard
            tasks={effectiveTasks}
            query={taskQuery}
            hoveredIndex={hoveredTaskIndex}
            onTaskSelect={onTaskSelect}
            onTaskHover={onTaskHover}
          />
        </div>

        {/* 卡贴五：心流活跃热力 (24 周心流矩阵 (近半年)) */}
        <div
          className="card-widget dashboard-card-tile span-12 section-panel"
          id="tileHeatmap"
          onMouseMove={handleCardMouseMove}
        >
          <FlowHeatmapCard daily={heatmapDaily ?? analytics?.daily ?? []} />
        </div>
      </div>
    </section>
  );
}

/** 🌟 卡贴一：今日心流全景仪表 (THE FOCUS HERO CARD) */
function HeroFocusCard({
  targetRate,
  dashboardFocus,
  dashboardPause,
  targetMs,
  yesterdayDiff,
  summaryCount,
  purity,
  effectiveTasks,
  streakDays,
  selectedLedger,
  onMouseMove,
}: {
  targetRate: number;
  dashboardFocus: number;
  dashboardPause: number;
  targetMs: number;
  yesterdayDiff: number | null;
  summaryCount: number;
  purity: string;
  effectiveTasks: DayLedgerTask[];
  streakDays: number;
  selectedLedger?: DayLedgerAnalytics;
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const arcLength = 251.3;
  const strokeOffset = arcLength * (1 - targetRate / 100);

  // 格式化时间
  const focusH = Math.floor(dashboardFocus / 3600_000);
  const focusM = Math.floor((dashboardFocus % 3600_000) / 60_000);
  const targetH = Math.floor(targetMs / 3600_000);
  const targetM = Math.floor((targetMs % 3600_000) / 60_000);

  // 时序谱带数据
  const intervals = selectedLedger?.intervals?.filter((i) => i.kind !== 'gap') ?? [];
  const baseStart = 8 * 3600_000;
  const baseTotal = 14 * 3600_000; // 08:00 - 22:00 = 14h

  const spectrumBlocks =
    intervals.length > 0
      ? intervals.map((inv) => {
          const startOfDay = selectedLedger?.dayStartedAt ?? new Date().setHours(0, 0, 0, 0);
          const relStart = Math.max(0, inv.startedAt - startOfDay - baseStart);
          const left = Math.min(100, Math.max(0, (relStart / baseTotal) * 100));
          const width = Math.min(100 - left, Math.max(1.5, (inv.durationMs / baseTotal) * 100));
          return {
            kind: inv.kind as 'focus' | 'pause',
            left,
            width,
            title: `${inv.kind === 'focus' ? '专注' : '暂停'} · ${duration(inv.durationMs)}`,
            lbl: width > 5 ? duration(inv.durationMs) : '',
          };
        })
      : /* 2026-10-02 修复：这里原本回落到 7 段原型示例区间（09:15 精读《深度工作》、
           重构 LocalTaskProvider、任务页 4K 纯净设计…）。没有真实区间就如实为空。 */
        [];

  return (
    <div
      className="card-widget dashboard-card-tile span-12 hero-focus-card anim-in-1"
      id="tileHero"
      onMouseMove={onMouseMove}
    >
      <div className="hero-top-grid">
        <div className="hero-focus-gauge-box">
          <div className="hero-dial-wrap" title={`今日专注目标进度：${targetRate}%`}>
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
              今日累计专注
            </span>
            <div className="hero-time-massive" id="heroTimeValWrap">
              <span id="heroTimeVal">
                {focusH}
                <span className="time-unit">小时</span> {focusM}
                <span className="time-unit">分钟</span>
              </span>
            </div>
            <div className="hero-target-row" id="heroTargetVal">
              / 参考目标 {targetH} 小时 {targetM > 0 ? `${targetM} 分钟` : ''}
            </div>
            {/* 2026-10-02 修复：原实现无论增减都渲染「较昨日 +X」加绿色上箭头，
                下降时也显示成增长。现在按真实符号分三态：增长 / 下降 / 持平。 */}
            {yesterdayDiff !== null && yesterdayDiff !== 0 ? (
              <div
                className={`hero-delta-pill ${yesterdayDiff > 0 ? 'positive' : 'negative'}`}
                id="heroDiffText"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  style={{ width: '11px', height: '11px' }}
                >
                  {yesterdayDiff > 0 ? (
                    <polyline points="18 15 12 9 6 15" />
                  ) : (
                    <polyline points="6 9 12 15 18 9" />
                  )}
                </svg>
                较昨日 {yesterdayDiff > 0 ? '+' : '−'}
                {axisDuration(Math.abs(yesterdayDiff))}
              </div>
            ) : yesterdayDiff === 0 ? (
              <div className="hero-delta-pill" id="heroDiffText">
                与昨日持平
              </div>
            ) : (
              <div className="hero-delta-pill positive" id="heroDiffText">
                完成 {summaryCount} 轮
              </div>
            )}
          </div>
        </div>

        {/* 连续时序谱带 (08:00 - 22:00) */}
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
              今日时序谱带 (08:00 - 22:00)
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
                  />
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
                  />
                  暂停
                </span>
              </div>
            </div>
          </div>

          <div className="spectrum-bar-wrap" id="spectrumBar">
            {spectrumBlocks.map((b, i) => (
              <div
                key={i}
                className={`spectrum-block ${b.kind}`}
                style={{ left: `${b.left}%`, width: `${b.width}%` }}
                title={b.title}
              >
                {b.lbl}
              </div>
            ))}
          </div>

          <div className="spectrum-ticks-row">
            <span>08:00</span>
            <span>10:00</span>
            <span>12:00</span>
            <span>14:00</span>
            <span>16:00</span>
            <span>18:00</span>
            <span>20:00</span>
            <span>22:00</span>
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
            {effectiveTasks.filter((task) => task.taskId).length} 个
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

/** 🌟 卡贴二：24 小时精力节律时钟分布 (Chronological Rhythm) */
/* 2026-10-02 修复：这五项原本各带一个 `defMs`（黄金上午 130 分钟、沉浸下午 105 分钟、
   晚间收尾 40 分钟），而渲染处直接写 `duration(p.defMs)` —— **从来不看真实数据**。
   于是无论今天有没有专注，时段胶囊永远显示 2 小时 10 分钟 / 1 小时 45 分钟 / 40 分钟。
   现在 `defMs` 已删除，数值由真实 `hourlyData` 按小时区间求和得到。 */
const PERIOD_CONFIG = [
  { name: '深夜时段', range: '00–07时', start: 0, end: 6 },
  { name: '黄金上午', range: '07–12时', start: 7, end: 11 },
  { name: '沉浸下午', range: '12–18时', start: 12, end: 17 },
  { name: '晚间收尾', range: '18–22时', start: 18, end: 21 },
  { name: '深夜休整', range: '22–24时', start: 22, end: 23 },
];

/* 2026-10-02 修复：这里原本是 24 小时的**原型示例数据**（8 点 15m、9 点 45m/5m …）。
   没有真实区间时应当如实为空 —— 生成全 0 的 24 小时序列，而不是画一份假节律。 */
const EMPTY_HOURLY = Array.from({ length: 24 }, (_, h) => ({ h, f: 0, p: 0 }));

/* 2026-10-02 修复：这里原本是 7 天的**原型示例数据**（周一 270m、周二 310m …）。
   没有真实数据时应当如实为空。 */

function RhythmChartCard({
  multiDay,
  daily,
  hourly,
  activePeriod = -1,
  onPeriodClick,
}: {
  multiDay: boolean;
  hourly: SessionAnalyticsHourly[];
  daily: SessionAnalyticsDaily[];
  activePeriod?: number;
  onPeriodClick?: (idx: number) => void;
}) {
  const hourlyData = hourly.length
    ? hourly.map((hour) => ({ h: hour.hour, f: hour.activeMs / MINUTE, p: hour.pauseMs / MINUTE }))
    : EMPTY_HOURLY;

  /* 五个自然时段的真实专注时长：把 hourlyData（分钟）按区间求和后换算成毫秒。
     2026-10-02 修复前这里用的是原型写死的 defMs，永远不看真实数据。 */
  const periodFocusMs = useMemo(
    () =>
      PERIOD_CONFIG.map(
        (p) =>
          hourlyData
            .filter((item) => item.h >= p.start && item.h <= p.end)
            .reduce((sum, item) => sum + item.f, 0) * MINUTE,
      ),
    [hourlyData],
  );

  const dailyBars = daily.map((day) => ({
    label: day.date.slice(5).replace('-', '/'),
    f: day.activeMs / MINUTE,
    p: day.pauseMs / MINUTE,
  }));
  const dailyMax = Math.max(360, ...dailyBars.map((day) => day.f + day.p));
  return (
    <>
      <div className="section-head">
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
            {multiDay ? '自然日专注对比' : '24 小时精力节律时钟分布'}
          </h3>
          <p id="chartHeaderSub">
            {multiDay
              ? '呈现周期内每个自然日的累计专注与损耗对比'
              : '按小时呈现每个自然时段的专注与暂停沉淀，洞察全天精力高峰'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '11.5px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '2px',
                  background: 'var(--accent)',
                }}
              />
              专注时长
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '2px',
                  background: 'var(--pause-color)',
                }}
              />
              暂停损耗
            </span>
          </div>
        </div>
      </div>

      <div className="rhythm-chart-box">
        <div className="rhythm-grid-lines">
          <div className="rhythm-grid-line rhythm-target-guide">
            <span className="rhythm-grid-tag" id="rhythmGridGuideTag">
              {multiDay ? `刻度 ${Math.round(dailyMax / 60)} 小时` : '45 分钟'}
            </span>
          </div>
          <div className="rhythm-grid-line">
            <span className="rhythm-grid-tag">
              {multiDay ? `${Math.round(dailyMax / 120)} 小时` : '30 分钟'}
            </span>
          </div>
          <div className="rhythm-grid-line">
            <span className="rhythm-grid-tag">
              {multiDay ? `${Math.round(dailyMax / 240)} 小时` : '15 分钟'}
            </span>
          </div>
        </div>

        <div className="bars-row" id="rhythmBarContainer">
          {!multiDay
            ? hourlyData.map((item) => {
                const isActive = item.f > 0 || item.p > 0;
                const fPct = Math.min(100, Math.round((item.f / 60) * 100));
                const pPct = Math.min(100, Math.round((item.p / 60) * 100));
                const hourStr = `${String(item.h).padStart(2, '0')}:00`;
                const showLbl = item.h % 4 === 0 || item.h === 23 ? hourStr : '';

                // 时段高亮过滤判定
                let opacity = '1';
                if (activePeriod >= 0 && activePeriod < PERIOD_CONFIG.length) {
                  const p = PERIOD_CONFIG[activePeriod];
                  opacity = item.h >= p.start && item.h <= p.end ? '1' : '0.22';
                }

                return (
                  <div
                    key={item.h}
                    className="bar-col"
                    data-hour={item.h}
                    style={{ opacity, transition: 'opacity 0.2s ease' }}
                  >
                    {isActive ? (
                      <div className="bar-track active">
                        <div className="bar-seg-focus" style={{ height: `${fPct}%` }} />
                        {pPct > 0 && (
                          <div className="bar-seg-pause" style={{ height: `${pPct}%` }} />
                        )}
                      </div>
                    ) : (
                      <div className="bar-track inactive">
                        <div className="bar-empty-dot" />
                      </div>
                    )}
                    <div className="bar-time-lbl">{showLbl}</div>
                    <div className="bar-hover-tip">
                      {hourStr} · 专注 {duration(item.f * MINUTE)}{' '}
                      {item.p ? `· 暂停 ${duration(item.p * MINUTE)}` : ''}
                    </div>
                  </div>
                );
              })
            : dailyBars.map((item, idx) => {
                const fPct = Math.min(100, Math.round((item.f / dailyMax) * 100));
                const pPct = Math.min(100, Math.round((item.p / dailyMax) * 100));
                const h = (item.f / 60).toFixed(1);
                return (
                  <div key={idx} className="bar-col">
                    <div className="bar-track" style={{ maxWidth: '32px' }}>
                      <div className="bar-seg-focus" style={{ height: `${fPct}%` }} />
                      <div className="bar-seg-pause" style={{ height: `${pPct}%` }} />
                    </div>
                    <div className="bar-time-lbl">{item.label}</div>
                    <div className="bar-hover-tip">
                      {item.label} · 专注 {h} 小时 · 暂停 {duration(item.p * MINUTE)}
                    </div>
                  </div>
                );
              })}
        </div>
      </div>

      {/* 五大自然时段胶囊 —— 数值来自真实 hourlyData 按小时区间求和 */}
      {!multiDay && (
        <div className="period-capsule-row" id="periodRow">
          {PERIOD_CONFIG.map((p, idx) => {
            const isActive = activePeriod === idx;
            const focusMs = periodFocusMs[idx] ?? 0;
            return (
              <div
                key={idx}
                className={`period-cap-card ${isActive ? 'active' : ''}`}
                onClick={() => onPeriodClick?.(idx)}
              >
                <div className="period-cap-head">
                  <span>{p.name}</span>
                  <span>{p.range}</span>
                </div>
                <div
                  className="period-cap-val"
                  style={isActive ? { color: 'var(--accent)' } : undefined}
                >
                  {duration(focusMs)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
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

  const [hoveredItem, setHoveredItem] = useState<{ name: string; dur: string; pct: string } | null>(
    null,
  );

  const colors = ['#2563EB', '#6366F1', '#10B981', '#94A3B8'];
  const circumference = 238.76; // 2 * PI * 38

  /* 没有真实分配数据时就如实为空。
     2026-10-01 修复：这里原本放了一份原型样例分类（工作任务 55% / 深度学习 25% /
     个人生活 12% / 自由探索 8%），于是空数据的一天会显示一份**不存在的**投入占比。
     原型是设计稿，样例占比只是占位，不是可以渲染给用户的读数。 */
  const categories =
    allocation.items.length > 0
      ? allocation.items.map((item, i) => ({
          key: item.key,
          title: item.title,
          share: item.share,
          activeMs: item.activeMs,
          color: colors[i % colors.length],
        }))
      : [];

  let currentOffset = 0;
  const segments = categories.map((c) => {
    const dashLength = (c.share / 100) * circumference;
    const strokeDasharray = `${dashLength.toFixed(1)} ${(circumference - dashLength).toFixed(1)}`;
    const strokeDashoffset = -currentOffset;
    currentOffset += dashLength;
    return { ...c, strokeDasharray, strokeDashoffset };
  });

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
          <p>掌握不同清单的时间分配与精力沉淀</p>
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
              {segments.map((seg) => (
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
                  onMouseEnter={() =>
                    setHoveredItem({
                      name: seg.title,
                      dur: duration(seg.activeMs),
                      pct: `${seg.share}%`,
                    })
                  }
                  onMouseLeave={() => setHoveredItem(null)}
                  style={{ transition: 'all .2s ease', cursor: 'pointer' }}
                />
              ))}
            </svg>
            <div className="donut-center-metric" id="donutCenterBox">
              <span className="d-big" id="donutCenterVal">
                {hoveredItem ? hoveredItem.pct : `${(totalActive / 3600_000).toFixed(1)}`}
              </span>
              <span className="d-lbl" id="donutCenterLbl">
                {hoveredItem ? '投入占比' : '专注小时'}
              </span>
            </div>
          </div>
        </div>

        <div className="alloc-list">
          {categories.map((c) => {
            const isHovered = hoveredItem && hoveredItem.name === c.title;
            const isDimmed = hoveredItem && !isHovered;
            return (
              <div
                className="alloc-row"
                key={c.key}
                onMouseEnter={() =>
                  setHoveredItem({ name: c.title, dur: duration(c.activeMs), pct: `${c.share}%` })
                }
                onMouseLeave={() => setHoveredItem(null)}
                style={{
                  opacity: isDimmed ? 0.45 : 1,
                  transform: isHovered ? 'translateY(-1px) translateX(2px)' : undefined,
                  transition: 'all 0.15s ease',
                }}
              >
                <div className="alloc-row-main">
                  <div className="alloc-left">
                    <span className="alloc-color-dot" style={{ background: c.color }} />
                    <span title={c.title}>{c.title}</span>
                  </div>
                  <div className="alloc-right">
                    <span className="alloc-dur">{duration(c.activeMs)}</span>
                    <span className="alloc-pct-tag">{c.share}%</span>
                  </div>
                </div>
                <div className="alloc-micro-bar-track">
                  <div
                    className="alloc-micro-bar-fill"
                    style={{ width: `${c.share}%`, background: c.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** 🌟 卡贴四：重点任务专注排行榜 (Top Focused Tasks) */
function TopTasksLeaderboard({
  tasks,
  query,
  hoveredIndex,
  onTaskSelect,
  onTaskHover,
}: {
  tasks: DayLedgerTask[];
  query?: string;
  hoveredIndex?: number | null;
  onTaskSelect?: (taskId: string | null, title: string) => void;
  onTaskHover?: (idx: number | null) => void;
}) {
  const keyword = (query ?? '').trim().toLowerCase();
  const matched = keyword ? tasks.filter((t) => t.title.toLowerCase().includes(keyword)) : tasks;
  const topTasks = matched.slice(0, 4);
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
            重点任务专注排行
          </h3>
          <p>周期内投入精力最多的关键事务 · 相对时长可视化</p>
        </div>
      </div>

      <div className="leaderboard-container">
        {topTasks.map((task, idx) => {
          const rankNum = String(idx + 1).padStart(2, '0');
          const pct = Math.round((task.activeMs / maxMs) * 100);
          const isSelected = hoveredIndex === idx;

          return (
            <div
              className="task-rank-card"
              key={task.key}
              onClick={() => onTaskSelect?.(task.taskId, task.title)}
              onMouseEnter={() => onTaskHover?.(idx)}
              onMouseLeave={() => onTaskHover?.(null)}
              style={
                isSelected
                  ? {
                      borderColor: 'var(--accent)',
                      boxShadow: '0 0 0 1px var(--accent), 0 4px 14px var(--accent-soft)',
                    }
                  : undefined
              }
            >
              <div className="tr-top-row">
                <div className="tr-left">
                  <span className="tr-rank-num">{rankNum}</span>
                  <span className="tr-title" title={task.title}>
                    {task.title}
                  </span>
                  {/* 2026-10-01 修复：这里原本写死 <span className="tr-cat-pill">工作任务</span>，
                      于是每一行排行卡都顶着同一个假分类。DayLedgerTask 目前没有分类字段，
                      所以不渲染这个标签，而不是编一个出来。 */}
                </div>
                <div className="tr-right">
                  <span className="tr-time">{duration(task.activeMs)}</span>
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
      </div>
    </>
  );
}

/** 🌟 卡贴五：心流活跃热力 (24 周心流矩阵 (近半年)) */
function FlowHeatmapCard({ daily }: { daily: SessionAnalyticsDaily[] }) {
  const matrix = useMemo(() => {
    const map = new Map<string, { activeMs: number; sessionCount: number }>();
    for (const d of daily) map.set(d.date, { activeMs: d.activeMs, sessionCount: d.sessionCount });

    const today = new Date();
    const cols: Array<
      Array<{ date: string; activeMs: number; sessionCount: number; level: number }>
    > = [];
    const dayOfWeek = today.getDay();
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
        const dateStr = `${curDate.getFullYear()}-${String(curDate.getMonth() + 1).padStart(2, '0')}-${String(curDate.getDate()).padStart(2, '0')}`;
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
            心流节律活动热力
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
              {col.map((cell) => (
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
                  title={`${cell.date}: 专注 ${duration(cell.activeMs)}, ${cell.sessionCount} 轮`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
