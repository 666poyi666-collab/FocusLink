import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readProjectFile(...segments: string[]): string {
  return fs.readFileSync(path.join(projectRoot, ...segments), 'utf8');
}

const hookSource = readProjectFile('src', 'mobile', 'useViewTransition.ts');
const mobileAppSource = readProjectFile('src', 'mobile', 'MobileApp.tsx');
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

describe('mobile view transition', () => {
  it('uses the native View Transitions API and commits the new view synchronously', () => {
    expect(hookSource).toContain('startViewTransition');
    expect(hookSource).toContain('flushSync(');
    expect(hookSource).toContain("'(prefers-reduced-motion: reduce)'");
    // 事件必须先派发：降级路径也要能被观察，断言分支在后。
    expect(hookSource.indexOf("'fl:view-transition'")).toBeLessThan(
      hookSource.indexOf('if (animated'),
    );
  });

  it('routes every bottom navigation change through the transition hook', () => {
    expect(mobileAppSource).toContain('useViewTransition(activeView');
    expect(mobileAppSource).toContain('onChange={changeView}');
    expect(mobileAppSource).not.toContain('onChange={setActiveView}');
  });

  it('names the workspace for the crossfade and keeps the root snapshot static', () => {
    expectDeclaration('.mobile-workspace', 'view-transition-name', 'mobile-workspace');
    expectDeclaration('::view-transition-old(root)', 'animation', 'none');
    expectDeclaration('::view-transition-new(root)', 'animation', 'none');
    expect(cssRoot.toString()).toContain('@keyframes fl-vt-in');
    expect(cssRoot.toString()).toContain('@keyframes fl-vt-out');
  });
});
