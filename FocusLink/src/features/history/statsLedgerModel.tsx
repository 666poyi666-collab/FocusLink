// 统计页页面级模型：统计侧栏（统计视图 / 清单分类）与会话账本共用的纯计算。
// 该文件不含 JSX：放在 *.tsx 是为了遵守本轮写作用域（只允许新增 src/features/history/*.tsx）。
import type { SessionAnalyticsDaily } from '@shared/ipc/api';
import type { DayLedgerAnalytics, DayLedgerTask } from '@shared/dayLedgerAnalytics';
import { buildDashboardTaskAllocation } from '@shared/dashboardPresentation';

/** 心流热力矩阵窗口（与 HistoryInsights 的 FlowHeatmapCard 同一常量口径）。 */
export const HEATMAP_WEEKS = 24;
export const HEATMAP_WINDOW_DAYS = HEATMAP_WEEKS * 7;

/** 环形图与侧栏清单分类共用的调色板：两侧色点必须同色，否则用户无法把侧栏与卡贴三对上。 */
export const ALLOCATION_COLORS = [
  '#2563EB',
  '#6366F1',
  '#10B981',
  '#F59E0B',
  '#94A3B8',
  '#CBD5E1',
] as const;

export interface LedgerTotals {
  focusMs: number;
  pauseMs: number;
  gapMs: number;
  observationMs: number;
  estimatedFocusMs: number;
  estimatedPauseMs: number;
}

const EMPTY_TOTALS: LedgerTotals = {
  focusMs: 0,
  pauseMs: 0,
  gapMs: 0,
  observationMs: 0,
  estimatedFocusMs: 0,
  estimatedPauseMs: 0,
};

/** 跨日账本求和：原型侧栏的「今日 / 最近 7 天 / 最近 30 天」都读这一份口径。 */
export function ledgerTotalsOf(dayLedgers: readonly DayLedgerAnalytics[]): LedgerTotals {
  return dayLedgers.reduce<LedgerTotals>(
    (total, item) => ({
      focusMs: total.focusMs + item.totals.focusMs,
      pauseMs: total.pauseMs + item.totals.pauseMs,
      gapMs: total.gapMs + item.totals.gapMs,
      observationMs: total.observationMs + item.totals.observationMs,
      estimatedFocusMs: total.estimatedFocusMs + item.totals.estimatedFocusMs,
      estimatedPauseMs: total.estimatedPauseMs + item.totals.estimatedPauseMs,
    }),
    { ...EMPTY_TOTALS },
  );
}

/** 把逐日账本里的任务合并成同一份排行（侧栏清单分类与卡贴三/四共用同一合并规则）。 */
export function mergeLedgerTasks(dayLedgers: readonly DayLedgerAnalytics[]): DayLedgerTask[] {
  const taskMap = new Map<string, DayLedgerTask>();
  for (const ledger of dayLedgers) {
    for (const task of ledger.tasks) {
      const current = taskMap.get(task.key);
      taskMap.set(
        task.key,
        current
          ? {
              ...current,
              activeMs: current.activeMs + task.activeMs,
              segmentCount: current.segmentCount + task.segmentCount,
            }
          : { ...task },
      );
    }
  }
  return Array.from(taskMap.values()).sort(
    (left, right) => right.activeMs - left.activeMs || left.title.localeCompare(right.title),
  );
}

/** ms -> 原型的紧凑小时口径（"4.6h" / "0h"），用于侧栏 nav-num。 */
export function formatCompactHours(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (safe <= 0) return '0时';
  return `${(safe / 3_600_000).toFixed(1)}时`;
}

/** ms -> 原型工具栏的「累计 4h 35m」口径。 */
export function formatHoursMinutes(ms: number): string {
  const totalMinutes = Math.floor((Number.isFinite(ms) ? Math.max(0, ms) : 0) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} 分钟`;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}

export interface StatsSidebarCategory {
  key: string;
  label: string;
  percent: number;
  color: string;
  activeMs: number;
}

/**
 * 侧栏「清单分类」：沿用卡贴三「清单分类投入占比」的同一份分配模型，
 * 取占比最高的前 limit 项 + 百分比（最大余数法保证整数且合计 100%）。
 * 原型这里放的是示例分类名（工作任务/深度学习/个人生活），客户端放真实任务分类。
 */
export function buildStatsSidebarCategories(
  dayLedgers: readonly DayLedgerAnalytics[],
  totalFocusMs: number,
  limit = 3,
): StatsSidebarCategory[] {
  const tasks = mergeLedgerTasks(dayLedgers);
  const allocation = buildDashboardTaskAllocation(tasks, totalFocusMs, limit);
  return allocation.items
    .filter((item) => item.activeMs > 0)
    .slice(0, limit)
    .map((item, index) => ({
      key: item.key,
      label: item.title,
      percent: item.share,
      color: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length],
      activeMs: item.activeMs,
    }));
}

export interface StatsRangeWindows {
  todayMs: number;
  weekMs: number;
  monthMs: number;
  activeDays: number;
}

/**
 * 侧栏「统计视图」的四个读数。daily 必须是「截止今天的连续自然日」序列
 * （由 HistoryPanel 以 start=今天-29天 / end=今天 请求），否则窗口求和会错位。
 */
export function summarizeRangeWindows(daily: readonly SessionAnalyticsDaily[]): StatsRangeWindows {
  const monthMs = daily.reduce((total, day) => total + Math.max(0, day.activeMs), 0);
  const weekMs = daily.slice(-7).reduce((total, day) => total + Math.max(0, day.activeMs), 0);
  return {
    todayMs: Math.max(0, daily.at(-1)?.activeMs ?? 0),
    weekMs,
    monthMs,
    activeDays: daily.filter((day) => day.activeMs > 0).length,
  };
}
