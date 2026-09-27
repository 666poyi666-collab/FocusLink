// 任务页「样式写了但不生效」契约测试（真实渲染计算值断言）。
//
// 背景：本轮迭代同一个 bug 类型连中三次，每次都是静默失效 —— 不报错、不崩、
// 页面照常渲染，只是视觉不对：
//   1. `.task-check-circle` / `.btn-action-focus` 被 `.task-workspace-root button`
//      (0-1-1) 通杀，勾选圆环和主 CTA 被清成透明空元素；
//   2. `.detail-heading` 被 `.task-workspace-root textarea` (0-1-1) 通杀，17px 掉回 13px；
//   3. `.spring-pop` / `.just-restored` 的 keyframes 写好了，TSX 里从未应用。
//
// 这条测试只认真实 `getComputedStyle`：源码里写着 `border: 1.6px solid var(--x)`
// 不代表生效 —— 它可能被更高特异性压掉、可能引用了未定义的自定义属性（整条声明
// 静默作废）、可能被 inline style 覆盖。所以这里走「隔离 Electron + 真实页面 +
// 计算值」，与 scripts/regression/desktop-ui-screenshot.ts 同一套模式，并复用其
// isolatedUserData 隔离用户正在运行的实例。
//
// 运行（FocusLink/ 下，需先 npm run build）：
//   npm run smoke:task-style
// 或：
//   npx electron scripts/regression/task-style-contract-entry.cjs --force-device-scale-factor=1
//
// 预期值来源：`src/styles/task-workbench.css` 的设计意图，并与
// `C:\Users\16408\Desktop\FocusLink-任务页-预览\任务页原型.html` 的计算值逐项核对
// （原型侧同样用 getComputedStyle 实测，不是读源码）。
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureIsolatedUserData } from './isolatedUserData';
import { initDatabase, closeDatabase } from '../../electron/db/index.js';
import { TimerManager } from '../../electron/timer/manager.js';
import { FocusTimerController } from '../../electron/timer/focusTimerController.js';
import { registerIpc } from '../../electron/ipc.js';
import { MAIN_WINDOW_DEFAULT_SIZE } from '@shared/mainWindowLayout';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

// 150% 缩放下 1px 会被算成 0.667px，必须钉死 dsf=1，否则造出一堆假边框差异。
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ── 从 CSS 里收集所有「没有 fallback 的 var(--token)」引用 ───────────────
// 未定义的自定义属性会让整条声明在计算期静默作废，是这一版真实踩过的坑
// （desktop-ui-screenshot.ts 注释里也专门警告过）。
const workbenchCss = fs.readFileSync(
  path.join(projectRoot, 'src', 'styles', 'task-workbench.css'),
  'utf8',
);
const tokenNames = [
  ...new Set(
    [...workbenchCss.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)].map((match) => match[1]),
  ),
].sort();

// 允许在默认（linear / light / 非选中）状态下解析为空白的 token。
// 这些要么由组件按行内样式下发，要么只在特定主题块里出现；不是缺陷。
const TOKEN_ALLOWLIST = new Set<string>([]);

const TOKENS_LITERAL = `const TOKENS = ${JSON.stringify(tokenNames)};`;

const MEASURE_JS = `(() => {
  ${TOKENS_LITERAL}
  const pick = (sel, props) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    const out = {};
    for (const p of props) out[p] = s.getPropertyValue(p);
    return out;
  };
  const pseudo = (sel, props) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el, '::after');
    const out = {};
    for (const p of props) out[p] = s.getPropertyValue(p);
    return out;
  };
  const root = document.querySelector('.task-workspace-root');
  const rootStyle = root ? getComputedStyle(root) : null;
  const tokens = {};
  for (const name of TOKENS) tokens[name] = rootStyle ? rootStyle.getPropertyValue(name).trim() : '';
  const h2 = document.querySelector('.list-title-group h2');
  return {
    rootPresent: !!root,
    entryCount: document.querySelectorAll('.task-entry').length,
    doneCount: document.querySelectorAll('.task-entry.is-done').length,
    tokens,
    uncheckedCircle: pick('.task-entry:not(.is-done) .task-check-circle', ['width','height','border-top-width','border-top-style','border-top-color','border-radius','background-color','color']),
    checkedCircle: pick('.task-entry.is-done .task-check-circle', ['width','height','border-top-width','border-top-style','border-top-color','border-radius','background-color','color']),
    checkedPath: pick('.task-entry.is-done .task-check-circle .check-path', ['stroke-dashoffset','stroke-dasharray']),
    uncheckedSubtask: pick('.subtask-check[aria-checked="false"]', ['width','height','border-top-width','border-top-style','border-top-color','border-radius','background-color']),
    checkedSubtask: pick('.subtask-check[aria-checked="true"]', ['width','height','border-top-width','border-top-style','border-top-color','border-radius','background-color']),
    btnFocus: pick('.btn-action-focus', ['background-color','color','font-size','font-weight','border-top-width','border-radius','height']),
    btnDone: pick('.btn-action-done', ['background-color','color','font-size','font-weight','border-top-width','border-top-style','border-top-color','border-radius','height']),
    btnDel: pick('.btn-action-del', ['background-color','border-top-width','border-top-style','border-top-color','border-radius']),
    strikeLaser: pick('.task-entry.is-done .strike-laser', ['height','background-color','transform','transition-property']),
    listH2: pick('.list-title-group h2', ['font-size','font-weight']),
    listH2InlineStyle: h2 ? h2.getAttribute('style') : 'MISSING',
    detailHeading: pick('.detail-heading', ['font-size','font-weight','line-height']),
    propsTable: pick('.linear-props-table', ['padding-top','padding-right','padding-bottom','padding-left','border-top-width','border-top-style','border-top-color','border-radius','background-color']),
    propRow: pick('.prop-table-row', ['height','padding-left','padding-right','border-radius']),
    propPill: pick('.prop-action-pill', ['background-color','color','font-size','font-weight','border-radius','border-top-width','border-top-style']),
    subtaskFastAdd: pick('.subtask-fast-add-row', ['min-height','padding-top','padding-left','padding-right','border-bottom-width','border-radius']),
    sideItem: pick('.side-item:not([aria-selected="true"])', ['color','font-size']),
    sideItemName: pick('.side-item:not([aria-selected="true"]) .nav-name', ['color','font-size','font-weight'])
  };
})()`;

const ANIMATION_JS = `(async () => {
  const waitFrames = (n) => new Promise((resolve) => {
    let i = 0;
    const step = () => { i += 1; if (i >= n) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  const seen = [];
  const onStart = (event) => seen.push(event.animationName + (event.pseudoElement ? event.pseudoElement : ''));
  document.addEventListener('animationstart', onStart, true);
  const collect = (el) => {
    if (!el) return null;
    const animations = (el.getAnimations ? el.getAnimations({ subtree: true }) : []).map(
      (animation) => animation.animationName || ''
    );
    const after = getComputedStyle(el, '::after');
    return {
      className: el.className,
      animations,
      pseudoAnimation: after.animationName,
      pseudoBorderWidth: after.borderTopWidth,
      pseudoOpacity: after.opacity
    };
  };
  const unchecked = document.querySelector('.task-entry:not(.is-done) .task-check-circle');
  if (!unchecked) {
    document.removeEventListener('animationstart', onStart, true);
    return { error: 'no unchecked task circle' };
  }
  const rowId = unchecked.closest('.task-entry').getAttribute('data-task-id');
  unchecked.click();
  let checkSeen = null;
  for (let i = 0; i < 90; i += 1) {
    await waitFrames(1);
    const el = document.querySelector('.task-entry[data-task-id="' + rowId + '"] .task-check-circle');
    if (el && el.classList.contains('spring-pop')) checkSeen = collect(el);
    if (seen.some((name) => name.indexOf('checkPopPulse') === 0) && checkSeen) break;
  }
  const done = document.querySelector('.task-entry.is-done .task-check-circle');
  let restoreSeen = null;
  if (done) {
    const doneRowId = done.closest('.task-entry').getAttribute('data-task-id');
    done.click();
    for (let i = 0; i < 90; i += 1) {
      await waitFrames(1);
      const row = document.querySelector('.task-entry[data-task-id="' + doneRowId + '"]');
      if (row && row.classList.contains('just-restored')) restoreSeen = collect(row);
      if (seen.some((name) => name.indexOf('restoreFlash') === 0) && restoreSeen) break;
    }
  }
  document.removeEventListener('animationstart', onStart, true);
  return { seen, checkSeen, restoreSeen };
})()`;

// ── 断言收集器 ──────────────────────────────────────────────────────────
type Failure = { label: string; detail: unknown };
const failures: Failure[] = [];

function ok(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`[style-contract] ok   ${label}`);
  } else {
    failures.push({ label, detail: detail ?? null });
    console.error(`[style-contract] FAIL ${label} :: ${JSON.stringify(detail ?? null)}`);
  }
}

function eq(label: string, actual: unknown, expected: unknown): void {
  ok(label, actual === expected, { actual, expected });
}

function gt(label: string, actual: number, floor: number): void {
  ok(label, Number.isFinite(actual) && actual > floor, { actual, floor });
}

function parseRgb(value: string): [number, number, number] {
  const match = /rgba?\(([^)]+)\)/.exec(value || '');
  if (!match) return [0, 0, 0];
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(color: string): number {
  const [r, g, b] = parseRgb(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const INK = 'rgb(24, 24, 27)';
const WHITE = 'rgb(255, 255, 255)';
const BORDER_SUBTLE = 'rgba(0, 0, 0, 0.06)';
const CHECK_ACCENT = 'rgb(37, 99, 235)';
const TEXT_SECONDARY = 'rgb(82, 82, 91)';
const STRIKE_COLOR = 'rgb(140, 140, 140)';
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

function main(): void {
  app
    .whenReady()
    .then(async () => {
      configureIsolatedUserData('task-style-contract', true);
      initDatabase();

      const timer = new FocusTimerController(new TimerManager());
      const win = new BrowserWindow({
        width: MAIN_WINDOW_DEFAULT_SIZE.width,
        height: MAIN_WINDOW_DEFAULT_SIZE.height,
        show: false,
        frame: false,
        backgroundColor: '#ffffff',
        webPreferences: {
          backgroundThrottling: false,
          preload: path.join(projectRoot, 'dist-electron', 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      registerIpc(timer, win, () => undefined);

      const indexHtml = path.join(projectRoot, 'dist', 'index.html');
      if (!fs.existsSync(indexHtml)) {
        throw new Error('dist/index.html 不存在：请先运行 npm run build 再跑本契约测试');
      }
      await win.loadFile(indexHtml);
      await sleep(1500);

      // 关掉外部任务源，避免 dida CLI 把任务页卡在骨架屏；默认主题 light。
      await win.webContents.executeJavaScript(
        `window.focuslink.settings.set({ taskSource: 'local', syncMode: 'local-only', theme: 'light' })`,
      );
      win.webContents.send('navigate', 'tasks');
      await waitForSelector(win, '.task-workspace-root');
      await sleep(600);

      const seeded = await win.webContents.executeJavaScript(`(async () => {
        const project = await window.focuslink.tasks.createProject('样式契约清单', '#2f6fed');
        const now = Date.now();
        const a = await window.focuslink.tasks.create('未完成任务A', project.id, { priority: 3, dueDate: now });
        const b = await window.focuslink.tasks.create('含子任务B', project.id, { dueDate: now });
        const sub1 = await window.focuslink.tasks.create('子任务未完成', project.id, { parentId: b.id });
        const sub2 = await window.focuslink.tasks.create('子任务已完成', project.id, { parentId: b.id });
        await window.focuslink.tasks.setCompleted(sub2, true);
        const c = await window.focuslink.tasks.create('已完成任务C', project.id, { dueDate: now });
        await window.focuslink.tasks.setCompleted(c, true);
        return { project: project.id, a: a.id, b: b.id, c: c.id };
      })()`);
      if (!seeded || !seeded.a || !seeded.b || !seeded.c) {
        throw new Error(
          '无法通过 window.focuslink.tasks 播种契约数据（tasks 没有 list()，用 refresh()）',
        );
      }

      // 点 UI 刷新，让列表真正渲染出播种数据。
      await win.webContents.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('.btn-tool')].find((node) => node.textContent.includes('刷新'));
        if (button) button.click();
        return !!button;
      })()`);
      await sleep(1500);
      // 选中含子任务的任务，展开详情面板（属性区 / 子任务 / 底部按钮都在这里）。
      await win.webContents.executeJavaScript(`(() => {
        const row = document.querySelector('.task-entry[data-task-id="${seeded.b}"]');
        if (row) row.click();
        return !!row;
      })()`);
      await waitForSelector(win, '.linear-props-table');
      await sleep(500);

      win.show();
      await sleep(400);

      const measured: any = await win.webContents.executeJavaScript(MEASURE_JS);
      runStaticContract(measured);
      runTokenContract(measured);

      const animation: any = await win.webContents.executeJavaScript(ANIMATION_JS);
      runAnimationContract(animation);

      timer.dispose();
      closeDatabase();

      if (failures.length > 0) {
        console.error(`\n[style-contract] ${failures.length} 项失败：`);
        for (const failure of failures) {
          console.error(`  - ${failure.label} :: ${JSON.stringify(failure.detail)}`);
        }
        app.exit(1);
        return;
      }
      console.log('\n[style-contract] 全部通过：真实渲染计算值符合设计意图与原型。');
      app.exit(0);
    })
    .catch((error) => {
      console.error('[style-contract] 运行失败', error);
      try {
        closeDatabase();
      } catch {
        // 数据库可能还没打开
      }
      app.exit(1);
    });
}

function runStaticContract(m: any): void {
  if (!m) {
    ok('页面测量结果可读', false, 'MEASURE_JS 返回 null');
    return;
  }
  ok('任务页根元素 .task-workspace-root 存在', m.rootPresent === true, m.rootPresent);
  ok('列表渲染出播种的任务行', m.entryCount >= 3, { entryCount: m.entryCount });
  ok('存在已完成任务行', m.doneCount >= 1, { doneCount: m.doneCount });

  // 1. 勾选圆圈（未勾选）：reset 通杀时 border/background 会被清零，圆圈消失。
  const unchecked = m.uncheckedCircle;
  ok('.task-check-circle 未勾选态存在', !!unchecked, unchecked);
  if (unchecked) {
    eq('.task-check-circle 宽 19px', unchecked['width'], '19px');
    eq('.task-check-circle 高 19px', unchecked['height'], '19px');
    eq('.task-check-circle 圆角 50%', unchecked['border-radius'], '50%');
    gt('.task-check-circle 有可见描边宽度', Number.parseFloat(unchecked['border-top-width']), 0);
    ok(
      '.task-check-circle 描边样式非 none',
      unchecked['border-top-style'] !== 'none',
      unchecked['border-top-style'],
    );
    eq(
      '.task-check-circle 未勾选描边色 --border-subtle',
      unchecked['border-top-color'],
      BORDER_SUBTLE,
    );
    eq('.task-check-circle 未勾选背景透明', unchecked['background-color'], TRANSPARENT);
  }

  // 2. 勾选圆圈（已勾选）：必须有实心底色，且对勾 stroke-dashoffset 归零。
  const checked = m.checkedCircle;
  ok('.task-check-circle 已勾选态存在', !!checked, checked);
  if (checked) {
    eq('.task-check-circle 已勾选实心底色 --check-bg', checked['background-color'], CHECK_ACCENT);
    eq('.task-check-circle 已勾选描边色 --check-border', checked['border-top-color'], CHECK_ACCENT);
    eq('.task-check-circle 已勾选对勾色 --check-fg', checked['color'], WHITE);
  }
  const checkedPath = m.checkedPath;
  ok('.check-path 已勾选存在', !!checkedPath, checkedPath);
  if (checkedPath)
    eq('.check-path 勾选后 stroke-dashoffset=0', checkedPath['stroke-dashoffset'], '0px');

  // 3. 子任务方框：与主圆圈同一 reset 根因。
  const uncheckedSub = m.uncheckedSubtask;
  ok('.subtask-check 未勾选态存在', !!uncheckedSub, uncheckedSub);
  if (uncheckedSub) {
    eq('.subtask-check 宽 15px', uncheckedSub['width'], '15px');
    eq('.subtask-check 高 15px', uncheckedSub['height'], '15px');
    eq('.subtask-check 圆角 4px', uncheckedSub['border-radius'], '4px');
    gt('.subtask-check 有可见描边宽度', Number.parseFloat(uncheckedSub['border-top-width']), 0);
    ok(
      '.subtask-check 描边样式非 none',
      uncheckedSub['border-top-style'] !== 'none',
      uncheckedSub['border-top-style'],
    );
    eq('.subtask-check 未勾选背景透明', uncheckedSub['background-color'], TRANSPARENT);
  }
  const checkedSub = m.checkedSubtask;
  ok('.subtask-check 已勾选态存在', !!checkedSub, checkedSub);
  if (checkedSub) {
    eq('.subtask-check 已勾选实心底色', checkedSub['background-color'], CHECK_ACCENT);
    eq('.subtask-check 已勾选描边色', checkedSub['border-top-color'], CHECK_ACCENT);
  }

  // 4. 主 CTA：reset 通杀时 background-color:initial 会让它变成透明底黑字。
  const focus = m.btnFocus;
  ok('.btn-action-focus 存在', !!focus, focus);
  if (focus) {
    eq('.btn-action-focus 有非透明深底', focus['background-color'], INK);
    eq('.btn-action-focus 文字为白色', focus['color'], WHITE);
    const ratio = contrastRatio(focus['color'], focus['background-color']);
    gt('.btn-action-focus 文字/底色对比度 >= 4.5', ratio, 4.5);
    eq('.btn-action-focus 字号 12.5px', focus['font-size'], '12.5px');
    eq('.btn-action-focus 字重 600', focus['font-weight'], '600');
    eq('.btn-action-focus 圆角 6px', focus['border-radius'], '6px');
  }

  // 5. 次按钮：1px 边框 + 非透明底色。
  const done = m.btnDone;
  ok('.btn-action-done 存在', !!done, done);
  if (done) {
    eq('.btn-action-done 有非透明底色', done['background-color'], WHITE);
    gt('.btn-action-done 边框宽度 >= 1px', Number.parseFloat(done['border-top-width']), 0.5);
    eq('.btn-action-done 边框样式 solid', done['border-top-style'], 'solid');
    eq('.btn-action-done 边框色 --border-subtle', done['border-top-color'], BORDER_SUBTLE);
    eq('.btn-action-done 圆角 6px', done['border-radius'], '6px');
  }
  const del = m.btnDel;
  ok('.btn-action-del 存在', !!del, del);
  if (del) {
    eq('.btn-action-del 有非透明底色', del['background-color'], WHITE);
    gt('.btn-action-del 边框宽度 >= 1px', Number.parseFloat(del['border-top-width']), 0.5);
    eq('.btn-action-del 边框色 --border-subtle', del['border-top-color'], BORDER_SUBTLE);
  }

  // 6. 完成态删除线：必须可见，且只能动 transform（不许回到 width 过渡）。
  const laser = m.strikeLaser;
  ok('.strike-laser 已完成态存在', !!laser, laser);
  if (laser) {
    eq('.strike-laser 高 1.5px', laser['height'], '1.5px');
    eq('.strike-laser 颜色 --text-tertiary', laser['background-color'], STRIKE_COLOR);
    const matrix = /matrix\(([^)]+)\)/.exec(laser['transform'] || '');
    const scaleX = matrix ? Number.parseFloat(matrix[1].split(',')[0]) : Number.NaN;
    ok(
      '.strike-laser 完成态 scaleX(1)（删除线可见）',
      Math.abs(scaleX - 1) < 0.001,
      laser['transform'],
    );
    eq(
      '.strike-laser 过渡属性为 transform（不是 width）',
      laser['transition-property'],
      'transform',
    );
  }

  // 7. 列表标题 h2：字号/字重不被 inline style 覆盖。
  const h2 = m.listH2;
  ok('列表标题 h2 存在', !!h2, h2);
  if (h2) {
    eq('列表 h2 字号 18px', h2['font-size'], '18px');
    eq('列表 h2 字重 700', h2['font-weight'], '700');
  }
  eq('列表 h2 没有 inline style 覆盖', m.listH2InlineStyle, null);

  // 8. 详情标题：textarea reset 通杀时会从 17px 掉回继承的 13px。
  const heading = m.detailHeading;
  ok('.detail-heading 存在', !!heading, heading);
  if (heading) {
    eq('.detail-heading 字号 17px', heading['font-size'], '17px');
    eq('.detail-heading 字重 700', heading['font-weight'], '700');
  }

  // 9. 属性区 / 属性行 / 属性胶囊：reset 通杀时底色边框会静默消失。
  const table = m.propsTable;
  ok('.linear-props-table 存在', !!table, table);
  if (table) {
    gt('.linear-props-table 边框宽度 >= 1px', Number.parseFloat(table['border-top-width']), 0.5);
    eq('.linear-props-table 边框色 --border-subtle', table['border-top-color'], BORDER_SUBTLE);
    eq('.linear-props-table 圆角 8px (--r-md)', table['border-radius'], '8px');
    eq('.linear-props-table 底色 --bg-card', table['background-color'], WHITE);
    eq('.linear-props-table 上内边距 0px（原型实测值）', table['padding-top'], '0px');
    eq('.linear-props-table 左内边距 0px（原型实测值）', table['padding-left'], '0px');
  }
  const row = m.propRow;
  ok('.prop-table-row 存在', !!row, row);
  if (row) {
    eq('.prop-table-row 高 32px', row['height'], '32px');
    eq('.prop-table-row 左内边距 10px（原型实测值）', row['padding-left'], '10px');
    eq('.prop-table-row 右内边距 10px（原型实测值）', row['padding-right'], '10px');
    eq('.prop-table-row 圆角 0px（原型实测值）', row['border-radius'], '0px');
  }
  const pill = m.propPill;
  ok('.prop-action-pill 存在', !!pill, pill);
  if (pill) {
    ok(
      '.prop-action-pill 有非透明底色',
      pill['background-color'] !== TRANSPARENT,
      pill['background-color'],
    );
    eq('.prop-action-pill 文字色 --text-primary', pill['color'], INK);
    eq('.prop-action-pill 字号 12px', pill['font-size'], '12px');
    eq('.prop-action-pill 圆角 4px (--r-xs)', pill['border-radius'], '4px');
    eq('.prop-action-pill 无边框（原型实测值）', pill['border-top-width'], '0px');
  }
  const fastAdd = m.subtaskFastAdd;
  ok('.subtask-fast-add-row 存在', !!fastAdd, fastAdd);
  if (fastAdd) {
    eq('.subtask-fast-add-row 最小高 28px', fastAdd['min-height'], '28px');
    eq('.subtask-fast-add-row 左内边距 6px', fastAdd['padding-left'], '6px');
    eq('.subtask-fast-add-row 上内边距 2px', fastAdd['padding-top'], '2px');
    eq('.subtask-fast-add-row 右内边距 6px', fastAdd['padding-right'], '6px');
    eq('.subtask-fast-add-row 无下边框（原型实测值）', fastAdd['border-bottom-width'], '0px');
    eq('.subtask-fast-add-row 圆角 0px（原型实测值）', fastAdd['border-radius'], '0px');
  }

  // 10. 侧栏未选中项文字色：不许退回 --text-primary。
  const side = m.sideItemName || m.sideItem;
  ok('.side-item 未选中项存在', !!side, side);
  if (side) {
    eq('.side-item 未选中文字色 --text-secondary', side['color'], TEXT_SECONDARY);
    eq('.side-item 未选中字号 13px', side['font-size'], '13px');
  }
}

function runTokenContract(m: any): void {
  if (!m || !m.tokens) {
    ok('自定义属性可读', false, 'tokens 缺失');
    return;
  }
  const unresolved = Object.entries(m.tokens)
    .filter(([name, value]) => !value && !TOKEN_ALLOWLIST.has(name))
    .map(([name]) => name);
  ok(
    `task-workbench.css 引用的 ${tokenNames.length} 个自定义属性全部解析（无未定义 var）`,
    unresolved.length === 0,
    { unresolved },
  );
}

function runAnimationContract(a: any): void {
  if (!a || a.error) {
    ok('勾选动效探针可运行', false, a);
    return;
  }
  const seen: string[] = a.seen || [];
  const checkSeen = a.checkSeen;
  const restoreSeen = a.restoreSeen;

  ok(
    '勾选后 TSX 真的挂上 .spring-pop（死 CSS 检测）',
    !!checkSeen && String(checkSeen.className).includes('spring-pop'),
    { checkSeen },
  );
  ok(
    '勾选弹跳动画 checkPopPulse 真的在跑',
    seen.some((name) => name.indexOf('checkPopPulse') === 0) ||
      (!!checkSeen && (checkSeen.animations || []).includes('checkPopPulse')),
    { seen, animations: checkSeen && checkSeen.animations },
  );
  if (checkSeen) {
    eq('光晕环伪元素动画 checkHaloPulse', checkSeen.pseudoAnimation, 'checkHaloPulse');
    gt(
      '光晕环伪元素边框可见（--check-halo-0 未失效）',
      Number.parseFloat(checkSeen.pseudoBorderWidth),
      0,
    );
  }

  ok(
    '取消勾选后 TSX 真的挂上 .just-restored（死 CSS 检测）',
    !!restoreSeen && String(restoreSeen.className).includes('just-restored'),
    { restoreSeen },
  );
  ok(
    '恢复闪烁动画 restoreFlash 真的在跑',
    seen.some((name) => name.indexOf('restoreFlash') === 0) ||
      (!!restoreSeen && (restoreSeen.animations || []).includes('restoreFlash')),
    { seen, animations: restoreSeen && restoreSeen.animations },
  );
  if (restoreSeen) {
    eq('恢复闪烁走伪元素 opacity', restoreSeen.pseudoAnimation, 'restoreFlash');
  }
}

function waitForSelector(win: BrowserWindow, selector: string, timeoutMs = 10000): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      if (win.isDestroyed()) {
        reject(new Error(`窗口在等待 ${selector} 时被关闭`));
        return;
      }
      const present = await win.webContents.executeJavaScript(
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      );
      if (present) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`等待选择器超时：${selector}`));
        return;
      }
      setTimeout(() => void check(), 60);
    };
    void check();
  });
}

main();
