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
