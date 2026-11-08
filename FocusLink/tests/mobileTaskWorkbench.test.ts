import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SyncedTask, SyncedTaskProject } from '../shared/sync/taskSnapshotProtocol';
import { TickTickTaskPage } from '../src/mobile/TickTickTaskPage';

/**
 * 任务页工作台化的契约：搜索 / 批量 / 子任务 / 异步反馈。
 *
 * 这里既做真实渲染（缺省 props 不许崩），也做源码断言：CSS 与回调写在别处，
 * 只有组件真的把 state 接到 DOM 上，工作台才算落地。
 */

const pageSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'mobile', 'TickTickTaskPage.tsx'),
  'utf8',
);

function sliceSource(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `${start} 不存在`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from);
  expect(to, `${end} 不存在`).toBeGreaterThan(from);
  return source.slice(from, to);
}

const project: SyncedTaskProject = { id: 'p-1', source: 'local', name: '工作', color: '#16899f' };
const openTask: SyncedTask = {
  id: 't-1',
  source: 'local',
  projectId: 'p-1',
  title: '写周报',
  status: null,
  priority: 2,
  dueDate: null,
  tags: ['工作'],
  parentId: null,
  isCompleted: false,
  updatedAt: 1_700_000_000_000,
};

type PageProps = Parameters<typeof TickTickTaskPage>[0];

/** 只给必需 props：四个新回调全部缺省，缺省路径必须自己降级。 */
function renderPage(overrides: Partial<PageProps> = {}): string {
  const props: PageProps = {
    tasks: [openTask],
    projects: [project],
    selectedTaskId: '',
    canStart: true,
    publishedAt: 1_700_000_000_000,
    revision: 7,
    onSelect: () => undefined,
    onStart: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(TickTickTaskPage, props));
}

describe('task workbench renders without the new callbacks', () => {
  it('renders a compact search box and no per-row select button', () => {
    const html = renderPage();
    expect(html).toContain('aria-label="搜索任务或标签"');
    expect(html).toContain('写周报');
    // v1.10.6：每行的「选择」常驻按钮已移除，批量入口只留长按与菜单。
    expect(html).not.toContain('tt-row-select');
    // 没进入批量模式时不渲染底部操作条。
    expect(html).not.toContain('aria-label="批量操作"');
    // 详情面板未打开时不应提前渲染子任务输入。
    expect(html).not.toContain('placeholder="添加子任务"');
  });

  it('keeps the plain empty state when nothing is typed', () => {
    const html = renderPage({ tasks: [], projects: [] });
    expect(html).toContain('还没有任务');
    expect(html).not.toContain('没有匹配的任务');
  });

  it('puts the search box above the list so search cannot reorder it', () => {
    const html = renderPage();
    const search = html.indexOf('tt-search');
    const row = html.indexOf('tt-row');
    expect(search).toBeGreaterThanOrEqual(0);
    expect(row).toBeGreaterThan(search);
  });
});

describe('search contract', () => {
  it('feeds the query into the existing forest filter instead of a second pipeline', () => {
    expect(pageSource).toMatch(/filterSyncedTaskForest\(\s*displayTasks,\s*trimmedQuery,/);
    expect(pageSource).toMatch(/\[displayTasks, projects, showCompleted, trimmedQuery\]/);
    // 搜索只过滤，不排序：层级与顺序都交给 filterSyncedTaskForest。
    expect(pageSource).not.toMatch(/\.sort\(/);
  });

  it('keeps a clear entry in both the search box and the no-match state', () => {
    expect(pageSource).toMatch(/placeholder="搜索任务或标签"/);
    expect(pageSource).toMatch(/aria-label="清除搜索"/);
    const empty = sliceSource(pageSource, '{searchEmpty ? (', ') : activeGroups.length === 0 ? (');
    expect(empty).toMatch(/没有匹配的任务/);
    expect(empty).toMatch(/清除搜索/);
    expect(empty).toMatch(/tt-empty-action/);
  });
});

describe('batch mode contract', () => {
  it('opens from a long press and the overflow menu, with no per-row button', () => {
    expect(pageSource).toMatch(/const LONG_PRESS_MS = 480;/);
    expect(pageSource).toMatch(/longPressRef\.current = window\.setTimeout\(\(\) => \{/);
    expect(pageSource).toMatch(/onEnterSelectMode\(node\)/);
    expect(pageSource).not.toMatch(/tt-row-select/);
    // 批量模式下的复选框本身可点：不能只是装饰。
    expect(pageSource).toMatch(/className="tt-check tt-select-mark"/);
    expect(pageSource).toMatch(/批量选择/);
    expect(pageSource).toMatch(/data-select-mode=\{selectMode\}/);
  });

  it('shows a count, a selected row state and the three bulk actions', () => {
    expect(pageSource).toMatch(/已选 \{selectedCount\} 项/);
    expect(pageSource).toMatch(/data-selected=\{selectMode \? selected : undefined\}/);
    expect(pageSource).toMatch(/aria-pressed=\{selectMode \? selected : undefined\}/);
    // 三个动作各自绑定一条批量通道，删除文案随二次确认切换。
    expect(pageSource).toMatch(/onClick=\{batchComplete\}/);
    expect(pageSource).toMatch(/onClick=\{batchDelete\}/);
    expect(pageSource).toMatch(/setBatchMoveOpen\(\(current\) => !current\)/);
    expect(pageSource).toMatch(/onSetTasksCompleted/);
    expect(pageSource).toMatch(/onDeleteTasks/);
    expect(pageSource).toMatch(/onMoveTasks/);
  });

  it('requires a second click before deleting and resets everything on exit', () => {
    expect(pageSource).toMatch(/确认删除 \$\{selectedCount\} 项/);
    const exit = sliceSource(
      pageSource,
      'const exitSelectMode = () => {',
      'const toggleSelected = (task: SyncedTask) => {',
    );
    expect(exit).toMatch(/setSelectMode\(false\)/);
    expect(exit).toMatch(/setSelection\(new Set\(\)\)/);
    expect(exit).toMatch(/setBatchConfirmDelete\(false\)/);
    expect(exit).toMatch(/setBatchMoveOpen\(false\)/);
  });

  it('disables the actions while busy but never the cancel path', () => {
    const bar = sliceSource(
      pageSource,
      '<div className="tt-batch" role="toolbar"',
      'className="tt-fab"',
    );
    expect(bar).toMatch(/role="alert"/);
    expect(bar).toMatch(/处理中…/);
    expect(bar).toMatch(
      /disabled=\{batchBusy \|\| selectedCount === 0 \|\| !onSetTasksCompleted\}/,
    );
    expect(bar).toMatch(/disabled=\{batchBusy \|\| selectedCount === 0 \|\| !onDeleteTasks\}/);
    expect(bar).toMatch(/disabled=\{batchBusy \|\| selectedCount === 0 \|\| !onMoveTasks\}/);
    // 取消按钮是单行标签：没有 disabled，请求进行中也能退出批量。
    expect(bar).toMatch(
      /<button type="button" className="tt-batch-action" onClick=\{exitSelectMode\}>/,
    );
    // 「全选」= 屏幕上真的看得到的行，折叠起来的子任务不参与。
    expect(pageSource).toMatch(/\(id\) => collapsed\.has\(id\)/);
  });

  it('reports a failed batch inline and keeps the selection for a retry', () => {
    const runner = sliceSource(
      pageSource,
      'const runBatchAction = (',
      'const batchComplete = () => {',
    );
    expect(runner).toMatch(/\.catch\(/);
    expect(runner).toMatch(/setBatchError/);
    // 成功才退出批量：失败路径里不允许出现退出动作。
    expect(runner.match(/setSelectMode\(false\)/g)?.length).toBe(1);
  });
});

describe('subtask contract', () => {
  it('adds subtasks from the detail panel and keeps it open on failure', () => {
    expect(pageSource).toMatch(/onCreateSubtask/);
    expect(pageSource).toMatch(/placeholder="添加子任务"/);
    expect(pageSource).toMatch(/aria-label="子任务标题"/);
    const add = sliceSource(pageSource, 'const addSubtask = () => {', 'const moveSelectedTask = (');
    expect(add).toMatch(/\.catch\(/);
    expect(add).toMatch(/setSubtaskError/);
    expect(add).not.toMatch(/setDetailTaskId\(null\)/);
  });

  it('surfaces a failed subtask toggle on its own row', () => {
    expect(pageSource).toMatch(/rowErrors\[child\.id\]/);
    const childList = sliceSource(
      pageSource,
      '{detailChildren.length > 0 ? (',
      '{onCreateSubtask ? (',
    );
    expect(childList).toMatch(/setTaskCompleted\(child, !child\.isCompleted\)/);
    expect(childList).toMatch(/role="alert"/);
  });

  it('gates the add button while the request is in flight', () => {
    expect(pageSource).toMatch(/disabled=\{subtaskBusy \|\| subtaskDraft\.trim\(\) === ''\}/);
    expect(pageSource).toMatch(/添加中…/);
    expect(pageSource).toMatch(/\.then\(\(\) => setSubtaskDraft\(''\)\)/);
  });
});

describe('feedback and return paths', () => {
  it('gives every async surface a catch instead of a floating promise', () => {
    const catches = pageSource.match(/\.catch\(\(reason: unknown\)/g) ?? [];
    expect(catches.length).toBeGreaterThanOrEqual(7);
    expect(pageSource).not.toMatch(/void onMoveTask\(target, project\.id\)/);
  });

  it('reports a failed move in the picker and in the detail panel', () => {
    const handler = sliceSource(
      pageSource,
      'const moveSelectedTask = (',
      'const moveDetailTask = (',
    );
    expect(handler).toMatch(/setMoveError/);
    // 浮层里的清单按钮在 busy 期间禁用，错误就地显示，取消随时可点。
    const sheet = sliceSource(pageSource, '{moveTaskId ? (', '{detailTask ? (');
    expect(sheet).toMatch(/disabled=\{moveBusy\}/);
    expect(sheet).toMatch(/\{moveError \? \(/);
    expect(sheet).toMatch(/onClick=\{\(\) => setMoveTaskId\(null\)\}/);
    const detail = sliceSource(pageSource, 'const moveDetailTask = (', 'const renderNodes = (');
    expect(detail).toMatch(/setEditError/);
  });

  it('closes the topmost layer on Esc and keeps a visible cancel everywhere', () => {
    expect(pageSource).toMatch(/window\.addEventListener\('keydown', handleKeyDown\)/);
    expect(pageSource).toMatch(/if \(event\.key !== 'Escape'\) return;/);
    expect(pageSource).toMatch(/className="tt-composer-cancel"/);
    expect(pageSource).toMatch(/取消移动/);
    expect(pageSource).toMatch(/aria-label="返回任务列表"/);
  });
});
