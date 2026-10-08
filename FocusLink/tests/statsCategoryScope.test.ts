import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildStatsSidebarCategories,
  formatStatDuration,
} from '../src/features/history/statsLedgerModel';

/* ────────────────────────────────────────────────────────────────────────────
   统计页「分类筛选 + 时长读数」契约（v1.6.1）

   为什么有这道测试（用户 m03054 原话）：
     「2，可以1h内就显示分钟。还有就是切换到每个分类的时候应该显示那个分类的时间吧，
      同理还有很多地方需要优化。」

   两件事：
     ① 侧栏读数不再用小时制把小数值四舍五入成 0.0（2 分钟显示成「今日看板 0.0时」）：
        不足 1 小时说分钟，1 小时以上才说小数小时，且与页头 / 环形圆心同一取整基准。
     ② 点清单分类要「整张画卷跟着走」：筛选**下推到主进程**（scopeAnalyticsSource），
        页头 / hero / 时间线 / 按小时分布 / 环形图 / 排行榜 / 热力 / 账本 / 导出
        全部读同一份「只含该分类」的 analytics，而不是各卡片自己过滤（那正是同一份时长
        在不同卡片上各说各话的来源）。

   renderer 测试跑在 node 环境（没有 jsdom），所以这里锁「纯函数读数」+「源码接线」。
   ──────────────────────────────────────────────────────────────────────────── */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8');
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('侧栏时长读数（v1.6.1）', () => {
  const tasks = [
    { key: 'local:a', taskId: 'a', title: '每日古诗文', activeMs: 2 * 60_000, segmentCount: 1 },
    { key: 'local:b', taskId: 'b', title: '数学', activeMs: 90 * 60_000, segmentCount: 3 },
    {
      key: 'unlinked:未关联任务',
      taskId: null,
      title: '未关联任务',
      activeMs: 30 * 60_000,
      segmentCount: 1,
    },
  ];
  const categories = buildStatsSidebarCategories(tasks, 122 * 60_000, 3);

  it('每个分类行都带自己的时长读数，不再只显示百分比', () => {
    const byLabel = new Map(
      categories.map((item): [string, string] => [item.label, item.durationLabel]),
    );
    expect(byLabel.get('数学')).toBe('1.5时');
    expect(byLabel.get('每日古诗文')).toBe('2 分钟');
    // 聚合桶（未关联任务）即使时长比某个真实任务长，也排在真实任务之后：它只是占比读数行。
    const bucket = categories.find((item) => !item.clickable);
    expect(bucket?.label).toContain('未关联任务');
    expect(bucket?.durationLabel).toBe('30 分钟');
    expect(categories.map((item) => item.clickable)).toEqual([true, true, false]);
  });

  it('分类时长与全局时长格式化同源（不会出现两套取整）', () => {
    expect(categories.map((item) => item.durationLabel)).toEqual(
      categories.map((item) => formatStatDuration(item.activeMs)),
    );
  });

  it('不足 1 分钟但有记录时如实说「<1 分钟」，不能显示成 0', () => {
    const tiny = buildStatsSidebarCategories(
      [{ key: 'local:t', taskId: 't', title: '英语', activeMs: 20_000, segmentCount: 1 }],
      20_000,
      3,
    );
    expect(tiny[0].durationLabel).toBe('<1 分钟');
  });
});

describe('统计页分类筛选接线（源码契约，v1.6.1）', () => {
  const panel = read('src', 'features', 'history', 'HistoryPanel.tsx');
  const sidebar = read('src', 'features', 'history', 'StatsSidebar.tsx');
  const insights = read('src', 'features', 'history', 'HistoryInsights.tsx');
  const css = read('src', 'styles', 'stats-workbench.css');
  const ipc = read('electron', 'ipc.ts');
  const api = read('shared', 'ipc', 'api.ts');
  const sharedAnalytics = read('shared', 'sessionAnalytics.ts');

  it('筛选键就是清单分类的 key，「全部分类」等价于 null', () => {
    expect(panel).toContain(
      "const activeTaskKey = projectFilter === 'all' ? null : projectFilter;",
    );
  });

  it('两份请求都带 taskKey：画卷那份 + 侧栏 168 天那份', () => {
    // 侧栏「今日看板 / 最近 7 天 / 最近 30 天」与热力矩阵也必须跟着分类走，
    // 否则用户切了分类会看到「画卷只剩 2 分钟，侧栏还说 14.8时」。
    expect(occurrences(panel, 'taskKey: activeTaskKey,')).toBe(2);
  });

  it('画卷统一读 viewAnalytics：选了分类读收窄结果，否则读全量', () => {
    expect(panel).toContain('const viewAnalytics = activeTaskKey ? scopedAnalytics : analytics;');
  });

  it('页头 / 卡贴 / 账本 / 导出全部改读 viewAnalytics', () => {
    expect(panel).toContain('formatMinutes(viewAnalytics?.totals?.activeMs ?? 0)');
    expect(panel).toContain('viewAnalytics?.totals?.sessionCount ?? 0');
    expect(panel).toContain('analytics={viewAnalytics}');
    expect(panel).toContain('clippedActiveBySession={clippedActiveBySession}');
    expect(panel).toContain('JSON.stringify(viewAnalytics, null, 2)');
    expect(panel).toContain('disabled={!viewAnalytics}');
    expect(panel).toContain('!viewAnalytics && (');
  });

  it('侧栏「清单分类」列表仍读未过滤数据，否则筛完只剩一个分类就切不回去了', () => {
    expect(panel).toContain(
      'buildStatsSidebarCategories(analytics?.tasks ?? [], analytics?.totals?.activeMs ?? 0, 3)',
    );
  });

  it('页头有分类 chip：看得见当前筛选，且一键清除', () => {
    expect(panel).toContain('id="activeCategoryChip"');
    expect(panel).toContain('分类：{activeCategoryLabel}');
    expect(panel).toContain("onClick={() => setProjectFilter('all')}");
    expect(css).toContain('.scope-chip {');
  });

  it('侧栏「全部分类」显示范围总时长，不再写死 100%', () => {
    expect(sidebar).toContain('totalDurationLabel: string;');
    expect(sidebar).toContain('{totalDurationLabel}');
    expect(sidebar).not.toContain('<span className="nav-num">100%</span>');
    expect(panel).toContain(
      'totalDurationLabel={formatStatDuration(analytics?.totals?.activeMs ?? 0)}',
    );
  });

  it('可点分类行与聚合桶行都显示时长，占比退到 title 里', () => {
    // nav-num 里的读数：可点分类行与聚合桶行各一处（title 里也带时长，所以不能全文件计数）。
    expect(occurrences(sidebar, '<span className="nav-num">{category.durationLabel}</span>')).toBe(
      2,
    );
    expect(sidebar).not.toContain('<span className="nav-num">{category.percent}%</span>');
    expect(sidebar).toContain('占当前范围 ${category.percent}%');
  });

  it('环形圆心与侧栏同一时长口径', () => {
    expect(insights).toContain('formatStatDuration(totalActive)');
    expect(insights).not.toContain('compactHours');
  });

  it('主进程先收窄 source 再算统计，并拒绝非法 taskKey', () => {
    expect(ipc).toContain('const source = { sessions, segments, pauses };');
    expect(ipc).toContain(
      'return buildSessionAnalytics(range, scopeAnalyticsSource(source, range.taskKey ?? null));',
    );
    expect(ipc).toContain(
      "range.taskKey !== undefined && range.taskKey !== null && typeof range.taskKey !== 'string'",
    );
  });

  it('接口类型带可选 taskKey（渲染层才能把它传下去）', () => {
    expect(api).toContain('taskKey?: string | null;');
  });

  it('分类 key 只保留一份实现：sessionAnalytics 调用 segmentTaskKey', () => {
    expect(sharedAnalytics).toContain('segmentTaskKey(segment)');
    // 旧的内联模板一旦复活，侧栏筛选与 tasks[].key 又会各算各的。
    expect(sharedAnalytics).not.toContain('unlinked:${segment.title?.trim()');
  });
});
