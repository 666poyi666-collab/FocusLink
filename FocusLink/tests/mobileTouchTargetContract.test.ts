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
 *
 * 1.6.9 迁移：层序变成「旧样式总表 mobile-parity-base.css 先、新设计语言层 mobile.css 最后」。
 * 新层每条选择器都带 html[data-runtime='mobile-focus']，所以下面的 finalValue 是真实最终值：
 * 新层接管的控件断言新层 token，尚未接管的控件继续断言旧层绝对值。
 */

const mobileRoot = path.join(process.cwd(), 'src', 'mobile');
const mainSource = fs.readFileSync(path.join(mobileRoot, 'main.tsx'), 'utf8');
const CSS_FILES = [...mainSource.matchAll(/^import '\.\/([\w.-]+\.css)';$/gm)].map(
  (match) => match[1],
);
const DOCUMENTED_CSS_ORDER = [
  'mobile-parity-base.css',
  'focuslink-2-mobile.css',
  'mobile-instruments.css',
  'mobile-confirm.css',
  'mobile-1-3.css',
  'mobile-2-0.css',
  'mobile.css',
];
const mobileLayerSource = fs.readFileSync(path.join(mobileRoot, 'mobile.css'), 'utf8');

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
    // Both the legacy bare selectors and the new html[data-runtime='mobile-focus']-scoped
    // selectors must resolve here, otherwise the newest sheet would look like it never applies.
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
    expect(CSS_FILES).toEqual(DOCUMENTED_CSS_ORDER);
    // 新设计语言层必须是最后一条：靠后加载 + html[data-runtime] 提权才能压住旧层。
    expect(CSS_FILES.at(-1)).toBe('mobile.css');
    expect(CSS_FILES.filter((file) => file === 'mobile.css')).toHaveLength(1);
  });

  it('keeps the task board complete control compact but 48px tappable', () => {
    // 新设计语言：命中区就是按钮本身（--m-hit 48），视觉圆点缩成 20px 的 svg，卡片布局不长高。
    expectValue('.task-board-check', 'width', 'var(--m-hit)', 'mobile.css');
    expectValue('.task-board-check', 'height', 'var(--m-hit)', 'mobile.css');
    expectValue('.task-board-check', 'min-width', 'var(--m-hit)', 'mobile.css');
    expectValue('.task-board-check', 'min-height', 'var(--m-hit)', 'mobile.css');
    expectValue('.task-board-check > svg', 'width', '20px', 'mobile.css');
    expectValue('.task-board-check > svg', 'height', '20px', 'mobile.css');
    // token 必须是 48px；旧的 22px 圆点 + 44px 不可见伪元素方案已经不需要。
    expect(mobileLayerSource).toMatch(/--m-hit:\s*48px;/);
    expect(mobileLayerSource).toMatch(/--m-row:\s*72px;/);
  });

  it('keeps every phone input at 16px so focusing never zooms the page', () => {
    // 新层把输入统一到 --m-body-size（=16px），旧层逐页字号不再决定最终结果。
    expectValue('.task-search input', 'font-size', 'var(--m-body-size)', 'mobile.css');
    expectValue('.task-search input', 'min-height', 'var(--m-seg)', 'mobile.css');
    expectValue('.task-add-destination > select', 'font-size', 'var(--m-body-size)', 'mobile.css');
    expectValue('.task-add-destination > select', 'min-height', 'var(--m-hit)', 'mobile.css');
    expectValue('select', 'font-size', 'var(--m-body-size)', 'mobile.css');
    expectValue('textarea', 'font-size', 'var(--m-body-size)', 'mobile.css');
    // 旧层仍有兜底（尚未被新层重写的选择框）。
    expectValue('.project-filter select', 'font-size', '16px', 'focuslink-2-mobile.css');
    expectValue('.task-add-destination select', 'font-size', '16px', 'mobile-1-3.css');
    expect(mobileLayerSource).toMatch(/--m-body-size:\s*16px;/);
  });

  it('keeps the statistics interval list buttons at the 48px hit floor', () => {
    // 区间按钮列表是键盘与触摸的主路径，取 --m-hit。
    expectValue('.timeline-interval-choice', 'min-height', 'var(--m-hit)', 'mobile.css');
    expectValue('.timeline-interval-choice', 'border-radius', 'var(--m-r-md)', 'mobile.css');
    // 泳道条本身也是 48px 命中区（规范 ≥44，设计取 48）：高度只允许取 --m-hit，不许回退成细条。
    expectValue('.mobile-day-lane', 'min-height', 'var(--m-hit)', 'mobile.css');
    const trackGeometry = [
      finalValue('.mobile-day-lane-track', 'height'),
      finalValue('.mobile-day-lane-track', 'min-height'),
    ].filter((entry): entry is { value: string; file: string } => entry !== null);
    expect(trackGeometry.length, '.mobile-day-lane-track 必须有高度声明').toBeGreaterThan(0);
    for (const entry of trackGeometry) {
      expect(entry.value, '泳道条高度只允许取 --m-hit').toBe('var(--m-hit)');
      expect(entry.file).toBe('mobile.css');
    }
    expectValue('.mobile-day-lane-track', 'cursor', 'pointer', 'mobile.css');
    expect(mobileLayerSource).toMatch(/--m-hit:\s*48px;/);
  });

  it('keeps the account device actions and the native repair action at 44px', () => {
    expectValue('.account-device-row button', 'width', '44px', 'focuslink-2-mobile.css');
    expectValue('.account-device-row button', 'min-height', '44px', 'focuslink-2-mobile.css');
    // 设置页修复按钮已迁到新层，命中高度取 --m-hit（48px ≥ 44 底限）。
    expectValue(
      '.native-terminal-ledger-repair button',
      'min-height',
      'var(--m-hit)',
      'mobile.css',
    );
  });
});
