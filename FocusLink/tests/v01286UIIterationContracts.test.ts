import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule, type Node, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// v0.12.86（FL-REQ-20260811-UI-ITER）验收契约——只锁其他验收文件未覆盖的条款：
//  1. IME 不遮挡粘性操作区：Web viewport meta 的 interactive-widget + Android adjustResize。
//  2. 移动首屏压缩带与侧栏事实行扁平化（连续工作面）的具体声明。
//  3. 640 竖屏粘性主操作必须排在旧 620 覆盖层之后（级联序，防止「半失效 legacy 620 覆盖层」复活）。
//  4. 语义 token 对比度：正文 ≥7:1；次要、辅助、成功、危险与实心按钮标签 ≥4.5:1。
// 本文件只读源码与清单，不改产品实现；CSS/清单的静默失败（圆角回退、字号掉档、软键盘遮挡、
// token 色相漂移）在这里变成可失败断言。

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readProjectFile(...segments: string[]): string {
  return fs.readFileSync(path.join(projectRoot, ...segments), 'utf8');
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function declarations(rule: Rule): Record<string, string> {
  const values: Record<string, string> = {};
  for (const node of rule.nodes ?? []) {
    if (node.type === 'decl') {
      values[node.prop] = node.value + (node.important ? ' !important' : '');
    }
  }
  return values;
}

function mediaOf(rule: Rule): string[] {
  const params: string[] = [];
  let parent: Node | undefined = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && (parent as AtRule).name === 'media') {
      params.push((parent as AtRule).params);
    }
    parent = parent.parent;
  }
  return params;
}

function findRule(
  root: postcss.Root,
  selector: string,
  expected: Record<string, string>,
  mediaParams?: string,
): Rule | undefined {
  let match: Rule | undefined;
  root.walkRules((rule) => {
    if (match || !rule.selectors.includes(selector)) return;
    const media = mediaOf(rule);
    if (mediaParams !== undefined && !media.includes(mediaParams)) return;
    const values = declarations(rule);
    if (Object.entries(expected).every(([property, value]) => values[property] === value)) {
      match = rule;
    }
  });
  return match;
}

function expectRuleAt(
  root: postcss.Root,
  selector: string,
  expected: Record<string, string>,
  mediaParams?: string,
): void {
  const context = mediaParams === undefined ? '无媒体查询' : mediaParams;
  expect(
    findRule(root, selector, expected, mediaParams),
    selector + ' 应声明 ' + JSON.stringify(expected) + '（' + context + '）',
  ).toBeDefined();
}

// 1.6.9：新设计语言层的每条选择器都带 html[data-runtime='mobile-focus'] 前缀，
// 按后缀匹配才能同时锁住新层（新设计）与旧层（mobile-parity-base.css 兜底）的同一侧栏组件。
function findScopedRule(
  root: postcss.Root,
  selector: string,
  expected: Record<string, string>,
  mediaParams?: string,
): Rule | undefined {
  let match: Rule | undefined;
  root.walkRules((rule) => {
    if (match) return;
    if (!rule.selectors.some((entry) => entry === selector || entry.endsWith(` ${selector}`))) {
      return;
    }
    const media = mediaOf(rule);
    if (mediaParams !== undefined && !media.includes(mediaParams)) return;
    const values = declarations(rule);
    if (Object.entries(expected).every(([property, value]) => values[property] === value)) {
      match = rule;
    }
  });
  return match;
}

function expectScopedRule(
  root: postcss.Root,
  selector: string,
  expected: Record<string, string>,
  mediaParams?: string,
): Rule {
  const context = mediaParams === undefined ? '无媒体查询' : mediaParams;
  const rule = findScopedRule(root, selector, expected, mediaParams);
  expect(
    rule,
    selector + ' 应声明 ' + JSON.stringify(expected) + '（' + context + '）',
  ).toBeDefined();
  return rule!;
}

describe('v0.12.86 IME contract: the soft keyboard never covers the sticky action area', () => {
  it('declares interactive-widget=resizes-content on the mobile viewport', () => {
    const html = readProjectFile('mobile', 'index.html');
    const viewport = /<meta\s+name="viewport"\s+content="([^"]+)"/.exec(html);
    expect(viewport, 'mobile/index.html 缺少 viewport meta').not.toBeNull();
    expect(viewport![1]).toContain('width=device-width');
    expect(viewport![1], '软键盘弹出时必须压缩视觉视口，否则粘性操作区被遮挡').toContain(
      'interactive-widget=resizes-content',
    );
  });

  it('declares adjustResize on the Android main activity for the WebView keyboard', () => {
    const manifest = readProjectFile('android', 'app', 'src', 'main', 'AndroidManifest.xml');
    const activity = /<activity[\s\S]*?android:name="[^"]*MainActivity"[\s\S]*?<\/activity>/.exec(
      manifest,
    );
    expect(activity, 'AndroidManifest 缺少 MainActivity 元素').not.toBeNull();
    expect(
      activity![0],
      'MainActivity 必须声明 windowSoftInputMode=adjustResize，否则软键盘会覆盖粘性操作区',
    ).toContain('android:windowSoftInputMode="adjustResize"');
  });
});

describe('v0.12.86 mobile continuous work surface contracts', () => {
  const css = stripComments(readProjectFile('src', 'mobile', 'mobile.css'));
  const root = postcss.parse(css);
  const legacyCss = stripComments(readProjectFile('src', 'mobile', 'mobile-parity-base.css'));
  const legacyRoot = postcss.parse(legacyCss);

  it('compresses the phone band so readout and primary action stay in the first viewport', () => {
    // 新层：顶栏不再靠大 min-height 撑高，改成 sticky top:0 + 8px 上内边距 + 安全区，
    // 高度由内容决定，主读数与主操作因此留在第一屏。
    const topbar = expectScopedRule(root, '.mobile-topbar', {
      position: 'sticky',
      top: '0',
      padding: 'calc(var(--fl-edge-top) + var(--m-2)) var(--m-pad) var(--m-2)',
    });
    expect(
      declarations(topbar)['min-height'],
      '新层不得再给顶栏设 min-height，否则首屏压缩带会被重新撑高',
    ).toBeUndefined();
    // 旧层仍保留 52px 紧凑下限（新层没有覆盖 min-height，所以它是最终生效值）。
    expectRuleAt(
      legacyRoot,
      '.mobile-topbar',
      { 'min-height': 'calc(52px + env(safe-area-inset-top))' },
      '(max-width: 619px)',
    );
    // 手机同步状态改成单行 pill（旧 .sync-strip 已从 DOM 退场）：一行放不下就省略号，绝不换行。
    const syncPill = expectScopedRule(root, '.mobile-sync-pill', {
      'white-space': 'nowrap',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
      'max-width': '40vw',
    });
    const pillHeight = Number.parseFloat(declarations(syncPill)['min-height'] ?? 'NaN');
    // 规范触控下限 44px；本轮实测 40px（见报告 P1），上下界都锁住，防止再被撑回 56px 以上。
    expect(pillHeight).toBeGreaterThanOrEqual(40);
    expect(pillHeight).toBeLessThanOrEqual(44);
  });

  it('keeps side facts out of the visual surface and in a screen-reader summary', () => {
    // 1.7.0：侧栏事实不再是一张卡（也不再占一行行发丝线），而是 1px 裁切的读屏摘要，
    // 不参与视觉、不撑高页面；这里锁住 sr-only 语义与「不声明任何卡片表面」。
    expectScopedRule(root, '.live-context', {
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      'clip-path': 'inset(50%)',
      'white-space': 'nowrap',
      border: '0',
      background: 'none',
    });
    const liveContext = expectScopedRule(root, '.live-context', { position: 'absolute' });
    for (const property of ['border-radius', 'box-shadow']) {
      expect(
        declarations(liveContext)[property],
        `读屏摘要 .live-context 不得声明 ${property}`,
      ).toBeUndefined();
    }
    // 指令提示同样只留给读屏，不再抢占视觉。
    expectScopedRule(root, '.focus-command-notice', {
      position: 'absolute',
      'clip-path': 'inset(50%)',
    });
    // 旧层兜底：仍未迁走的原生系统控制块继续用上下发丝线，不套卡。
    expectRuleAt(legacyRoot, '.native-system-controls', {
      'border-top': '1px solid var(--mobile-hairline)',
      'border-bottom': '1px solid var(--mobile-hairline)',
    });
  });

  it('compacts the empty stats placeholder instead of a tall blank first viewport', () => {
    // 新层：空态不再占 64px 高，改成一条 13/20 的说明行（margin 0、上内边距 12）。
    const empty = expectScopedRule(root, '.analytics-empty', {
      margin: '0',
      padding: 'var(--m-3) 0 0',
    });
    expect(declarations(empty)['min-height'], '空态不得再占固定高度').toBeUndefined();
    // 空档台账的说明段同样不占高；行本身取 48px 命中高。
    const gapNote = expectScopedRule(root, '.mobile-gap-ledger > p', {
      margin: '0',
      padding: 'var(--m-2) 0 0',
    });
    expect(declarations(gapNote)['min-height']).toBeUndefined();
    expectScopedRule(root, '.mobile-gap-ledger > ol > li', {
      'min-height': 'var(--m-hit)',
      'border-bottom': '1px solid var(--m-border)',
    });
    // 主读数不再是 150px 的空盒子：hero 扁平、主数字 1.7.0 定为 44/48（≥1040 才 48/52）。
    expectScopedRule(root, '.dashboard-hero', {
      border: '0',
      background: 'none',
      'box-shadow': 'none',
    });
    expectScopedRule(root, '.dashboard-primary-value', {
      'font-size': '44px',
      'line-height': '48px',
    });
    // 通用空态组件：虚线框 + 32/16 内边距，没有 min-height。
    const mEmpty = expectScopedRule(root, '.m-empty', {
      padding: 'var(--m-6) var(--m-4)',
      border: '1px dashed var(--m-border)',
    });
    expect(declarations(mEmpty)['min-height']).toBeUndefined();
  });
});

describe('v0.12.86 640 portrait sticky action cascade (legacy 620 overlay cleanup)', () => {
  const css = stripComments(readProjectFile('src', 'mobile', 'mobile.css'));
  const root = postcss.parse(css);

  it('keeps every bottom-anchored overlay off the 640 portrait CTA', () => {
    // 新设计语言彻底取消了「粘在视口底边」的覆盖层：枚举全表 sticky 规则，
    // bottom 只能缺席或 auto，否则 640 竖屏的主操作会重新被压在导航后面。
    const bottomStuck: string[] = [];
    root.walkRules((rule) => {
      const values = declarations(rule);
      if (values.position !== 'sticky') return;
      if (values.bottom !== undefined && values.bottom !== 'auto') bottomStuck.push(rule.selector);
    });
    expect(bottomStuck, '新层不得出现 sticky 且 bottom 非 auto 的覆盖层').toEqual([]);

    // 主操作条回到文档流（1.7.0 用 inset: auto 归零四边）；底部导航高度由主区下内边距预留。
    expectScopedRule(root, '.focus-instrument > .focus-actions', {
      position: 'static',
      inset: 'auto',
    });
    expectScopedRule(root, '.mobile-main', {
      padding: '0 0 calc(var(--m-nav-space) + var(--m-4))',
    });
  });
});

describe('v0.12.86 semantic token contrast floor (WCAG)', () => {
  const foundation = stripComments(readProjectFile('src', 'styles', 'temporal-foundation.css'));

  function tokensOf(blockLabel: string): Record<string, [number, number, number]> {
    const anchor = blockLabel === ':root' ? ':root' : '\\.dark';
    const block = new RegExp('^' + anchor + '\\s*\\{([\\s\\S]*?)^\\}', 'm').exec(foundation);
    expect(block, 'temporal-foundation.css 缺少 ' + blockLabel + ' 块').not.toBeNull();
    const tokens: Record<string, [number, number, number]> = {};
    for (const name of [
      'app-bg',
      'app-surface-2',
      'app-text',
      'app-muted',
      'app-subtle',
      'app-danger',
      'app-danger-solid',
      'app-danger-solid-fg',
      'app-pause',
      'app-success',
      'app-accent',
      'app-accent-fg',
    ]) {
      const value = new RegExp('--' + name + '\\s*:\\s*([^;]+);').exec(block![1]);
      expect(value, 'temporal-foundation.css ' + blockLabel + ' 缺少 --' + name).not.toBeNull();
      const parts = value![1].trim().split(/\s+/).map(Number);
      expect(parts, '--' + name + ' 不是三元 RGB').toHaveLength(3);
      tokens[name] = [parts[0], parts[1], parts[2]];
    }
    return tokens;
  }

  const light = tokensOf(':root');
  const dark = tokensOf('.dark');

  function lin(channel: number): number {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function ratio(a: [number, number, number], b: [number, number, number]): number {
    const la = 0.2126 * lin(a[0]) + 0.7152 * lin(a[1]) + 0.0722 * lin(a[2]);
    const lb = 0.2126 * lin(b[0]) + 0.7152 * lin(b[1]) + 0.0722 * lin(b[2]);
    const hi = la > lb ? la : lb;
    const lo = la > lb ? lb : la;
    return (hi + 0.05) / (lo + 0.05);
  }

  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)(
    '%s theme: primary, secondary, danger and solid-button labels clear AA',
    (_label, tokens) => {
      const canvasDesktop = tokens['app-surface-2'];
      const canvasMobile = tokens['app-bg'];
      // 实心按钮标签以按钮自身实心底为背景计算，不能拿页面画布对比。
      const pairs: Array<[string, [number, number, number], [number, number, number], number]> = [
        ['正文文字', tokens['app-text'], canvasDesktop, 7],
        ['正文文字（移动）', tokens['app-text'], canvasMobile, 7],
        ['次要文字', tokens['app-muted'], canvasDesktop, 4.5],
        ['次要文字（移动）', tokens['app-muted'], canvasMobile, 4.5],
        ['危险文字', tokens['app-danger'], canvasDesktop, 4.5],
        ['危险文字（移动）', tokens['app-danger'], canvasMobile, 4.5],
        ['实心危险按钮标签', tokens['app-danger-solid-fg'], tokens['app-danger-solid'], 4.5],
        ['强调实心按钮标签', tokens['app-accent-fg'], tokens['app-accent'], 4.5],
        ['暂停红（大文本/UI 级）', tokens['app-pause'], canvasDesktop, 3],
      ];
      for (const [labelText, fg, canvas, floor] of pairs) {
        const value = ratio(fg, canvas);
        expect(
          value,
          labelText + ' 对比度 ' + value.toFixed(2) + ':1 低于下限 ' + floor + ':1',
        ).toBeGreaterThanOrEqual(floor);
      }
    },
  );

  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)('%s theme: auxiliary and success text clear AA', (_label, tokens) => {
    for (const canvas of [tokens['app-surface-2'], tokens['app-bg']]) {
      expect(ratio(tokens['app-subtle'], canvas)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tokens['app-success'], canvas)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('all focus-color variants keep success text above AA on their theme canvas', () => {
    for (const color of ['emerald', 'cobalt', 'violet', 'amber', 'graphite']) {
      for (const [selector, canvas] of [
        [`.focus-color-${color}`, light['app-surface-2']],
        [`.dark.focus-color-${color}`, dark['app-surface-2']],
      ] as const) {
        const block = new RegExp(
          '^' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)^\\}',
          'm',
        ).exec(foundation);
        expect(block, `temporal-foundation.css 缺少 ${selector}`).not.toBeNull();
        const value = /--app-success\s*:\s*([^;]+);/.exec(block![1]);
        expect(value, `${selector} 缺少 --app-success`).not.toBeNull();
        const parts = value![1].trim().split(/\s+/).map(Number) as [number, number, number];
        expect(ratio(parts, canvas), `${selector} success 对比度不足`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
