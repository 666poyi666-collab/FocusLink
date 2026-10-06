import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* ────────────────────────────────────────────────────────────────────────────
   会话账本详情栏的滚动契约（FL-UI-LEDGER-SCROLL）

   为什么有这道测试（2026-10-06 用户报告 + 打包产物实测）：

     统计页右栏「会话时间账本」的详情框（`.card-widget.deep-dive-box`）在长会话下
     （实测 10 段专注 + 9 次暂停）内容高 1873px、可视高度只有 573px，却**滚不动、
     也没有滚动条**，用户只能把窗口拉大才能看到后面的片段：
     「在专注块这个界面，我看不到内容，它不能有个往下的滚动栏吗？」

     根因：`src/styles/stats-workbench.css` 的卡贴质感外观系统里有一条

       .card-widget { position: relative !important; overflow: hidden !important; }

     `!important` 的简写 overflow 压过了 `.stats-page .deep-dive-box { overflow-y: auto }`
     以及 ≥980px 媒体查询里的同款覆盖。`!important` 的胜出不靠选择器优先级，
     所以 `overflow-y: auto` 写得再具体也不生效 —— 打包产物实测 computed
     `overflow-y: hidden`、`scrollTop` 恒为 0、`scrollHeight 1873 > clientHeight 573`。

     修法：把裁切只留给真正需要它的卡片（伪元素光效铺满卡片，父级必须裁），
     放行自身就是滚动容器的账本详情框 —— `.card-widget:not(.deep-dive-box)`。
     统计页里这层光效本就被关掉（`.stats-page .card-widget::before/::after` 是 `display: none`），
     放行没有任何副作用。

   约束：详情框必须保留 `overflow-y: auto`，且 `overflow: hidden !important` 不得再落到它头上。
   ──────────────────────────────────────────────────────────────────────────── */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8');

function blockOf(source: string, selector: string): string {
  const index = source.indexOf(selector);
  expect(index, `找不到 ${selector} 规则`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', index);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

describe('会话账本详情栏滚动契约（FL-UI-LEDGER-SCROLL）', () => {
  const css = read('src', 'styles', 'stats-workbench.css');

  it('详情框自身是滚动容器：两个断点下都必须是 overflow-y: auto', () => {
    expect(blockOf(css, '.stats-page .deep-dive-box {')).toContain('overflow-y: auto');
    const wideIndex = css.indexOf('@media (min-width: 980px)');
    expect(wideIndex, '找不到 ≥980px 断点').toBeGreaterThanOrEqual(0);
    expect(blockOf(css.slice(wideIndex), '.stats-page .deep-dive-box {')).toContain(
      'overflow-y: auto',
    );
  });

  it('卡贴光效的 overflow 裁切不得再压住账本详情框', () => {
    expect(css, '裁切规则必须排除 .deep-dive-box').toContain('.card-widget:not(.deep-dive-box)');
    expect(
      css,
      '裸 .card-widget { overflow: hidden !important } 会重新把详情框锁成不可滚',
    ).not.toMatch(/\.card-widget\s*\{[^}]*overflow:\s*hidden\s*!important/);
    expect(
      blockOf(css, '.card-widget:not(.deep-dive-box) {'),
      '其它卡片仍要被裁切：光效伪元素铺满卡片，父级不裁会溢出圆角',
    ).toContain('overflow: hidden !important');
  });

  it('详情框元素确实同时带 card-widget 与 deep-dive-box 两个类', () => {
    const ledger = read('src', 'features', 'history', 'SessionLedger.tsx');
    expect(ledger).toMatch(/className="card-widget deep-dive-box"/);
  });
});
