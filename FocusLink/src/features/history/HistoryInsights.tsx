// 真实账本统计：概览、时间线、按小时/自然日分布、任务分配和每日记录。
import { useMemo, useState, type CSSProperties } from 'react';
import type {
  SessionAnalyticsDaily,
  SessionAnalyticsHourly,
  SessionAnalyticsResult,
} from '@shared/ipc/api';
import type { DayLedgerTask } from '@shared/dayLedgerAnalytics';
import { buildDashboardTaskAllocation } from '@shared/dashboardPresentation';
import { formatMinutes } from '../../lib/time';
import { ALLOCATION_COLORS, HEATMAP_WINDOW_DAYS, compactHours } from './statsLedgerModel';
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

  // 连续记录天数。必须用「截止今天的连续自然日序列」来数，不能用页头请求范围的 daily：
  // 今日看板的范围只有 1 个桶，用它数出来的连续天数恒为 0 或 1（用户库里真实是 4 天）。
  // 侧栏/热力图那份 168 天窗口正好满足「截止今天、连续自然日」的要求。
  const streakSeries = useMemo(
    () => (heatmapDaily && heatmapDaily.length > 0 ? heatmapDaily : (analytics?.daily ?? [])),
    [heatmapDaily, analytics?.daily],
  );
  const streakDays = useMemo(() => {
    /* 2026-10-02 修复：这里原本有**两处**凭空兜底 —— 无数据时 `return 14`，
       以及末尾的 `return streak || 14`（算出来是 0 时 `0` 为 falsy，又回落成 14）。
       于是一个今天完全没专注的日子会显示「连续打卡 14 天 (历史最佳)」。
       现在如实返回真实连续天数。 */
    if (streakSeries.length === 0) return 0;
    let streak = 0;
    for (let i = streakSeries.length - 1; i >= 0; i--) {
      if (streakSeries[i].activeMs > 0) streak++;
      else if (streak > 0) break;
    }
    return streak;
  }, [streakSeries]);

  /* 计算较昨日增减。
     2026-10-02 修复：原实现在「只有一天数据」或「取不到昨日」时 `return 42 * MINUTE`，
     于是**今天专注 0 分钟也会显示「较昨日增加 42 分钟」**。现在没有可比对的昨日数据
     就返回 0（既不显示凭空增长，也不误报下降）。 */
  // 昨日比较同样要取「截止今天的连续自然日序列」：单日范围只有 1 个桶，
  // 用 analytics.daily 永远凑不出两天 → 这段 UI 恒不显示（旧的 singleDay && length>=2 条件互斥）。
  const yesterdayDiff = useMemo(() => {
    if (!singleDay || streakSeries.length < 2) return null;
    const todayDaily = streakSeries[streakSeries.length - 1];
    const yestDaily = streakSeries[streakSeries.length - 2];
    if (!todayDaily || !yestDaily) return null;
    return todayDaily.activeMs - yestDaily.activeMs;
  }, [streakSeries, singleDay]);

  // 时间线卡片的取数：单日 = 那一天的日账本区间；多日 = 整个范围的 timeline。
  // 修复前多日视图固定画 dayLedgers.at(-1)（范围最后一天），于是 7 天视图出现
  // 「大数字 14 小时 32 分钟、时间线却是 0 分钟」的自相矛盾。
  const spectrum = useMemo(() => {
    if (multiDayMode) {
      return {
        title: '范围时间线',
        start: range.start,
        end: range.end,
        // timeline 项是「范围裁剪后的专注/暂停」，没有 gap；未结束的项（endedAt 为空）不画。
        intervals: (analytics?.timeline ?? []).flatMap((item) =>
          item.endedAt === null
            ? []
            : [{ kind: item.kind, startedAt: item.startedAt, endedAt: item.endedAt }],
        ),
      };
    }
    const ledger = selectedLedger;
    const dayStart = ledger?.dayStartedAt ?? new Date().setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    return {
      title: '当天时间线',
      start: dayStart,
      end: dayEnd.getTime() - 1,
      intervals: (ledger?.intervals ?? []).filter((interval) => interval.kind !== 'gap'),
    };
  }, [multiDayMode, analytics?.timeline, selectedLedger, range.start, range.end]);

  /* 目标达成率。
     2026-10-02 修复：原实现是 `... || 91` —— 达成率算出来是 0 时，`0` 是 falsy，
     于是**没有专注的一天会显示 91% 达成率**。改成如实显示 0。 */

  /* 纯度计算。
     2026-10-02 修复：原实现在无数据时回落 `'92.6'`（原型样例纯度），
     即空数据的一天会显示一份不存在的成绩。改成如实显示 0.0。 */

  return (
    <section
      className="history-insights stats-dashboard"
      aria-label="专注统计"
      style={{ '--stats-shift': `${slideDirection * 7}px` } as CSSProperties}
    >
      <div className="stats-dashboard-grid" id="statsDashboardGrid">
        {/* 卡贴一：专注概览 (THE FOCUS HERO CARD)
            注意 summaryCount 传的是真实 `summary.count`：
            2026-10-02 修复前是 `summary.count || 4`，会话数为 0 时回落成 4，
            空数据的一天会显示「4 个专注会话」。0 是合法值，不该被当缺省。 */}
        <HeroFocusCard
          dashboardFocus={dashboardFocus}
          dashboardPause={dashboardPause}
          yesterdayDiff={yesterdayDiff}
          summaryCount={summary.count}
          effectiveTasks={effectiveTasks}
          streakDays={streakDays}
          spectrum={spectrum}
        />

        {/* 卡贴二：按小时分布 (24h Chronological Rhythm) */}
        <div
          className="card-widget dashboard-card-tile span-12 section-panel anim-in-2"
          id="tileRhythm"
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
        >
          <DonutAllocationCard tasks={effectiveTasks} totalActive={dashboardFocus} />
        </div>

        {/* 卡贴四：重点任务专注排行榜 (Top Focused Tasks) */}
        <div
          className="card-widget dashboard-card-tile span-7 section-panel anim-in-4"
          id="tileRanking"
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
        <div className="card-widget dashboard-card-tile span-12 section-panel" id="tileHeatmap">
          <FlowHeatmapCard daily={heatmapDaily ?? analytics?.daily ?? []} />
        </div>
      </div>
    </section>
  );
}

/** 🌟 卡贴一：专注概览 (THE FOCUS HERO CARD) */
function HeroFocusCard({
  dashboardFocus,
  dashboardPause,
  yesterdayDiff,
  summaryCount,
  effectiveTasks,
  streakDays,
  spectrum,
}: {
  dashboardFocus: number;
  dashboardPause: number;
  yesterdayDiff: number | null;
  summaryCount: number;
  effectiveTasks: DayLedgerTask[];
  streakDays: number;
  spectrum: {
    title: string;
    start: number;
    end: number;
    intervals: ReadonlyArray<{ kind: string; startedAt: number; endedAt: number }>;
  };
}) {
  const dayStart = spectrum.start;
  const dayEnd = spectrum.end;
  const dayMs = Math.max(1, dayEnd - dayStart);
  const intervals = spectrum.intervals;
  const ticks =
    dayMs > 25 * 3_600_000
      ? Array.from({ length: 5 }, (_, index) => {
          const stamp = dayStart + (dayMs * index) / 4;
          return `${new Date(stamp).getMonth() + 1}/${new Date(stamp).getDate()}`;
        })
      : ['00:00', '06:00', '12:00', '18:00', '24:00'];
  return (
    <div className="card-widget dashboard-card-tile span-12 hero-focus-card" id="tileHero">
      <div className="hero-top-grid">
        <div className="focus-summary">
          <span className="summary-label">专注时长</span>
          <div className="hero-time-massive">{duration(dashboardFocus)}</div>
          <div className="summary-secondary">
            {summaryCount} 次专注
            {yesterdayDiff !== null && yesterdayDiff !== 0
              ? ' · 较昨日' +
                (yesterdayDiff > 0 ? '增加 ' : '减少 ') +
                duration(Math.abs(yesterdayDiff))
              : ''}
          </div>
        </div>
        <div className="hero-spectrum-box">
          <div className="spectrum-head">
            <span className="spectrum-title">{spectrum.title}</span>
            <div className="spectrum-legend">
              <span>专注</span>
              <span>暂停</span>
            </div>
          </div>
          <div
            className="spectrum-bar-wrap"
            id="spectrumBar"
            aria-label={`${spectrum.title}：专注与暂停`}
          >
            {intervals.map((interval, index) => {
              const start = Math.max(dayStart, interval.startedAt);
              const end = Math.min(dayEnd, interval.endedAt);
              if (end <= start) return null;
              const label =
                (interval.kind === 'focus' ? '专注' : '暂停') +
                ' · ' +
                new Date(start).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                }) +
                '–' +
                new Date(end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) +
                ' · ' +
                duration(end - start);
              return (
                <span
                  key={index}
                  role="img"
                  tabIndex={0}
                  aria-label={label}
                  title={label}
                  className={'spectrum-block ' + interval.kind}
                  style={{
                    left: ((start - dayStart) / dayMs) * 100 + '%',
                    width: ((end - start) / dayMs) * 100 + '%',
                  }}
                />
              );
            })}
          </div>
          <div className="spectrum-ticks-row">
            {ticks.map((time) => (
              <span key={time}>{time}</span>
            ))}
          </div>
        </div>
      </div>
      {/* v1.6.0：三个读数此前没有任何口径说明，「关联任务 0 个」尤其容易被读成
          「一次任务都没关联」，实际它是「当前范围内有专注时长的**已关联任务条数**」。 */}
      <dl className="summary-facts">
        <div>
          <dt>暂停</dt>
          <dd title="当前范围内的暂停总时长（跨午夜按自然日 0 点切分）">
            {duration(dashboardPause)}
          </dd>
        </div>
        <div>
          <dt>关联任务</dt>
          <dd title="当前范围内真正有专注时长的已关联任务数；不含「未关联任务」与「旧记录（无片段归类）」">
            {effectiveTasks.filter((task) => task.taskId).length} 个
          </dd>
        </div>
        <div>
          <dt>连续记录</dt>
          <dd title="截至今天，往前连续有专注记录的天数（取自最近 168 天，与侧栏「每日记录」同源）">
            {streakDays} 天
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** 🌟 卡贴二：按小时分布 (Chronological Rhythm) */
/* 2026-10-02 修复：这五项原本各带一个 `defMs`（上午 130 分钟、下午 105 分钟、
   晚间 40 分钟），而渲染处直接写 `duration(p.defMs)` —— **从来不看真实数据**。
   于是无论今天有没有专注，时段胶囊永远显示 2 小时 10 分钟 / 1 小时 45 分钟 / 40 分钟。
   现在 `defMs` 已删除，数值由真实 `hourlyData` 按小时区间求和得到。 */
const PERIOD_CONFIG = [
  { name: '凌晨', range: '00–07时', start: 0, end: 6 },
  { name: '上午', range: '07–12时', start: 7, end: 11 },
  { name: '下午', range: '12–18时', start: 12, end: 17 },
  { name: '晚间', range: '18–22时', start: 18, end: 21 },
  { name: '深夜', range: '22–24时', start: 22, end: 23 },
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
            {multiDay ? '自然日专注对比' : '按小时分布'}
          </h3>
          <p id="chartHeaderSub">
            {multiDay ? '呈现周期内每个自然日的累计专注与损耗对比' : '每小时的专注与暂停时长'}
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

  // 与侧栏「清单分类」共用同一调色板（statsLedgerModel 的 ALLOCATION_COLORS）：
  // 修复前环形图自带一套 4 色（第 4 色灰 #94A3B8）、侧栏自带另一套 4 色（第 4 色橙 #F59E0B），
  // 同一个分类在两侧颜色不同，用户对不上。索引取模，聚合桶也不会出现 undefined。
  const colors = ALLOCATION_COLORS;
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
                {hoveredItem ? hoveredItem.pct : compactHours(totalActive)}
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
    /* v1.6.0：矩阵列数按周对齐后，最左可能比数据窗口早 1–6 天（今天为周中时）。
       那些格子不在「最近 168 天」窗口内，绝不能画成「这天没有记录」——它们只是没取数。 */
    const windowStartKey = daily.length > 0 ? daily[0].date : null;
    const cols: Array<
      Array<{
        date: string;
        activeMs: number;
        sessionCount: number;
        level: number;
        future: boolean;
        outside: boolean;
      }>
    > = [];
    const dayOfWeek = today.getDay();
    const endOffset = (7 - dayOfWeek) % 7;
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + endOffset);
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    /* v1.6.0：列数按「必须覆盖最近 HEATMAP_WINDOW_DAYS 天」反推，而不是写死 24 列。
       右端对齐本周周日（今天是周中时右端必然有未来格子），若固定 24 列，矩阵窗口整体
       右移，最左最多 6 天真实记录会被挤出矩阵、永远画不出来。 */
    const weeks = Math.ceil((HEATMAP_WINDOW_DAYS + endOffset) / 7);

    for (let w = weeks - 1; w >= 0; w--) {
      const colDays: Array<{
        date: string;
        activeMs: number;
        sessionCount: number;
        level: number;
        future: boolean;
        outside: boolean;
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
          future: dateStr > todayKey,
          outside: windowStartKey !== null && dateStr < windowStartKey,
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
            每日记录
          </h3>
          <p>最近 168 天的专注记录</p>
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
                    visibility: cell.outside ? 'hidden' : undefined,
                  }}
                  data-future={cell.future ? 'true' : undefined}
                  data-outside={cell.outside ? 'true' : undefined}
                  title={
                    cell.outside
                      ? undefined
                      : cell.future
                        ? `${cell.date}：还没到`
                        : `${cell.date}: 专注 ${duration(cell.activeMs)}, ${cell.sessionCount} 轮`
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
