import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule, type Node, type Root, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readProjectFile(...segments: string[]): string {
  return fs.readFileSync(path.join(projectRoot, ...segments), 'utf8');
}

const mobileCss = readProjectFile('src', 'mobile', 'mobile.css');
const mobileRoot = postcss.parse(mobileCss);
const legacyCss = readProjectFile('src', 'mobile', 'mobile-parity-base.css');
const mobile13Root = postcss.parse(readProjectFile('src', 'mobile', 'mobile-1-3.css'));
const focuslink2MobileRoot = postcss.parse(
  readProjectFile('src', 'mobile', 'focuslink-2-mobile.css'),
);

// 1.6.9 起旧样式总表整体搬到 mobile-parity-base.css（main.tsx 加载序第 1），新的设计语言层
// mobile.css 最后加载，且每条规则都以 html[data-runtime='mobile-focus'] 提权。因此这里分两层看：
//   - 新层已经接管的保证 → 断言 mobile.css（最终生效者）；
//   - 新层还没接管、仍由旧表兜底的保证 → 断言 mobile-parity-base.css 里的旧 Apple 层切片。
const legacyAppleMarker = '/* Apple platform surface';
const legacyAppleOffset = legacyCss.indexOf(legacyAppleMarker);

if (legacyAppleOffset < 0) {
  throw new Error('mobile-parity-base.css is missing the Apple platform surface marker');
}

const appleRoot = postcss.parse(legacyCss.slice(legacyAppleOffset));

const mobileScope = "html[data-runtime='mobile-focus']";
const scoped = (selector: string): string => `${mobileScope} ${selector}`;

type RuleContext = {
  media?: string | null;
  supports?: string;
};

function ancestorParams(rule: Rule, name: string): string[] {
  const params: string[] = [];
  let parent: Node | undefined = rule.parent;
  while (parent) {
    if (parent.type === 'atrule') {
      const atRule = parent as AtRule;
      if (atRule.name === name) params.push(atRule.params);
    }
    parent = parent.parent;
  }
  return params;
}

function declarations(rule: Rule): Record<string, string> {
  const values: Record<string, string> = {};
  for (const node of rule.nodes ?? []) {
    if (node.type === 'decl') {
      values[node.prop] = `${node.value}${node.important ? ' !important' : ''}`;
    }
  }
  return values;
}

// prettier 会把长选择器折成多行，postcss 的 rule.selectors 保留原始换行与缩进。
// 比较前把空白折叠成单个空格，让断言对源码排版免疫（语义完全相同）。
const normalizeSelector = (value: string): string => value.replace(/\s+/g, ' ').trim();

function findRule(
  root: Root,
  selector: string,
  expected: Record<string, string>,
  context: RuleContext = {},
): Rule | undefined {
  let match: Rule | undefined;
  const wanted = normalizeSelector(selector);
  root.walkRules((rule) => {
    if (match || !rule.selectors.map(normalizeSelector).includes(wanted)) return;

    const media = ancestorParams(rule, 'media');
    const supports = ancestorParams(rule, 'supports');
    if (context.media === null && media.length > 0) return;
    if (typeof context.media === 'string' && !media.includes(context.media)) return;
    if (typeof context.supports === 'string' && !supports.includes(context.supports)) return;

    const values = declarations(rule);
    if (Object.entries(expected).every(([property, value]) => values[property] === value)) {
      match = rule;
    }
  });
  return match;
}

function expectRule(
  root: Root,
  selector: string,
  expected: Record<string, string>,
  context: RuleContext = {},
): void {
  expect(
    findRule(root, selector, expected, context),
    `${selector} should declare ${JSON.stringify(expected)} in ${JSON.stringify(context)}`,
  ).toBeDefined();
}

describe('mobile responsive and accessibility review contract', () => {
  it('keeps every width below 1040 on bottom tabs and only opens the 1040 sidebar', () => {
    const sidebarMedia = '(min-width: 1040px)';

    // <1040（360 / 412 / 640×1024 / 760×1024 / 915×412 短横屏）：单列 + 底部四项导航。
    expectRule(
      mobileRoot,
      scoped('.app-frame'),
      { display: 'flex', 'flex-direction': 'column' },
      { media: null },
    );
    expectRule(
      mobileRoot,
      scoped('.app-navigation'),
      {
        position: 'fixed',
        right: '0',
        bottom: '0',
        left: '0',
        display: 'grid',
        'grid-template-columns': 'repeat(4, 1fr)',
        height: 'var(--m-nav-space)',
        'border-radius': '0',
        'box-shadow': 'none',
      },
      { media: null },
    );
    // 页面内容始终预留「导航高度 + 安全区 + 16px」，主操作不会被导航压住。
    expectRule(
      mobileRoot,
      scoped('.mobile-main'),
      { padding: '0 0 calc(var(--m-nav-space) + var(--m-4))' },
      { media: null },
    );

    // ≥1040 才切侧栏：240px 导航列 + 主区网格。
    expectRule(
      mobileRoot,
      scoped('.app-frame'),
      {
        display: 'grid',
        'grid-template-columns': '240px minmax(0, 1fr)',
        'grid-template-areas': "'nav main'",
      },
      { media: sidebarMedia },
    );
    expectRule(
      mobileRoot,
      scoped('.app-navigation'),
      { position: 'sticky', 'grid-area': 'nav', 'grid-template-columns': '1fr', bottom: 'auto' },
      { media: sidebarMedia },
    );
    expectRule(
      mobileRoot,
      scoped('.app-navigation button'),
      { 'flex-direction': 'row' },
      { media: sidebarMedia },
    );

    // 侧栏只能由 ≥1040 的断点建立：更窄的断点不得改写 .app-frame 布局或让导航变 sticky。
    const sidebarLayouts: string[] = [];
    const stickyNav: string[] = [];
    mobileRoot.walkRules((rule) => {
      const values = declarations(rule);
      const media = ancestorParams(rule, 'media');
      if (rule.selectors.includes(scoped('.app-frame')) && values.display === 'grid') {
        sidebarLayouts.push(media.length > 0 ? media.join(' and ') : '(no media)');
      }
      if (rule.selectors.includes(scoped('.app-navigation')) && values.position === 'sticky') {
        stickyNav.push(media.length > 0 ? media.join(' and ') : '(no media)');
      }
    });
    expect(sidebarLayouts).toEqual([sidebarMedia]);
    expect(stickyNav).toEqual([sidebarMedia]);

    const modeAt = (width: number) => (width >= 1040 ? 'sidebar' : 'bottom-tabs');
    expect([modeAt(360), modeAt(412), modeAt(640), modeAt(760), modeAt(915), modeAt(1040)]).toEqual(
      ['bottom-tabs', 'bottom-tabs', 'bottom-tabs', 'bottom-tabs', 'bottom-tabs', 'sidebar'],
    );
  });

  it('keeps primary navigation, focus and settings targets at least 44 CSS pixels', () => {
    // 新设计语言把命中尺寸收进 CORE token：48px 命中 / 56px 控件 / 72px 行 / 44px 分段。
    expect(mobileCss).toMatch(/--m-hit:\s*48px;/);
    expect(mobileCss).toMatch(/--m-control:\s*56px;/);
    expect(mobileCss).toMatch(/--m-row:\s*72px;/);
    expect(mobileCss).toMatch(/--m-seg:\s*44px;/);
    expect(mobileCss).toMatch(/--m-search:\s*48px;/);

    expectRule(mobileRoot, scoped('.mobile-topbar .icon-button'), {
      width: 'var(--m-hit)',
      height: 'var(--m-hit)',
      'min-width': 'var(--m-hit)',
      'min-height': 'var(--m-hit)',
    });
    expectRule(mobileRoot, scoped('.m-text-action'), { 'min-height': 'var(--m-hit)' });
    expectRule(mobileRoot, scoped('.m-row'), { 'min-height': 'var(--m-row)' });
    expectRule(mobileRoot, scoped('.m-segmented'), { height: 'var(--m-seg)' });
    expectRule(mobileRoot, scoped('.m-button-primary'), { 'min-height': 'var(--m-control)' });
    expectRule(mobileRoot, scoped('.m-button-secondary'), { 'min-height': 'var(--m-control)' });
    expectRule(mobileRoot, scoped('.focus-console .focus-actions > .focus-action'), {
      'min-height': 'var(--m-control)',
    });
    expectRule(mobileRoot, scoped('.focus-console .focus-task-row'), {
      'min-height': 'var(--m-row)',
    });
    expectRule(mobileRoot, scoped('.focus-console .focus-title-details > summary'), {
      'min-height': 'var(--m-hit)',
    });
    expectRule(mobileRoot, scoped('.focus-console .focus-sync-panel > summary'), {
      'min-height': 'var(--m-hit)',
    });
    expectRule(mobileRoot, scoped('.focus-console .focus-system-tool-actions > button'), {
      'min-height': 'var(--m-hit)',
    });
    expectRule(mobileRoot, scoped('.focus-console .focus-task-clear'), {
      'min-height': 'var(--m-hit)',
    });
    expectRule(mobileRoot, scoped("input[type='search']"), { 'min-height': 'var(--m-search)' });
    // 底部导航按钮占满 72px 导航条高度（72 − 8 的上下留白 = 64px 可点）。
    expectRule(mobileRoot, scoped('.app-navigation button'), {
      height: 'calc(var(--m-nav) - var(--m-2))',
    });

    // 旧层仍在兜底的历史目标（新层未重新声明，运行时依旧生效）。
    expectRule(appleRoot, '.focus-action', { 'min-width': '44px', 'min-height': '48px' });
    expectRule(appleRoot, '.sheet-close', { 'min-width': '44px', 'min-height': '44px' });
    expectRule(appleRoot, '.dashboard-range button', { 'min-height': '44px' });
    expectRule(appleRoot, '.focus-task-clear', { 'min-height': '44px' });
    expectRule(appleRoot, '.task-project-toggle', { 'min-height': '52px' });
    expectRule(appleRoot, '.task-row-main', { 'min-height': '60px' });
    expectRule(appleRoot, '.sync-button', { 'min-width': '44px', 'min-height': '44px' });
    expectRule(mobile13Root, '.appearance-segmented-option', { 'min-height': '46px' });
    expectRule(mobile13Root, '.appearance-font-choice', { 'min-height': '92px' });
    expectRule(mobile13Root, '.native-permission-action', { 'min-height': '46px' });
    expectRule(mobile13Root, '.focus-instrument > .temporal-ribbon .ribbon-view-switch button', {
      'min-height': '44px',
    });
    expectRule(mobile13Root, '.task-add-destination select', { 'min-height': '44px' });
    expectRule(focuslink2MobileRoot, '.mobile-sync-pill', {
      'min-width': '44px',
      'min-height': '44px',
    });
    expectRule(focuslink2MobileRoot, '.mobile-topbar .icon-button', {
      width: '44px',
      'min-width': '44px',
    });
    expectRule(
      focuslink2MobileRoot,
      '.mobile-sync-pill',
      { width: '44px', 'min-width': '44px' },
      { media: '(max-width: 380px)' },
    );
  });

  it('uses the full tablet width for all eight live font previews', () => {
    expectRule(
      mobile13Root,
      "html[data-device-tier='tablet'] body .appearance-font-controls",
      { display: 'block', 'margin-top': '14px' },
      { media: '(min-width: 620px)' },
    );
    expectRule(
      mobile13Root,
      '.appearance-font-choices',
      { 'grid-template-columns': 'repeat(4, minmax(0, 1fr))' },
      { media: '(min-width: 620px)' },
    );
  });

  it('keeps editable text at 16px and the flattened timer stage on the canvas surface', () => {
    // 新设计语言：所有可编辑文本统一 16px（聚焦不放大），主读数以 52–80px clamp 直接画在画布上。
    expect(mobileCss).toMatch(/--m-body-size:\s*16px;/);
    expectRule(mobileRoot, scoped('input'), { 'font-size': 'var(--m-body-size)' }, { media: null });
    expectRule(
      mobileRoot,
      scoped('textarea'),
      { 'font-size': 'var(--m-body-size)' },
      { media: null },
    );
    expectRule(
      mobileRoot,
      scoped('select'),
      { 'font-size': 'var(--m-body-size)' },
      { media: null },
    );
    expectRule(mobileRoot, scoped("input[type='text']"), {
      'min-height': 'var(--m-search)',
      'font-size': 'var(--m-body-size)',
    });
    expectRule(mobileRoot, scoped('textarea'), { 'min-height': 'var(--m-search)' });

    // 计时阶段不再是一张卡：读数、chronograph、instrument 都无边框/无底色/无投影。
    expectRule(mobileRoot, scoped('.focus-console .focus-readout'), {
      border: '0',
      background: 'transparent',
      padding: '0',
    });
    expectRule(mobileRoot, scoped('.focus-console .mobile-chronograph'), {
      margin: '0',
      padding: '0',
    });
    expectRule(mobileRoot, scoped('.focus-console .focus-instrument'), {
      border: '0',
      background: 'transparent',
      'box-shadow': 'none',
    });
    expectRule(mobileRoot, scoped('.focus-console .mobile-chronograph-readout'), {
      'font-size': 'clamp(52px, 19vw, 80px)',
      'font-weight': '600',
    });
    expectRule(
      mobileRoot,
      scoped(".focus-console .mobile-chronograph[data-long='true'] .mobile-chronograph-readout"),
      { 'font-size': 'clamp(52px, 15vw, 72px)' },
    );

    // 旧层仍在兜底的输入字号（新层已用全局规则覆盖，这里保留历史下限）。
    expectRule(appleRoot, '.task-search input', { 'min-height': '44px', 'font-size': '16px' });
    expectRule(appleRoot, '.form-field input', { 'font-size': '16px' });
  });

  it('keeps content opaque and bans glass and blur on the new design layer', () => {
    // 规范：内容面不用 blur / 发光 / 装饰渐变；新层唯一半透明面是 sheet 背后的 scrim。
    // 例外只留一种：用 --m-border 画的 1px 网格线（每日柱状背景），它不是装饰渐变。
    const gated: string[] = [];
    mobileRoot.walkDecls((decl) => {
      if (decl.prop === 'backdrop-filter' || decl.prop === '-webkit-backdrop-filter') {
        if (decl.value.trim() !== 'none') gated.push(`${decl.prop}: ${decl.value}`);
        return;
      }
      if (decl.prop === 'filter' && /blur\(/.test(decl.value)) gated.push(`filter: ${decl.value}`);
      if (decl.prop === 'background-image' && decl.value.trim() !== 'none') {
        const hairlineGrid = /var\(--m-border\)/.test(decl.value) && /1px/.test(decl.value);
        if (!hairlineGrid || /(?:radial|conic)-gradient/.test(decl.value)) {
          gated.push(`background-image: ${decl.value}`);
        }
      }
    });
    expect(gated, '新设计层不得出现玻璃/模糊/装饰渐变').toEqual([]);

    expectRule(
      mobileRoot,
      scoped('.m-card'),
      { background: 'var(--m-surface)', 'box-shadow': 'none' },
      { media: null },
    );
    expectRule(
      mobileRoot,
      scoped('.m-sheet'),
      { background: 'var(--m-surface)', 'box-shadow': 'none' },
      { media: null },
    );
    expectRule(
      mobileRoot,
      scoped('.app-navigation'),
      { background: 'var(--m-surface)', 'box-shadow': 'none' },
      { media: null },
    );
    // 半透明只允许出现在 scrim，且它不是毛玻璃。
    expectRule(
      mobileRoot,
      scoped('.m-sheet-scrim'),
      { background: 'rgb(var(--app-scrim) / 0.32)' },
      { media: null },
    );
    // 专注操作条不得回退成玻璃悬浮条。
    expectRule(mobileRoot, scoped('.focus-console .focus-instrument > .focus-actions'), {
      '-webkit-backdrop-filter': 'none',
      'backdrop-filter': 'none',
    });

    const confirmCss = readProjectFile('src', 'mobile', 'mobile-confirm.css');
    expect(confirmCss).not.toMatch(/backdrop-filter:\s*blur/);
  });

  it('removes continuous and interaction motion when reduced motion is requested', () => {
    const reducedMotion = '(prefers-reduced-motion: reduce)';

    expectRule(
      mobileRoot,
      `${mobileScope} *`,
      {
        'animation-duration': '1ms !important',
        'animation-delay': '0ms !important',
        'transition-duration': '1ms !important',
      },
      { media: reducedMotion },
    );

    // 新层的全部 @keyframes 只允许 opacity / transform，降动效时才能瞬时结束。
    const animatedProps = new Set<string>();
    mobileRoot.walkAtRules('keyframes', (keyframes) => {
      keyframes.walkDecls((decl) => {
        animatedProps.add(decl.prop);
      });
    });
    expect([...animatedProps].sort()).toEqual(['opacity', 'transform']);

    // 旧层交互元素仍保留 transition/transform 归零兜底。
    expectRule(
      appleRoot,
      '.app-navigation button',
      { transition: 'none !important', transform: 'none !important' },
      { media: reducedMotion },
    );
    expectRule(
      appleRoot,
      '.focus-action',
      { transition: 'none !important', transform: 'none !important' },
      { media: reducedMotion },
    );
  });

  it('keeps navigation, focus console and modal controls named for assistive technology', () => {
    const navigation = readProjectFile('src', 'mobile', 'AppNavigation.tsx');
    const consoleSource = readProjectFile('src', 'mobile', 'FocusConsole.tsx');
    const appSource = readProjectFile('src', 'mobile', 'MobileApp.tsx');
    const connectionSheet = readProjectFile('src', 'mobile', 'ConnectionSheet.tsx');

    expect(navigation).toContain('<nav className="app-navigation" aria-label="主要功能">');
    expect(navigation).toContain("aria-current={activeView === item.id ? 'page' : undefined}");
    expect(navigation).toContain('<Icon aria-hidden="true" />');
    expect(appSource).toContain('<main className="mobile-main">');
    expect(consoleSource).toContain('aria-labelledby="focus-console-title"');
    expect(consoleSource).toContain('aria-label="本轮三时间"');
    expect(consoleSource).toContain('aria-label="多端状态"');
    expect(connectionSheet).toContain('role="dialog"');
    expect(connectionSheet).toContain('aria-modal="true"');
    expect(connectionSheet).toContain('aria-labelledby="connection-title"');
    expect(connectionSheet).toContain("'关闭设备同步，返回本机模式'");
    expect(connectionSheet).toContain('aria-label={authenticated');
  });
});
