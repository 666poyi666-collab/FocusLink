import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Final-cascade contract for the mobile touch targets and input font sizes.
 *
 * The per-file contracts in mobileResponsiveA11yContract.test.ts only inspect one
 * stylesheet at a time, so a later sheet can undo a 44px target or a 16px input and every
 * existing assertion still passes. This suite loads the sheets in the same order main.tsx
 * does and asserts the value the browser would actually apply.
 */

const mobileRoot = path.join(process.cwd(), 'src', 'mobile');
const mainSource = fs.readFileSync(path.join(mobileRoot, 'main.tsx'), 'utf8');
const CSS_FILES = [...mainSource.matchAll(/^import '\.\/([\w.-]+\.css)';$/gm)].map(
  (match) => match[1],
);

interface CssRule {
  selectors: string[];
  declarations: string;
  file: string;
  order: number;
}

function parseSheets(): CssRule[] {
  const rules: CssRule[] = [];
  for (const file of CSS_FILES) {
    const source = fs
      .readFileSync(path.join(mobileRoot, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const selectorText = match[1].trim().replace(/\s+/g, ' ');
      if (!selectorText || selectorText.startsWith('@')) continue;
      rules.push({
        selectors: selectorText.split(',').map((selector) => selector.trim()),
        declarations: match[2],
        file,
        order: rules.length,
      });
    }
  }
  return rules;
}

const rules = parseSheets();

function finalValue(selector: string, property: string): { value: string; file: string } | null {
  let resolved: { value: string; file: string } | null = null;
  for (const rule of rules) {
    // The 2.0 sheet scopes selectors under html[data-runtime='mobile-focus']; both forms must
    // resolve here, otherwise the newest sheet would look like it never applies.
    if (!rule.selectors.some((entry) => entry === selector || entry.endsWith(` ${selector}`))) {
      continue;
    }
    for (const declaration of rule.declarations.split(';')) {
      const [name, ...rest] = declaration.split(':');
      if (name?.trim() !== property) continue;
      resolved = { value: rest.join(':').trim(), file: rule.file };
    }
  }
  return resolved;
}

function expectValue(selector: string, property: string, value: string, file: string) {
  const resolved = finalValue(selector, property);
  expect(resolved, `${selector} { ${property} } is missing`).not.toBeNull();
  expect(resolved?.value).toBe(value);
  expect(resolved?.file).toBe(file);
}

describe('mobile final cascade contract', () => {
  it('loads the stylesheets in the documented mobile order', () => {
    expect(CSS_FILES.slice(0, 6)).toEqual([
      'mobile.css',
      'focuslink-2-mobile.css',
      'mobile-instruments.css',
      'mobile-confirm.css',
      'mobile-1-3.css',
      'mobile-2-0.css',
    ]);
  });

  it('keeps the task board complete control compact but 44px tappable', () => {
    expectValue('.task-board-check', 'width', '22px', 'mobile.css');
    expectValue('.task-board-check', 'height', '22px', 'mobile.css');
    expectValue('.task-board-check', 'position', 'relative', 'mobile.css');
    // The hit area is an invisible pseudo-element so the layout of the card does not grow.
    expectValue('.task-board-check::after', 'width', '44px', 'mobile.css');
    expectValue('.task-board-check::after', 'height', '44px', 'mobile.css');
  });

  it('keeps every phone input at 16px so focusing never zooms the page', () => {
    expectValue('.task-search input', 'font-size', '16px', 'focuslink-2-mobile.css');
    expectValue('.project-filter select', 'font-size', '16px', 'focuslink-2-mobile.css');
    expectValue('.task-add-destination select', 'font-size', '16px', 'mobile-1-3.css');
    expectValue('.task-add-destination select', 'min-height', '44px', 'mobile-1-3.css');
  });

  it('keeps the statistics timeline lane reachable and its list buttons at 48px', () => {
    // The lane bar is only a pointer shortcut; the 44px band keeps it tappable while the
    // interval fills stay visually thin, and the button list below stays the keyboard path.
    expectValue('.mobile-day-lane > div', 'height', '44px', 'focuslink-2-mobile.css');
    expectValue('.timeline-interval-choice', 'min-height', '48px', 'mobile-1-3.css');
  });

  it('keeps the account device actions and the native repair action at 44px', () => {
    expectValue('.account-device-row button', 'width', '44px', 'focuslink-2-mobile.css');
    expectValue('.account-device-row button', 'min-height', '44px', 'focuslink-2-mobile.css');
    expectValue('.native-terminal-ledger-repair button', 'min-height', '44px', 'mobile-2-0.css');
  });
});
