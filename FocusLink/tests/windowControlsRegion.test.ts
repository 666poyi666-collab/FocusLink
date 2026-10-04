import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* ────────────────────────────────────────────────────────────────────────────
   窗口控制区 DOM 顺序契约（FL-UI-WINDOW-CONTROLS-ORDER）

   为什么有这道测试（2026-10-04 用户报告「任务统计界面划线的三个按钮完全用不了，
   专注设置倒是可以用」）：

     任务页与统计页各有一份页面标题栏 `.app-titlebar`，带
     `-webkit-app-region: drag`。Electron 按 DOM 顺序收集可拖动区域，**后声明的
     覆盖先声明的**。窗口按钮原来渲染在 `.app-stage` 之前，于是标题栏那 42px 高的
     拖动区把右上角也吞掉了：真实鼠标在该区域既收不到 mousemove，点击也不会触发
     按钮 —— 三个按钮全部失效。专注页与设置页没有页面级标题栏，所以不受影响。

     2026-10-04 实测（真实鼠标输入，非 CDP 合成事件）：
       · 修复前：任务页 x=1150 处 y=10/21/30/41 完全没有鼠标事件，y=42 起正常；
         真实点击最小化/最大化按钮无任何效果。
       · 把 `.window-controls` 移到 `.app-stage` 之后：同样的点立即收到事件，
         真实点击最小化 → IsIconic=True，最大化 → IsZoomed=True。

     v1.5.4 曾声称修好过这条（把窗口按钮改成 42px 高）。那次只比对了 DOM 几何
     （titlebar/controls/button 高度差为 0）与 `elementFromPoint`，而统计冒烟用的是
     **自造 shell** 的合成 DOM，所以既看不到真实的拖动区，也测不出按钮收不到事件。
     几何对不对和按钮能不能点，是两件事。

     因此本文件锁住唯一的结构约束：窗口按钮必须渲染在页面内容之后。
   ──────────────────────────────────────────────────────────────────────────── */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8');

describe('窗口控制区 DOM 顺序（FL-UI-WINDOW-CONTROLS-ORDER）', () => {
  const app = read('src', 'app', 'App.tsx');

  it('WindowControls 渲染在 app-stage 之后', () => {
    const stageIndex = app.indexOf('className="app-stage"');
    const controlsIndex = app.indexOf('<WindowControls');
    expect(stageIndex, 'App.tsx 里找不到 .app-stage 主内容区').toBeGreaterThan(-1);
    expect(controlsIndex, 'App.tsx 里找不到 <WindowControls />').toBeGreaterThan(-1);
    expect(
      controlsIndex,
      '窗口按钮必须排在 .app-stage 之后：页面标题栏的 -webkit-app-region: drag 会覆盖' +
        '先声明的 no-drag 区域，排在前面时任务页/统计页右上角整块变成窗口拖动区，' +
        '三个按钮的真实鼠标点击会完全失效（2026-10-04 实测）。',
    ).toBeGreaterThan(stageIndex);
  });

  it('主内容区之前没有第二份窗口按钮', () => {
    const stageIndex = app.indexOf('className="app-stage"');
    expect(
      app.slice(0, stageIndex).includes('<WindowControls'),
      '不允许把窗口按钮放回主内容区之前。',
    ).toBe(false);
    expect(app.split('<WindowControls').length - 1, '窗口按钮只能渲染一次').toBe(1);
  });

  it('页面标题栏仍声明拖动区（这是上述约束成立的前提）', () => {
    const taskCss = read('src', 'styles', 'task-workbench.css');
    const statsCss = read('src', 'styles', 'stats-workbench.css');
    expect(taskCss).toContain('-webkit-app-region: drag');
    expect(statsCss).toContain('-webkit-app-region: drag');
  });
});
