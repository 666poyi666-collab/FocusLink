// 统计页页面级模型：统计侧栏（统计视图 / 清单分类）与会话账本共用的纯计算。
// 该文件不含 JSX：放在 *.tsx 是为了遵守本轮写作用域（只允许新增 src/features/history/*.tsx）。
import type { SessionAnalyticsDaily, SessionAnalyticsTask } from '@shared/ipc/api';
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

/**
 * 统计页唯一的时长读数格式：不足 1 小时说分钟，1 小时以上说小数小时。
 *
 * 为什么按分钟决定单位（用户 m03054：侧栏「今日看板 0.0时」与页头「累计 2 分钟」打架）：
 * 小时制在小数值上会被四舍五入成 0.0，用户看到的是「今天没学」；而分钟制在长时长上又会变成
 * 巨大的数字。先四舍五入到分钟（与 formatMinutes 同一个数）再决定单位，同屏各处的读数才能对上。
 */
export function formatStatDuration(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const minutes = Math.round(safe / 60_000);
  if (minutes <= 0) return safe > 0 ? '<1 分钟' : '0 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  return `${(minutes / 60).toFixed(1)}时`;
}

export interface StatsSidebarCategory {
  key: string;
  label: string;
  percent: number;
  color: string;
  activeMs: number;
  /** 该分类的时长读数（与侧栏/页头/环形圆心同一口径），nav-num 直接显示它。 */
  durationLabel: string;
  /**
   * 只有真实任务行能当筛选键。「其他已关联任务 / 未关联任务 / 旧记录」是聚合桶，
   * 点它无法映射回某个 taskId，所以侧栏把它们渲染成不可点的静态行。
   */
  clickable: boolean;
}

/**
 * 侧栏「清单分类」：与卡贴三「清单分类投入占比」调用同一个分配模型、同一份
 * `analytics.tasks` 与同一个分母（`totals.activeMs`），所以两处的顺序、标签、
 * 配色与百分比必然一致（最大余数法保证整数且合计 100%），聚合桶也都在。
 */
export function buildStatsSidebarCategories(
  tasks: readonly SessionAnalyticsTask[],
  totalFocusMs: number,
  limit = 3,
): StatsSidebarCategory[] {
  const allocation = buildDashboardTaskAllocation(tasks, totalFocusMs, limit);
  return allocation.items
    .filter((item) => item.activeMs > 0)
    .map((item, index) => ({
      key: item.key,
      label: item.title,
      percent: item.share,
      color: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length],
      activeMs: item.activeMs,
      durationLabel: formatStatDuration(item.activeMs),
      clickable: item.tone === 'linked',
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
