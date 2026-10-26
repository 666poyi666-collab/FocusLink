import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewportScreenshotSource = fs.readFileSync(
  path.join(projectRoot, 'scripts', 'regression', 'mobile-viewport-screenshot.ts'),
  'utf8',
);
const mobile13Source = fs.readFileSync(
  path.join(projectRoot, 'src', 'mobile', 'mobile-1-3.css'),
  'utf8',
);

function compactCss(file: string): string {
  return fs
    .readFileSync(path.join(projectRoot, 'src', 'mobile', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
}

// 1.6.9 迁移：旧样式总表变成 mobile-parity-base.css（加载序第 1），新设计语言层 mobile.css
// 最后加载并以 html[data-runtime='mobile-focus'] 提权。新层已接管的保证断言新层，
// 还没迁到新层的页面（TASKS / SETTINGS）继续由旧层兜底，断言旧层。
const mobileLayer = postcss.parse(compactCss('mobile.css'));

describe('phone, tablet and watch responsive style contract', () => {
  it('keeps the complete eight-digit watch clock and both actions inside the viewport', () => {
    const css = compactCss('watch.css');

    expect(css).toMatch(/\.watch-main\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.watch-clock-cell\s*\{[^}]*overflow:\s*hidden[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.watch-clock\s*\{[^}]*font-size:\s*min\(68px,\s*17\.5vw,\s*22vh\)/);
    expect(css).toMatch(
      /\.watch-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(/\.watch-actions > :only-child\s*\{[^}]*grid-column:\s*1 \/ -1/);
    expect(css).toMatch(/\.watch-actions button\s*\{[^}]*min-width:\s*0/);
  });

  it('keeps phone sync status, task title and assistive facts inside their rows', () => {
    const css = compactCss('mobile.css');

    // 手机顶栏同步状态是单行 pill：超长一律省略号，绝不把顶栏撑成两行。
    expect(css).toMatch(
      /\.mobile-sync-pill\s*\{[^}]*max-width:\s*40vw[^}]*white-space:\s*nowrap[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/,
    );
    // 专注页唯一一行任务标题同样单行省略，长标题不撑破行。
    expect(css).toMatch(
      /\.focus-task-entry-title\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/,
    );
    // 1.7.0：同步/新鲜度等事实细节不再占视觉，收成 1px 裁切的读屏摘要，不参与布局也就撑不破任何行。
    expect(css).toMatch(/\.live-context[^{}]*\{[^}]*clip-path:\s*inset\(50%\)/);
    expect(css).not.toMatch(/\.live-context[^{}]*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it('uses a real single-column 640 layout and keeps cloud pairing reachable from the focus page', () => {
    const css = compactCss('mobile.css');
    const consoleSource = fs.readFileSync(
      path.join(projectRoot, 'src', 'mobile', 'FocusConsole.tsx'),
      'utf8',
    );

    // <1040（含 640×1024）：单列；专注台没有并排侧栏，工作区最宽 1024 居中。
    expect(css).toMatch(/\.app-frame\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/\.focus-console-body\s*\{[^}]*display:\s*block/);
    expect(css).toMatch(/\.mobile-workspace\s*\{[^}]*max-width:\s*1024px/);
    // ≥1040 才出现 240px 侧栏 + 主区的网格。
    expect(css).toMatch(
      /@media \(min-width: 1040px\)[\s\S]*?\.app-frame\s*\{[^}]*grid-template-columns:\s*240px minmax\(0, 1fr\)/,
    );
    // 1.7.0 平板档：≥720 只把专注台收窄到 560 居中，不再有 760 双列。
    expect(css).toMatch(
      /@media \(min-width: 720px\)[\s\S]*?\.focus-instrument\s*\{[^}]*max-width:\s*560px/,
    );
    expect(css).toMatch(/\.focus-instrument > \.focus-actions\s*\{[^}]*position:\s*static/);
    expect(css).not.toMatch(
      /\.focus-instrument > \.focus-actions\s*\{[^}]*margin-(?:right|left):\s*calc\(-1/,
    );
    // 云端配对入口仍在专注页：读屏摘要里有「多端同步设置」按钮，视觉入口是顶栏同步 pill。
    expect(consoleSource).toContain('className="live-context sr-only"');
    expect(consoleSource).toContain('className="focus-sync-open"');
    expect(consoleSource).toContain('多端同步设置');
    expect(consoleSource).not.toContain('inline-connection-action');
    expect(viewportScreenshotSource).toContain(
      "document.querySelector('.focus-instrument > .temporal-ribbon')",
    );
    expect(viewportScreenshotSource).not.toContain(
      "document.querySelector('.mobile-temporal-ribbon')",
    );
    expect(mobile13Source).toContain('.focus-instrument > .temporal-ribbon');
    expect(mobile13Source).toContain('order: 3');
    expect(mobile13Source).toContain('grid-area: ribbon');
  });

  it('keeps editable text at 16px and wraps long sync detail copy', () => {
    const css = compactCss('mobile.css');

    // 全量输入 16px：iOS 聚焦不放大，也不再逐页改字号。
    expect(css).toMatch(/--m-body-size:\s*16px/);
    expect(css).toMatch(
      /html\[data-runtime='mobile-focus'\] select\s*\{\s*font-size:\s*var\(--m-body-size\)/,
    );
    // 搜索/文本输入 48px 高、圆角 12、16px 字号。
    expect(css).toMatch(
      /html\[data-runtime='mobile-focus'\] select\s*\{\s*box-sizing:\s*border-box;\s*width:\s*100%;\s*min-height:\s*var\(--m-search\)/,
    );
    expect(css).toMatch(/border-radius:\s*var\(--m-r-md\);\s*background:\s*var\(--m-surface\)/);
  });

  it('flattens the timer stage and task nesting to continuous hairline rows', () => {
    const css = compactCss('mobile.css');
    const legacy = compactCss('mobile-parity-base.css');

    // 计时阶段：读数、chronograph 与 instrument 直接坐在画布上，没有卡片外壳/投影。
    expect(css).toMatch(/\.focus-readout\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/);
    expect(css).toMatch(/\.mobile-chronograph\s*\{[^}]*margin:\s*0;\s*padding:\s*0/);
    expect(css).toMatch(
      /\.focus-instrument\s*\{[^}]*border:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/,
    );
    // 连续行：72px 行高 + 一条发丝底线，不是一张张小卡。
    expect(css).toMatch(
      /\.m-row\s*\{[^}]*min-height:\s*var\(--m-row\)[^}]*border-bottom:\s*1px solid var\(--m-border\)/,
    );

    // TASKS 段尚未迁到新层：旧层继续保证任务分组与子任务不套卡。
    expect(legacy).toMatch(
      /\.task-project-group\s*\{[^}]*border-radius:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/,
    );
    expect(legacy).toMatch(
      /\.task-children\s*\{[^}]*margin:\s*0 !important[^}]*border-radius:\s*0/,
    );
  });

  it('keeps the phone CTA above the nav by reserving nav space, not by sticky overlays', () => {
    const css = compactCss('mobile.css');
    const legacy = compactCss('mobile-parity-base.css');

    // 新设计没有粘底操作条：主操作留在文档流，靠预留导航真实高度保证不被压住。
    expect(css).toMatch(
      /\.focus-instrument > \.focus-actions\s*\{[^}]*position:\s*static[^}]*inset:\s*auto/,
    );
    expect(css).toMatch(
      /\.mobile-main\s*\{[^}]*padding:\s*0 0 calc\(var\(--m-nav-space\) \+ var\(--m-4\)\)/,
    );
    expect(css).toMatch(
      /\.has-live-activity \.mobile-main\s*\{[^}]*padding-bottom:\s*calc\(var\(--m-nav-space\) \+ var\(--m-activity-bar\) \+ var\(--m-4\)\)/,
    );

    // 新层任何规则都不得把内容粘到视口底边（bottom: 0），否则会藏在底部导航后面。
    const stickyBottom: string[] = [];
    mobileLayer.walkRules((rule) => {
      const values: Record<string, string> = {};
      for (const node of rule.nodes ?? []) {
        if (node.type === 'decl') values[node.prop] = node.value.trim();
      }
      if (values.position === 'sticky' && /^0(?:px)?$/.test(values.bottom ?? '')) {
        stickyBottom.push(rule.selector);
      }
    });
    expect(stickyBottom, '新层不得出现 sticky + bottom: 0 的覆盖层').toEqual([]);

    // 任务选择详情仍由旧层在 ≥760 收掉 min-height（TASKS 段未迁移）。
    expect(legacy).toMatch(
      /@media \(min-width: 760px\), \(orientation: landscape\)[\s\S]*?\.task-selection-detail\s*\{[^}]*min-height:\s*0/,
    );
  });

  it('keeps tablet settings status, font preview and timer instruments readable', () => {
    const mobile = compactCss('focuslink-2-mobile.css');
    const instruments = compactCss('mobile-instruments.css');

    expect(mobile).toMatch(
      /@media \(min-width:\s*620px\)[\s\S]*?\.settings-view > \.settings-status-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(mobile).toMatch(
      /\.appearance-font-controls\s*\{[^}]*grid-template-columns:\s*minmax\(180px,\s*0\.42fr\) minmax\(0,\s*0\.58fr\)/,
    );
    expect(mobile).toMatch(
      /\.appearance-font-preview\s*\{[^}]*min-height:\s*88px[^}]*margin-top:\s*0/,
    );
    expect(mobile).toMatch(
      /\.appearance-timer-choice\s*\{[^}]*min-height:\s*112px[^}]*padding:\s*11px 10px 9px/,
    );
    expect(instruments).toMatch(
      /@media \(min-width:\s*620px\)[\s\S]*?\.appearance-timer-preview\s*\{[^}]*min-height:\s*68px/,
    );
    expect(instruments).toMatch(
      /\.appearance-timer-preview \.timer-dial\s*\{[^}]*transform:\s*scale\(0\.64\)/,
    );
    expect(instruments).toMatch(
      /\.appearance-timer-preview \.dial-standard,[\s\S]*?\.appearance-timer-preview \.dial-draft\s*\{[^}]*transform:\s*scale\(0\.58\)/,
    );
    expect(instruments).toMatch(
      /\.appearance-timer-preview \.dial-standard\s*\{[^}]*transform-origin:\s*center/,
    );
    expect(instruments).toMatch(
      /\.appearance-timer-preview\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/,
    );
    expect(instruments).toMatch(
      /@media \(max-width:\s*380px\)[\s\S]*?\.appearance-timer-preview \.dial-standard\s*\{[^}]*transform:\s*scale\(0\.5\)/,
    );
  });

  it('keeps phone sync facts in a compact two-by-two matrix', () => {
    const mobile = compactCss('focuslink-2-mobile.css');
    expect(mobile).toMatch(
      /@media \(max-width:\s*619px\)[\s\S]*?\.settings-view > \.settings-status-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(mobile).toMatch(
      /\.settings-status-line\s*\{[^}]*min-height:\s*104px[^}]*grid-template-columns:\s*20px minmax\(0,\s*1fr\)/,
    );
  });

  it('checks every mobile font and all nine timer previews against their parent bounds', () => {
    expect(viewportScreenshotSource).toContain('assertMobileAppearancePreviews');
    expect(viewportScreenshotSource).toContain('Object.keys(FONT_PROFILE_EXPECTATIONS)');
    expect(viewportScreenshotSource).toContain('.appearance-font-choice[data-font-profile=');
    expect(viewportScreenshotSource).toContain('fontResult.width >= 100');
    expect(viewportScreenshotSource).toContain('.appearance-timer-preview');
    expect(viewportScreenshotSource).toContain('timerResult.count === 9');
    expect(viewportScreenshotSource).toContain('inner.right > outer.right + tolerance');
    expect(viewportScreenshotSource).toContain('inner.bottom > outer.bottom + tolerance');
  });
});
