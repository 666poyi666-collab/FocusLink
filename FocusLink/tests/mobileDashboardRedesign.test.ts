import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CachedBundle } from '../src/mobile/cache';
import { DashboardView } from '../src/mobile/DashboardView';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readProjectFile(...segments: string[]): string {
  return fs.readFileSync(path.join(projectRoot, ...segments), 'utf8');
}

const dashboardSource = readProjectFile('src', 'mobile', 'DashboardView.tsx');
// prettier 会按行宽折行，语义断言在折叠空白后的源码上做。
const dashboardSourceFlat = dashboardSource.replace(/\s+/g, ' ');
const cssRoot = postcss.parse(readProjectFile('src', 'mobile', 'mobile.css'));

function declarationsFor(selectorPart: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  cssRoot.walkRules((rule: Rule) => {
    if (!rule.selectors.some((selector) => selector.includes(selectorPart))) return;
    const declarations = (rule.nodes ?? []).filter(
      (node) => node.type === 'decl',
    ) as unknown as Array<{ prop: string; value: string }>;
    rows.push(Object.fromEntries(declarations.map((node) => [node.prop, node.value])));
  });
  return rows;
}

function expectDeclaration(selectorPart: string, property: string, value: string): void {
  const matched = declarationsFor(selectorPart).some((row) => row[property] === value);
  expect(matched, `${selectorPart} should declare ${property}: ${value}`).toBe(true);
}

describe('mobile dashboard redesign (v1.11.1)', () => {
  it('counts a focus streak that survives a morning visit without focus', () => {
    expect(dashboardSourceFlat).toContain('const focusStreak = useMemo(');
    expect(dashboardSourceFlat).toContain('while (focusedDays.has(cursor))');
    expect(dashboardSourceFlat).toContain('shiftDayKey(cursor, -1)');
    expect(dashboardSourceFlat).toContain('className="dash-streak"');
  });

  it('marks the current day column inside the daily trend', () => {
    expect(dashboardSourceFlat).toContain('const todayKey = dayKey(referenceNow);');
    expect(dashboardSourceFlat).toContain("ledger.date === todayKey ? 'is-today' : ''");
    expect(dashboardSourceFlat).toContain('referenceNow={referenceNow}');
  });

  it('keeps the three summary numbers but renders them as cards', () => {
    expect(dashboardSourceFlat).toContain('dashboard-summary dash-metrics');
    expectDeclaration('.dashboard-summary.dash-metrics', 'display', 'grid');
    expectDeclaration('.dash-metrics .dashboard-summary-item', 'border-radius', '14px');
  });

  it('turns each dashboard band into a panel and highlights today', () => {
    expectDeclaration('.dashboard-view .dashboard-band', 'border-radius', '16px');
    expectDeclaration('.dashboard-view .dashboard-band', 'padding', '14px 14px 12px');
    expectDeclaration(
      '.daily-ledger-trend > button.is-today',
      'background',
      'rgb(var(--app-accent) / 0.08)',
    );
    expectDeclaration('.daily-ledger-bar > i.focus', 'width', '22px');
  });
});
describe('mobile dashboard redesign render (v1.11.1)', () => {
  it('renders metric cards, streak and the today column with real records', () => {
    const referenceNow = new Date(2026, 6, 21, 12, 0, 0, 0).getTime();
    const records = [
      makeRecord(referenceNow, 0, 'today-1'),
      makeRecord(referenceNow, -1, 'yesterday-1'),
      makeRecord(referenceNow, -2, 'before-yesterday-1'),
    ];
    const markup = renderToStaticMarkup(
      createElement(DashboardView, {
        records,
        ready: true,
        configured: true,
        lastSyncAt: referenceNow,
        cursor: 'cursor-1',
        referenceNow,
      }),
    );

    expect(markup).toContain('class="dashboard-summary dash-metrics"');
    expect(markup).toContain('<strong>3</strong><span>专注次数</span>');
    expect(markup).toContain('<span>平均时长</span>');
    expect(markup).toContain('<span>最长连续</span>');
    expect(markup.match(/class="dashboard-band/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(markup).toContain('连续专注 3 天');
    expect(markup).toContain('data-active="true"');
    expect(markup.match(/ is-today/g) ?? []).toHaveLength(1);
    expect(markup).toContain('has-focus is-max is-today');
  });
});

function makeRecord(referenceNow: number, dayOffset: number, suffix: string): CachedBundle {
  const day = new Date(referenceNow);
  day.setDate(day.getDate() + dayOffset);
  day.setHours(9, 0, 0, 0);
  const startedAt = day.getTime();
  return {
    entityId: `session-${suffix}`,
    revision: 1,
    changeSeq: 1,
    sourceDeviceId: 'tablet-1',
    bundle: {
      session: {
        id: `session-${suffix}`,
        title: '函数复习',
        status: 'finished',
        startedAt,
        endedAt: startedAt + 30 * 60_000,
        activeElapsedMs: 25 * 60_000,
        pauseElapsedMs: 5 * 60_000,
        wallElapsedMs: 30 * 60_000,
        defaultTaskId: null,
        defaultTaskSource: null,
        defaultTaskTitle: '函数复习',
        note: null,
        createdAt: startedAt,
        updatedAt: startedAt + 30 * 60_000,
      },
      segments: [
        {
          id: `segment-${suffix}`,
          sessionId: `session-${suffix}`,
          taskId: null,
          taskSource: null,
          title: '函数复习',
          startedAt,
          endedAt: startedAt + 25 * 60_000,
          activeElapsedMs: 25 * 60_000,
          note: null,
          tomatodoSubject: null,
          createdAt: startedAt,
          updatedAt: startedAt + 25 * 60_000,
        },
      ],
      pauses: [],
    },
  } as CachedBundle;
}
