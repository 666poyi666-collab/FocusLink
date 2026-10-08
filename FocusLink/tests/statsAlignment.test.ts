import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatMinutes } from '../src/lib/time';
import {
  ALLOCATION_COLORS,
  buildStatsSidebarCategories,
  formatStatDuration,
} from '../src/features/history/statsLedgerModel';

/* ────────────────────────────────────────────────────────────────────────────
   统计页「数据对齐」契约（FL-STATS-ALIGNMENT，v1.6.0）

   为什么有这道测试（2026-10-08 用户要求）：
     「统计界面还需要进一步数据对齐和显示的优化，不是 UI 的问题，是逻辑的问题。」

   真实用户库复算（152 个会话 / 374 个片段 / 304 个暂停，2026-10-07）暴露的口径分叉：
     ① 同一个时长四种取整：侧栏 14.5时 / 页头 14 小时 31 分钟（floor）/ 卡贴一 14 小时 32 分钟
        （round）/ 环形图圆心 14.5 —— 同屏三个数字。
     ② 「N 个专注会话」用 analytics.sessions.length（与范围重叠即计入），与「累计时长」
        （按范围裁切）不同源：10/06 会话数 3 而当天真正有专注的只有 2 条。
     ③ daily.sessionCount 按「重叠」计数 → Σdaily ≠ totals，跨夜会话在两天各 +1。
     ④ 跨午夜暂停被整段丢在开始日：10/07 日账本暂停 384 分钟，totals 是 954 分钟。
     ⑤ 连续记录只看页头范围的 daily（今日看板 1 个桶）→ 恒 0/1 天，真实是 4 天。
     ⑥ 「较昨日」条件自相矛盾（singleDay 与 daily.length>=2 互斥）→ 恒不显示。
     ⑦ 侧栏清单分类与卡贴三环形图两套算法：百分比四舍五入可合计 ≠100%、配色不同、
        第 4 色一个橙一个灰、侧栏不含「旧记录（无片段归类）」桶。
     ⑧ 账本卡片/深潜区用整段会话时长，跨午夜会话在「今天」卡片上写 41 分钟而当天贡献 0。
     ⑨ 热力矩阵固定 24 列且右端对齐本周周日 → 今天是周中时最左最多 6 天真实记录画不出来。

   本文件锁住这些修复的**可执行**部分（取整基准、侧栏/环形图同源、聚合桶）与
   渲染层的接线（源码契约，renderer 测试跑在 node 环境、没有 jsdom）。
   ──────────────────────────────────────────────────────────────────────────── */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8');

describe('统计时长取整基准（FL-STATS-ALIGNMENT）', () => {
  it('时长读数先四舍五入到分钟，再按 1 小时决定单位（v1.6.1 起）', () => {
    // 真实库：最近 7 天 52,311,690 ms。
    const ms = 52_311_690;
    expect(Math.round(ms / 60_000)).toBe(872); // 871.86 分钟 → 872
    expect(formatMinutes(ms)).toBe('14 小时 32 分钟');
    // 必须先取整到分钟再折小时，否则会出现 14.5时 对不上 14 小时 32 分钟。
    expect(formatStatDuration(ms)).toBe('14.5时');
  });

  it('不足 1 小时显示分钟（用户 m03054：不能再出现「今日看板 0.0时」）', () => {
    expect(formatStatDuration(2 * 60_000)).toBe('2 分钟');
    expect(formatStatDuration(50 * 60_000)).toBe('50 分钟');
    expect(formatStatDuration(59 * 60_000)).toBe('59 分钟');
    // 59.6 分钟四舍五入到 60 → 跨进小时制，不会出现「60 分钟」这种读数。
    expect(formatStatDuration(3_576_000)).toBe('1.0时');
    expect(formatStatDuration(60 * 60_000)).toBe('1.0时');
  });

  it('空值与 0 如实显示，不凭空兜底', () => {
    expect(formatStatDuration(0)).toBe('0 分钟');
    expect(formatStatDuration(-1)).toBe('0 分钟');
    expect(formatStatDuration(Number.NaN)).toBe('0 分钟');
    // 有记录但不足 1 分钟：如实说「<1 分钟」，不能显示成 0。
    expect(formatStatDuration(20_000)).toBe('<1 分钟');
  });
});

describe('侧栏清单分类与环形图同源（FL-STATS-ALIGNMENT）', () => {
  const tasks = [
    { key: 'local:a', taskId: 'a', title: '第二章第二节', activeMs: 100 * 60_000, segmentCount: 7 },
    { key: 'local:b', taskId: 'b', title: '每日古诗文', activeMs: 30 * 60_000, segmentCount: 2 },
    { key: 'local:c', taskId: 'c', title: '数学', activeMs: 5 * 60_000, segmentCount: 1 },
    { key: 'local:d', taskId: 'd', title: '英语', activeMs: 4 * 60_000, segmentCount: 1 },
    {
      key: 'unlinked:未关联任务',
      taskId: null,
      title: '未关联任务',
      activeMs: 10 * 60_000,
      segmentCount: 3,
    },
  ];
  // 分母是 totals.activeMs（200 分钟），比任务归属之和多 51 分钟 —— 差额是无片段的旧记录。
  const categories = buildStatsSidebarCategories(tasks, 200 * 60_000, 3);

  it('百分比来自最大余数法：整数且合计恰好 100，不再各自四舍五入', () => {
    const total = categories.reduce((sum, item) => sum + item.percent, 0);
    expect(total).toBe(100);
    expect(categories.every((item) => Number.isInteger(item.percent))).toBe(true);
  });

  it('聚合桶不再被 slice 掉：其他已关联任务 / 未关联任务 / 旧记录都在侧栏里', () => {
    const labels = categories.map((item) => item.label);
    expect(labels).toEqual([
      '第二章第二节',
      '每日古诗文',
      '数学',
      '其他已关联任务（1）',
      '未关联任务（1）',
      '旧记录（无片段归类）',
    ]);
    const legacy = categories.find((item) => item.label === '旧记录（无片段归类）');
    expect(legacy?.activeMs).toBe(51 * 60_000);
  });

  it('只有真实任务行可点击；聚合桶是静态读数行', () => {
    expect(categories.slice(0, 3).every((item) => item.clickable)).toBe(true);
    expect(categories.slice(3).some((item) => item.clickable)).toBe(false);
  });

  it('配色取自共用的 ALLOCATION_COLORS（与环形图同一调色板）', () => {
    expect(categories.map((item) => item.color)).toEqual([
      ALLOCATION_COLORS[0],
      ALLOCATION_COLORS[1],
      ALLOCATION_COLORS[2],
      ALLOCATION_COLORS[3],
      ALLOCATION_COLORS[4],
      ALLOCATION_COLORS[5],
    ]);
  });
});

describe('统计页渲染层接线（源码契约）', () => {
  const panel = read('src', 'features', 'history', 'HistoryPanel.tsx');
  const insights = read('src', 'features', 'history', 'HistoryInsights.tsx');
  const ledger = read('src', 'features', 'history', 'SessionLedger.tsx');
  const sidebar = read('src', 'features', 'history', 'StatsSidebar.tsx');
  const model = read('src', 'features', 'history', 'statsLedgerModel.tsx');
  const css = read('src', 'styles', 'stats-workbench.css');

  it('页头读数与卡贴一大数字共用 formatMinutes，不再有向下取整的第二套实现', () => {
    expect(panel).toContain('formatMinutes(viewAnalytics?.totals?.activeMs ?? 0)');
    expect(panel, '向下取整的 formatHoursMinutes 必须删干净').not.toContain('formatHoursMinutes');
    expect(model).not.toContain('formatHoursMinutes');
  });

  it('页头「N 个专注会话」用 totals.sessionCount（范围内真的有专注的会话数）', () => {
    expect(panel).toContain('viewAnalytics?.totals?.sessionCount ?? 0');
    expect(panel, '不能再用与范围重叠即计入的 sessions.length').not.toContain(
      'analytics?.sessions.length ?? 0',
    );
  });

  it('侧栏清单分类与卡贴三环形图同源同分母', () => {
    expect(panel).toContain('buildStatsSidebarCategories(');
    expect(panel).toContain('analytics?.totals?.activeMs ?? 0, 3');
    expect(model).toContain('buildDashboardTaskAllocation(tasks, totalFocusMs, limit)');
    expect(sidebar).toContain('side-item-static');
    expect(sidebar).toContain('aria-disabled="true"');
    expect(css).toContain('.side-item-static');
  });

  it('连续记录与「较昨日」都取自截止今天的 168 天序列', () => {
    expect(insights).toContain('const streakSeries =');
    expect(insights).toContain('heatmapDaily && heatmapDaily.length > 0 ? heatmapDaily');
    expect(insights).toContain('if (!singleDay || streakSeries.length < 2) return null;');
  });

  it('环形图用共用调色板，圆心与侧栏同一时长口径', () => {
    expect(insights).toContain('const colors = ALLOCATION_COLORS;');
    expect(insights).toContain('formatStatDuration(totalActive)');
  });

  it('多日视图（含「每日记录」）的时间线画整段范围', () => {
    expect(insights).toContain("title: '范围时间线'");
    expect(panel).toContain(
      "multiDayMode={curRange === '7d' || curRange === '30d' || curRange === 'heatmap'}",
    );
  });

  it('会话账本卡片与深潜区按当前范围裁切，并保留整段值', () => {
    expect(panel).toContain('clippedActiveBySession={clippedActiveBySession}');
    expect(panel).toContain('range={range}');
    expect(ledger).toContain('clippedActiveBySession?.[session.id]');
    expect(ledger).toContain('function scopedMs(');
    expect(ledger).toContain('sc-scope-note');
    expect(ledger).toContain('dd-scope-note');
    expect(ledger, '范围外没有片段的会话要如实说明，而不是显示旧记录文案').toContain(
      '这条会话在当前范围内没有片段或暂停。',
    );
    expect(css).toContain('.sc-scope-note');
    expect(css).toContain('.dd-scope-note');
  });

  it('热力矩阵列数按数据窗口反推，不再固定 24 列丢记录', () => {
    expect(insights).toContain('Math.ceil((HEATMAP_WINDOW_DAYS + endOffset) / 7)');
    expect(insights).not.toContain('HEATMAP_WEEKS - 1');
    expect(insights).toContain("data-future={cell.future ? 'true' : undefined}");
    expect(css).toContain(".hm-box[data-future='true']");
  });

  it('热力矩阵窗口外的前导格子必须隐形，不能画成「这天没有记录」', () => {
    expect(insights, '窗口起点取自数据序列第一天').toContain(
      'const windowStartKey = daily.length > 0 ? daily[0].date : null;',
    );
    expect(insights).toContain('outside: windowStartKey !== null && dateStr < windowStartKey,');
    expect(insights).toContain("data-outside={cell.outside ? 'true' : undefined}");
    expect(insights, '窗口外的格子不能带 tooltip').toMatch(
      /title={\s*cell\.outside\s*\?\s*undefined/,
    );
    expect(insights).toContain("visibility: cell.outside ? 'hidden' : undefined,");
  });

  it('死代码已清除：侧栏旧的内联百分比与 ledgerTotalsOf', () => {
    expect(model).not.toContain('ledgerTotalsOf');
    expect(panel).not.toContain("'#6366f1'");
    expect(panel, '侧栏百分比必须来自分配模型，不能自己 Math.round').not.toContain(
      'Math.round((task.activeMs / total) * 100)',
    );
  });
});
