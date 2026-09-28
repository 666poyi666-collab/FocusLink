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

      // ── v18 移植契约（task-7）──────────────────────────────────────────
      await runPortContract(win);

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

/* ═════════════════════════════════════════════════════════════════════════
   v18 原型 → 客户端移植契约（task-7）
   5 项：① 搜索框跟随调色板 ② 浮层视口夹取 ③ 删 HUD + 右键外观菜单
        ④ 快速录入行 + 动作栏抗压 ⑤ 压缩时属性区不被折叠
   ⑤ 的判定是三重校验：行矩形落在属性表裁剪盒内 ∧ 落在视口内 ∧ 表 scrollHeight <= clientHeight。
   只跟视口比会得到假阳性（原型作者第一版就是这么错的）。
   ═════════════════════════════════════════════════════════════════════════ */

// 打开任务页空白处的外观自定义菜单（合成 contextmenu，走真实 React 事件）。
const OPEN_APPEARANCE_MENU_JS = `(() => {
  const body = document.querySelector('.workspace-body');
  if (!body) return 'no-body';
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 520, clientY: 300 });
  body.dispatchEvent(ev);
  return 'dispatched';
})()`;

const SEARCH_BOX_JS = `(() => {
  const box = document.querySelector('.cmd-search-box');
  if (!box) return { error: 'no search box' };
  const s = getComputedStyle(box);
  const icon = box.querySelector('svg');
  return {
    background: s.backgroundColor,
    borderColor: s.borderTopColor,
    color: s.color,
    height: s.height,
    radius: s.borderRadius,
    fontSize: s.fontSize,
    paddingLeft: s.paddingLeft,
    paddingRight: s.paddingRight,
    transitionProperty: s.transitionProperty,
    iconColor: icon ? getComputedStyle(icon).color : null,
    iconWidth: icon ? getComputedStyle(icon).width : null
  };
})()`;

// 属性区 / 动作栏 / 标题的几何实测（⑤ + ④ 用同一份探针）。
const PANE_GEOMETRY_JS = `(() => {
  const body = document.querySelector('.workspace-body');
  const table = document.querySelector('.linear-props-table');
  if (!table) return { error: 'no props table' };
  const pane = document.querySelector('.detail-pane');
  const heading = document.querySelector('.detail-heading');
  const dock = document.querySelector('.detail-dock-bar');
  const tr = table.getBoundingClientRect();
  const rows = Array.prototype.slice.call(table.querySelectorAll('.prop-table-row')).map(function (row) {
    const r = row.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
  });
  const hr = heading ? heading.getBoundingClientRect() : null;
  const dr = dock ? dock.getBoundingClientRect() : null;
  const dockDur = dock ? dock.querySelector('.dock-focus-dur') : null;
  const dockDoneLabel = dock ? dock.querySelector('.btn-action-done .dock-label') : null;
  const kids = dock ? Array.prototype.slice.call(dock.children).map(function (k) {
    const r = k.getBoundingClientRect();
    return {
      top: r.top, bottom: r.bottom, left: r.left, right: r.right,
      height: r.height, width: r.width,
      scrollWidth: k.scrollWidth, clientWidth: k.clientWidth,
      text: (k.textContent || '').trim(),
      visible: getComputedStyle(k).display !== 'none'
    };
  }) : null;
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    table: { top: tr.top, bottom: tr.bottom, left: tr.left, right: tr.right, height: tr.height, width: tr.width },
    tableScrollHeight: table.scrollHeight,
    tableClientHeight: table.clientHeight,
    tableOverflowY: getComputedStyle(table).overflowY,
    rows: rows,
    rowCount: rows.length,
    headingLineHeight: heading ? getComputedStyle(heading).lineHeight : null,
    headingHeight: hr ? hr.height : null,
    headingFontSize: heading ? getComputedStyle(heading).fontSize : null,
    dock: dr ? {
      top: dr.top, bottom: dr.bottom, left: dr.left, right: dr.right,
      height: dr.height, width: dr.width,
      scrollWidth: dock.scrollWidth, clientWidth: dock.clientWidth
    } : null,
    dockKids: kids,
    dockParts: {
      focusDur: dockDur ? getComputedStyle(dockDur).display : null,
      focusDurText: dockDur ? (dockDur.textContent || '').trim() : null,
      doneLabel: dockDoneLabel ? getComputedStyle(dockDoneLabel).display : null,
      doneLabelText: dockDoneLabel ? (dockDoneLabel.textContent || '').trim() : null,
      doneTitle: dock ? (dock.querySelector('.btn-action-done') || {}).title : null
    },
    workspace: body
      ? {
          left: body.getBoundingClientRect().left,
          width: body.getBoundingClientRect().width,
          scrollWidth: body.scrollWidth,
          clientWidth: body.clientWidth
        }
      : null,
    detailPane: pane ? { scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight } : null
  };
})()`;

// 打开「截止时间」浮层并读它的真实矩形。
const OPEN_DATE_POPOVER_JS = `(() => {
  const pane = document.querySelector('.detail-pane');
  if (pane) pane.scrollTop = 0;
  const rows = Array.prototype.slice.call(document.querySelectorAll('.linear-props-table .prop-table-row'));
  const row = rows.filter(function (r) { return (r.textContent || '').indexOf('截止时间') >= 0; })[0];
  if (!row) return 'no-row';
  const pill = row.querySelector('.prop-action-pill');
  if (!pill) return 'no-pill';
  pill.click();
  return 'ok';
})()`;

const POPOVER_RECT_JS = `(() => {
  const el = document.querySelector('.date-popover.active');
  if (!el) return { error: 'no date popover' };
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
    maxHeight: s.maxHeight,
    overflowY: s.overflowY
  };
})()`;

const QUICK_BAR_JS = `(() => {
  const bar = document.querySelector('.quick-create-bar');
  if (!bar) return { error: 'no quick create bar' };
  const s = getComputedStyle(bar);
  const input = bar.querySelector('input');
  const kbd = bar.querySelector('.kbd-hint');
  return {
    height: s.height,
    radius: s.borderRadius,
    borderColor: s.borderTopColor,
    paddingLeft: s.paddingLeft,
    paddingRight: s.paddingRight,
    inputFontSize: input ? getComputedStyle(input).fontSize : null,
    placeholder: input ? input.getAttribute('placeholder') : null,
    kbdText: kbd ? (kbd.textContent || '').trim() : null,
    kbdPresent: !!kbd,
    floatingHudPresent: !!document.querySelector('.floating-hud')
  };
})()`;

// 搜索框三档调色板的验收计算值（原型 v18 实测值）。
const SEARCH_EXPECTED: Record<string, { bg: string; border: string; icon: string }> = {
  linear: { bg: 'rgba(37, 99, 235, 0.1)', border: 'rgba(0, 0, 0, 0.06)', icon: 'rgb(37, 99, 235)' },
  rose: {
    bg: 'rgba(225, 29, 72, 0.12)',
    border: 'rgba(225, 29, 72, 0.08)',
    icon: 'rgb(225, 29, 72)',
  },
  contrast: { bg: 'rgba(0, 0, 0, 0.08)', border: 'rgba(0, 0, 0, 0.15)', icon: 'rgb(0, 0, 0)' },
};

async function setViewport(win: BrowserWindow, width: number, height: number): Promise<void> {
  win.setContentSize(width, height);
  // 布局 + 过渡都要落定，否则读到中间值。
  await sleep(260);
}

function insideViewport(rect: any, vp: any): boolean {
  return (
    rect.top >= -0.5 && rect.left >= -0.5 && rect.bottom <= vp.h + 0.5 && rect.right <= vp.w + 0.5
  );
}

// ⑤ 的三重校验：行矩形在属性表裁剪盒内 ∧ 在视口内 ∧ 表自身不溢出。
function assertPropsTripleCheck(tag: string, m: any, checkViewport = true): void {
  if (!m || m.error) {
    ok(`属性区几何可读 ${tag}`, false, m);
    return;
  }
  eq(`${tag} 属性表高 136px（四行 32px + 3 间隙 2px + 2 边框）`, m.table.height, 136);
  eq(`${tag} 属性表 4 行`, m.rowCount, 4);
  ok(
    `${tag} 属性表自身 scrollHeight <= clientHeight（未被 flex 压缩裁掉）`,
    m.tableScrollHeight <= m.tableClientHeight,
    { scrollHeight: m.tableScrollHeight, clientHeight: m.tableClientHeight },
  );
  m.rows.forEach((row: any, idx: number) => {
    ok(
      `${tag} 第 ${idx + 1} 行落在属性表裁剪盒内`,
      row.top >= m.table.top - 0.5 &&
        row.bottom <= m.table.bottom + 0.5 &&
        row.left >= m.table.left - 0.5 &&
        row.right <= m.table.right + 0.5,
      { row, table: m.table },
    );
    if (checkViewport) {
      ok(`${tag} 第 ${idx + 1} 行落在视口内`, insideViewport(row, m.viewport), {
        row,
        viewport: m.viewport,
      });
    } else {
      // 主窗口 floor 980x660 以下不可达；这里只要求「没被静默裁掉」：工作区可横向滚动到它。
      ok(
        `${tag} 第 ${idx + 1} 行未被静默裁掉（工作区可横向滚动到它）`,
        !!m.workspace &&
          m.workspace.scrollWidth > m.workspace.clientWidth &&
          row.right <= m.workspace.left + m.workspace.scrollWidth + 0.5,
        { row, workspace: m.workspace },
      );
    }
    eq(`${tag} 第 ${idx + 1} 行高 32px`, row.height, 32);
  });
  // 标题不许被压成 0（原型修复前连标题都被压成 0px）。
  eq(`${tag} 详情标题行高 22.9px（未被压扁）`, m.headingLineHeight, '22.95px');
  ok(`${tag} 详情标题有实际高度`, m.headingHeight > 20, { headingHeight: m.headingHeight });
  ok(
    `${tag} 详情动作 dock 可见`,
    !!m.dock &&
      m.dock.height > 20 &&
      m.dock.width > 20 &&
      (checkViewport
        ? insideViewport(m.dock, m.viewport)
        : !!m.workspace && m.dock.right <= m.workspace.left + m.workspace.scrollWidth + 0.5),
    { dock: m.dock, viewport: m.viewport, workspace: m.workspace },
  );
}

// ④ 的动作栏抗压判定。
function assertDockRow(tag: string, m: any): void {
  if (!m || m.error || !m.dock || !m.dockKids || m.dockKids.length < 3) {
    ok(`${tag} 动作栏几何可读`, false, m && { dock: m.dock, kids: m.dockKids });
    return;
  }
  const dock = m.dock;
  const kids = m.dockKids.filter((k: any) => k.visible);
  const kidsInside = kids.every(
    (k: any) =>
      k.top >= dock.top - 0.5 &&
      k.bottom <= dock.bottom + 0.5 &&
      k.left >= dock.left - 0.5 &&
      k.right <= dock.right + 0.5,
  );
  ok(`${tag} kidsInside（按钮矩形都在动作栏内）`, kidsInside, { dock, kids });
  const tops = kids.map((k: any) => Math.round(k.top));
  const sameRow = tops.every((t: number) => Math.abs(t - tops[0]) <= 1) && dock.height <= 48;
  ok(`${tag} sameRow（同一行，不上下堆叠）`, sameRow, { tops, dockHeight: dock.height });
  ok(`${tag} noSelfOverflow（动作栏自身不横向溢出）`, dock.scrollWidth <= dock.clientWidth + 1, {
    scrollWidth: dock.scrollWidth,
    clientWidth: dock.clientWidth,
  });
  kids.forEach((k: any) => {
    ok(`${tag} 按钮「${k.text || '(图标)'}」内容不溢出`, k.scrollWidth <= k.clientWidth + 1, {
      text: k.text,
      scrollWidth: k.scrollWidth,
      clientWidth: k.clientWidth,
    });
  });

  // 容器查询逐级收窄：内容盒 <=312px 收「(25m)」；<=244px 收「完成任务」文字（变图标按钮，保留 title）。
  const parts = m.dockParts || {};
  const cw = dock.width;
  eq(
    `${tag} 内容盒 ${Math.round(cw)}px 时「(25m)」后缀${cw <= 312 ? '已收起' : '仍显示'}`,
    parts.focusDur,
    // flex 子项会被 blockify，所以可见时 computed display 是 block 而不是 inline。
    cw <= 312 ? 'none' : 'block',
  );
  eq(
    `${tag} 内容盒 ${Math.round(cw)}px 时「完成任务」文字${cw <= 244 ? '已收起' : '仍显示'}`,
    parts.doneLabel,
    cw <= 244 ? 'none' : 'block',
  );
  if (cw <= 244) {
    ok(
      `${tag} 收成图标按钮后仍保留 title（可发现性）`,
      typeof parts.doneTitle === 'string' && parts.doneTitle.length > 0,
      parts.doneTitle,
    );
  }
}

async function runPortContract(win: BrowserWindow): Promise<void> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const openAppearanceMenu = async (): Promise<void> => {
    const r = await js(OPEN_APPEARANCE_MENU_JS);
    await sleep(260);
    const open = await js(`Boolean(document.querySelector('.appearance-menu.active'))`);
    ok('任务页空白处右键打开外观自定义菜单', r === 'dispatched' && open === true, { r, open });
  };
  const pressEscape = async (): Promise<void> => {
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(200);
  };

  // ── ③ 删掉底部 HUD ────────────────────────────────────────────────────
  const hud = await js(`(() => ({
    hud: !!document.querySelector('.floating-hud'),
    quickBar: !!document.querySelector('.quick-create-bar')
  }))()`);
  eq('③ 客户端底部悬浮 HUD 已删除', hud.hud, false);
  eq('③ 快速录入行仍在', hud.quickBar, true);

  // ── ① 搜索框跟随调色板（三档互不相同，等过渡结束再读）──────────────
  await setViewport(win, 1100, 660);
  await openAppearanceMenu();
  const seenSearch: Record<string, any> = {};
  for (const pal of ['linear', 'rose', 'contrast']) {
    const clicked = await js(
      `(() => {
        const item = document.querySelector('.appearance-menu.active [data-app-pal="${pal}"]');
        if (!item) return false;
        item.click();
        return true;
      })()`,
    );
    ok(`① 外观菜单可点选调色板 ${pal}`, clicked === true, clicked);
    // transition: background/border/color .15s —— 必须等过渡结束，否则三档读到同一个中间值。
    await sleep(460);
    const s = await js(SEARCH_BOX_JS);
    if (s && !s.error) {
      console.log(
        `[style-contract] ① 搜索框 ${pal} 实测 bg=${s.background} border=${s.borderColor} icon=${s.iconColor}`,
      );
    }
    seenSearch[pal] = s;
    const exp = SEARCH_EXPECTED[pal];
    ok(`① 搜索框 ${pal} 可读`, !!s && !s.error, s);
    if (s && !s.error) {
      eq(`① 搜索框 ${pal} 背景 = --accent-soft`, s.background, exp.bg);
      eq(`① 搜索框 ${pal} 边框 = --border-subtle`, s.borderColor, exp.border);
      eq(`① 搜索框 ${pal} 图标色 = --accent`, s.iconColor, exp.icon);
    }
  }
  const searchGeom = seenSearch.linear;
  if (searchGeom && !searchGeom.error) {
    eq('① 搜索框高 32px', searchGeom.height, '32px');
    eq('① 搜索框圆角 8px (--r-md)', searchGeom.radius, '8px');
    eq('① 搜索框字号 12.5px', searchGeom.fontSize, '12.5px');
    eq('① 搜索框左内距 11px', searchGeom.paddingLeft, '11px');
    eq('① 搜索框右内距 8px', searchGeom.paddingRight, '8px');
    eq('① 搜索框图标 14px', searchGeom.iconWidth, '14px');
    ok(
      '① 搜索框过渡仍是分属性过渡（保留过渡但不再 all）',
      String(searchGeom.transitionProperty).indexOf('all') < 0 &&
        String(searchGeom.transitionProperty).indexOf('background') >= 0 &&
        String(searchGeom.transitionProperty).indexOf('color') >= 0,
      searchGeom.transitionProperty,
    );
  }
  const bgSet = ['linear', 'rose', 'contrast'].map(
    (p) => seenSearch[p] && seenSearch[p].background,
  );
  ok('① 三档调色板背景两两不同', new Set(bgSet).size === 3, bgSet);
  await pressEscape();
  // 复位到 linear：后续几何 / 颜色断言都以默认档为基准。
  await js(
    `window.focuslink.settings.set({ taskWorkspaceAppearance: { palette: 'linear', font: 'sans', density: 'default' } })`,
  );
  await sleep(460);

  // ── 额外缺陷①：原型 openProjectPopover() 引用了未声明的 t，点「所属清单」
  //    pill 立刻抛 ReferenceError，弹层永远打不开（v17 就坏，不是新引入）。
  //    客户端是 React 结构（弹层读 currentTask?.projectId，没有裸 t），
  //    所以这里必须实测确认它本来就能打开，而不是照抄原型的修法。
  const projOpen = await js(`(() => {
    const rows = Array.prototype.slice.call(document.querySelectorAll('.linear-props-table .prop-table-row'));
    const row = rows.filter(function (r) { return (r.textContent || '').indexOf('所属清单') >= 0; })[0];
    if (!row) return 'no-row';
    const pill = row.querySelector('.prop-action-pill');
    if (!pill) return 'no-pill';
    pill.click();
    return 'ok';
  })()`);
  await sleep(280);
  const projPop = await js(`(() => {
    const el = document.querySelector('.popover-menu.active');
    if (!el) return { open: false };
    const r = el.getBoundingClientRect();
    return {
      open: true,
      items: el.querySelectorAll('.popover-item').length,
      top: r.top, left: r.left, bottom: r.bottom, right: r.right,
      vw: window.innerWidth, vh: window.innerHeight
    };
  })()`);
  ok(
    '额外缺陷① 客户端「所属清单」弹层能打开（无未声明变量 ReferenceError）',
    projOpen === 'ok' && projPop.open === true && projPop.items > 0,
    { projOpen, projPop },
  );
  if (projPop.open) {
    ok(
      '额外缺陷① 所属清单弹层也完整落在视口内（共用同一套硬夹取）',
      projPop.top >= -0.5 &&
        projPop.left >= -0.5 &&
        projPop.bottom <= projPop.vh + 0.5 &&
        projPop.right <= projPop.vw + 0.5,
      projPop,
    );
  }
  await pressEscape();

  // ── ③ 任务行右键仍走原任务菜单（两者不冲突）──────────────────────────
  await js(`(() => {
    const row = document.querySelector('.task-entry');
    if (!row) return 'no-row';
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 220 }));
    return 'ok';
  })()`);
  await sleep(220);
  const rowMenu = await js(`(() => {
    const m = document.querySelector('.ctx-menu.active');
    return {
      present: !!m,
      isAppearance: !!document.querySelector('.appearance-menu.active'),
      text: m ? (m.textContent || '') : ''
    };
  })()`);
  ok(
    '③ 任务行右键仍走原任务菜单（不是外观菜单）',
    rowMenu.present && !rowMenu.isAppearance && rowMenu.text.indexOf('开始专注') >= 0,
    rowMenu,
  );
  await pressEscape();

  // ── ⑤ 属性区不折叠（8 档宽度 + 三重校验）─────────────────────────────
  const viewports: Array<[number, number]> = [
    [1280, 660],
    [1100, 660],
    [980, 660],
    [900, 660],
    [840, 600],
    [780, 600],
    [560, 560],
    [460, 560],
  ];
  // 客户端主窗口 floor = 980x660（shared/mainWindowLayout.ts MAIN_WINDOW_MIN_SIZE），
  // 且 app-shell 左轨（64~77px）还会再吃掉一截宽度，所以 980 以下的宽度只在回归
  // harness 里可达。判定按「工作区是否还容得下栅格最小宽度 168+276=444px」分流：
  //   - 容得下 → 完整三重校验（行在属性表裁剪盒内 ∧ 行在视口内 ∧ 表 scrollHeight <= clientHeight）
  //   - 容不下（只有 460 这一档，工作区 396px）→ 仍做纵向三重校验，并断言「没被静默裁掉」：
  //     工作区必须真的可横向滚动到属性区，而不是被 overflow:hidden 悄悄切掉。
  for (const [w, h] of viewports) {
    await setViewport(win, w, h);
    const m = await js(PANE_GEOMETRY_JS);
    const fits = !m.workspace || m.workspace.width >= 444;
    console.log(
      `[style-contract] ⑤ ${w}x${h} 实测 表高=${m.table.height} 行高=${m.rows
        .map((r: any) => r.height)
        .join(
          '/',
        )} scrollH=${m.tableScrollHeight} clientH=${m.tableClientHeight} 标题行高=${m.headingLineHeight} 工作区宽=${m.workspace && m.workspace.width}`,
    );
    assertPropsTripleCheck(`⑤ ${w}x${h}`, m, fits);
  }

  // ── ④ 动作栏抗压（980 / 840 / 560）───────────────────────────────────
  // 620 / 460 两档是为了真正走到容器查询的两个断点（<=312 与 <=244），
  // 否则断言只在「不收」分支上空跑。
  for (const [w, h] of [
    [980, 660],
    [840, 600],
    [620, 600],
    [560, 560],
    [460, 560],
  ] as Array<[number, number]>) {
    await setViewport(win, w, h);
    const m = await js(PANE_GEOMETRY_JS);
    console.log(
      `[style-contract] ④ ${w}x${h} 实测 内容盒=${m.dock && m.dock.width} dockH=${m.dock && m.dock.height} scrollW=${m.dock && m.dock.scrollWidth} clientW=${m.dock && m.dock.clientWidth} (25m)=${m.dockParts && m.dockParts.focusDur} 完成任务=${m.dockParts && m.dockParts.doneLabel}`,
    );
    assertDockRow(`④ ${w}x${h}`, m);
  }

  // ── ② 浮层视口夹取（980x660 / 840x600 / 980x440）─────────────────────
  for (const [w, h] of [
    [980, 660],
    [840, 600],
    [980, 440],
  ] as Array<[number, number]>) {
    await setViewport(win, w, h);
    const opened = await js(OPEN_DATE_POPOVER_JS);
    ok(`② ${w}x${h} 可打开「截止时间」浮层`, opened === 'ok', opened);
    await sleep(320);
    const p = await js(POPOVER_RECT_JS);
    if (p && !p.error) {
      console.log(
        `[style-contract] ② ${w}x${h} 浮层实测 rect=${JSON.stringify(p.rect)} viewport=${JSON.stringify(p.viewport)}`,
      );
    }
    ok(`② ${w}x${h} 浮层可读`, !!p && !p.error, p);
    if (p && !p.error) {
      ok(`② ${w}x${h} 浮层完全落在视口内`, insideViewport(p.rect, p.viewport), {
        rect: p.rect,
        viewport: p.viewport,
      });
      ok(
        `② ${w}x${h} 浮层高度 > 0 且 <= 视口`,
        p.rect.height > 0 && p.rect.height <= p.viewport.h,
        p.rect,
      );
      eq(`② ${w}x${h} 浮层 overflow-y auto`, p.overflowY, 'auto');
    }
    await pressEscape();
  }

  // ── ④ 快速录入行 ────────────────────────────────────────────────────
  await setViewport(win, 980, 660);
  const qb = await js(QUICK_BAR_JS);
  ok('④ 快速录入行可读', !!qb && !qb.error, qb);
  if (qb && !qb.error) {
    eq('④ 快速录入行高 34px', qb.height, '34px');
    eq('④ 快速录入行圆角 6px (--r-sm)', qb.radius, '6px');
    eq('④ 快速录入行边框 --border-subtle', qb.borderColor, 'rgba(0, 0, 0, 0.06)');
    eq('④ 快速录入行左内距 11px', qb.paddingLeft, '11px');
    eq('④ 快速录入行右内距 8px', qb.paddingRight, '8px');
    eq('④ 快速录入行字号 12.5px', qb.inputFontSize, '12.5px');
    eq('④ 快速录入行 placeholder', qb.placeholder, '添加任务…');
    ok('④ 快速录入行右侧 Enter kbd', qb.kbdPresent && qb.kbdText === 'Enter', qb);
    eq('④ 底部 HUD 不存在', qb.floatingHudPresent, false);
  }

  // ── ③ 外观菜单每一项都写设置（持久化，不是组件内 state）──────────────
  await openAppearanceMenu();
  const menuShape = await js(`(() => {
    const m = document.querySelector('.appearance-menu.active');
    if (!m) return { error: 'no menu' };
    return {
      role: m.getAttribute('role'),
      label: m.getAttribute('aria-label'),
      items: Array.prototype.slice.call(m.querySelectorAll('.ctx-menu-item')).map(function (el) {
        return {
          theme: el.getAttribute('data-app-theme'),
          pal: el.getAttribute('data-app-pal'),
          font: el.getAttribute('data-app-font'),
          density: el.getAttribute('data-app-density'),
          sound: el.getAttribute('data-app-sound'),
          checked: el.getAttribute('aria-checked')
        };
      }),
      focusedIsFirstItem: document.activeElement === m.querySelector('.ctx-menu-item'),
      labels: Array.prototype.slice.call(m.querySelectorAll('.ctx-menu-label')).map(function (el) { return el.textContent; })
    };
  })()`);
  ok('③ 外观菜单存在且 role=menu', menuShape && menuShape.role === 'menu', menuShape);
  if (menuShape && !menuShape.error) {
    const groups = [
      ['主题', ['light', 'dark'], 'theme'],
      ['色彩基调', ['linear', 'rose', 'contrast'], 'pal'],
      ['字体', ['sans', 'serif'], 'font'],
      ['密度', ['default', 'compact', 'relaxed'], 'density'],
      ['音效', ['on', 'off'], 'sound'],
    ] as Array<[string, string[], string]>;
    for (const [label, values, key] of groups) {
      const found = menuShape.items
        .map((i: any) => i[key])
        .filter((v: any) => v != null && values.indexOf(v) >= 0);
      eq(
        `③ 外观菜单含「${label}」全部档位`,
        Array.from(new Set(found)).sort().join(','),
        values.slice().sort().join(','),
      );
    }
    ok(
      '③ 打开外观菜单自动聚焦首项',
      menuShape.focusedIsFirstItem === true,
      menuShape.focusedIsFirstItem,
    );
  }

  const clickItem = async (selector: string): Promise<boolean> =>
    (await js(`(() => {
      const el = document.querySelector('.appearance-menu.active ' + ${JSON.stringify('')} + '${selector}');
      if (!el) return false;
      el.click();
      return true;
    })()`)) === true;

  ok('③ 可点选调色板 rose', await clickItem('[data-app-pal="rose"]'));
  await sleep(300);
  ok('③ 可点选密度 compact', await clickItem('[data-app-density="compact"]'));
  await sleep(300);
  ok('③ 可点选字体 serif', await clickItem('[data-app-font="serif"]'));
  await sleep(300);
  ok('③ 可点选主题 dark', await clickItem('[data-app-theme="dark"]'));
  await sleep(400);
  await pressEscape();

  const persisted = await js(`window.focuslink.settings.get()`);
  eq('③ 调色板写入 settings（持久化）', persisted.taskWorkspaceAppearance.palette, 'rose');
  eq('③ 密度写入 settings（持久化）', persisted.taskWorkspaceAppearance.density, 'compact');
  eq('③ 字体写入 settings（持久化）', persisted.taskWorkspaceAppearance.font, 'serif');
  eq('③ 主题写入 settings（持久化）', persisted.theme, 'dark');

  // 深色 + rose 不再是 dark + linear（修掉「切颜色它不变」）
  const darkRose = await js(`(() => {
    const root = document.querySelector('.task-workspace-root');
    const cs = getComputedStyle(root);
    const btn = document.querySelector('.btn-action-focus');
    return {
      pal: root.getAttribute('data-pal'),
      theme: root.getAttribute('data-theme'),
      accent: cs.getPropertyValue('--accent').trim(),
      accentSoft: cs.getPropertyValue('--accent-soft').trim(),
      btnBg: btn ? getComputedStyle(btn).backgroundColor : null
    };
  })()`);
  eq('③ 深色主题下 data-pal=rose 生效', darkRose.pal, 'rose');
  eq('③ 深色主题下 data-theme=dark 生效', darkRose.theme, 'dark');
  eq('③ 深色 + rose 的 --accent 是玫红（不是蓝）', darkRose.accent, '#e11d48');
  // 自定义属性的 getPropertyValue 走 token 序列化（.26 / .2），不是颜色归一化。
  eq('③ 深色 + rose 的 --accent-soft 是玫红', darkRose.accentSoft, 'rgba(225, 29, 72, .26)');
  eq('③ 深色 + rose 的专注主按钮是玫红', darkRose.btnBg, 'rgb(225, 29, 72)');

  // 深色 + linear 必须与深色 + rose 不同（修复前二者完全相同）
  await openAppearanceMenu();
  await clickItem('[data-app-pal="linear"]');
  await sleep(300);
  await pressEscape();
  const darkLinear = await js(`(() => {
    const cs = getComputedStyle(document.querySelector('.task-workspace-root'));
    return {
      accent: cs.getPropertyValue('--accent').trim(),
      accentSoft: cs.getPropertyValue('--accent-soft').trim()
    };
  })()`);
  ok(
    '③ 深色下 rose 与 linear 的 --accent-soft 不同（修复前恒等）',
    darkLinear.accentSoft !== darkRose.accentSoft,
    { rose: darkRose.accentSoft, linear: darkLinear.accentSoft },
  );
  eq(
    '③ 深色 + linear 的 --accent-soft 回到电光蓝',
    darkLinear.accentSoft,
    'rgba(59, 130, 246, .2)',
  );

  // 还原默认外观，避免污染后续断言与用户设置
  await js(`window.focuslink.settings.set({
    theme: 'light',
    taskWorkspaceAppearance: { palette: 'linear', font: 'sans', density: 'default' }
  })`);
  await sleep(420);
  const restored = await js(`(() => {
    const root = document.querySelector('.task-workspace-root');
    const box = document.querySelector('.cmd-search-box');
    return {
      pal: root.getAttribute('data-pal'),
      density: root.getAttribute('data-density'),
      theme: root.getAttribute('data-theme'),
      searchBg: getComputedStyle(box).backgroundColor,
      hud: !!document.querySelector('.floating-hud')
    };
  })()`);
  eq('③ 还原：data-pal=linear', restored.pal, 'linear');
  eq('③ 还原：data-density=default', restored.density, 'default');
  eq('③ 还原：data-theme=light', restored.theme, 'light');
  eq('③ 还原：搜索框背景回到 linear --accent-soft', restored.searchBg, 'rgba(37, 99, 235, 0.1)');
  eq('③ 还原：底部 HUD 仍然不存在', restored.hud, false);

  // ── B. 既有已验收功能未被破坏（勾选动效 / 删除线由上方 ANIMATION 段覆盖）────
  await setViewport(win, 1100, 700);
  const legacy = await js(`(() => {
    const group = document.querySelector('.uncompleted-group');
    const divider = document.querySelector('.completed-divider-bar');
    const qb = document.querySelector('.quick-create-bar');
    return {
      uncompletedMinHeight: group ? getComputedStyle(group).minHeight : null,
      // 50vh - 76px 会被浏览器解析成 px，这里按同一算式给出期望值
      uncompletedMinHeightExpected: Math.max(260, window.innerHeight / 2 - 76),
      uncompletedHeight: group ? group.getBoundingClientRect().height : null,
      dividerText: divider ? (divider.textContent || '').trim() : null,
      focusTimeline: !!document.querySelector('.f-nodes-flow, .f-horiz-track'),
      quickPosition: qb ? getComputedStyle(qb).position : null,
      quickBottom: qb ? getComputedStyle(qb).bottom : null
    };
  })()`);
  eq(
    'B 1/2 沉底：未完成组保底 max(260px, calc(50vh - 76px))',
    Number.parseFloat(legacy.uncompletedMinHeight),
    legacy.uncompletedMinHeightExpected,
  );
  ok('B 1/2 沉底：未完成组实际高度 >= 260px', legacy.uncompletedHeight >= 260, legacy);
  ok(
    'B 已完成分隔条仍在（显示「已完成 N」）',
    typeof legacy.dividerText === 'string' && legacy.dividerText.indexOf('已完成') >= 0,
    legacy.dividerText,
  );
  ok(
    'B 横向专注时序卡容器仍在（.f-nodes-flow / .f-horiz-track）',
    legacy.focusTimeline === true,
    legacy.focusTimeline,
  );
  eq('B 快速录入行仍是 sticky 沉底', legacy.quickPosition, 'sticky');
  eq('B 快速录入行 bottom 14px', legacy.quickBottom, '14px');

  // B 清单图标弹层（清单右键 → 更换图标与颜色 → .iconpop）
  const projMenuOpen = await js(`(() => {
    const items = Array.prototype.slice.call(document.querySelectorAll('.sidebar .side-item'));
    const target = items.filter(function (el) { return (el.textContent || '').indexOf('样式契约清单') >= 0; })[0];
    if (!target) return 'no-project';
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 260 }));
    return 'ok';
  })()`);
  await sleep(240);
  const projMenu = await js(`(() => {
    const m = document.querySelector('.ctx-menu.active');
    if (!m) return { open: false, hasIconItem: false };
    const items = Array.prototype.slice.call(m.querySelectorAll('.ctx-menu-item'));
    return {
      open: true,
      hasIconItem: items.some(function (el) { return (el.textContent || '').indexOf('更换图标') >= 0; }),
      text: (m.textContent || '').trim()
    };
  })()`);
  ok(
    'B 清单右键菜单仍在（含「更换图标与颜色」）',
    projMenuOpen === 'ok' && projMenu.open === true && projMenu.hasIconItem === true,
    { projMenuOpen, projMenu },
  );
  if (projMenu.hasIconItem) {
    await js(`(() => {
      const m = document.querySelector('.ctx-menu.active');
      const items = Array.prototype.slice.call(m.querySelectorAll('.ctx-menu-item'));
      items.filter(function (el) { return (el.textContent || '').indexOf('更换图标') >= 0; })[0].click();
      return true;
    })()`);
    await sleep(320);
    const iconPop = await js(`(() => {
      const el = document.querySelector('.iconpop.active');
      if (!el) return { open: false };
      const r = el.getBoundingClientRect();
      return {
        open: true,
        icons: el.querySelectorAll('.grid-icon-btn').length,
        top: r.top, left: r.left, bottom: r.bottom, right: r.right,
        vw: window.innerWidth, vh: window.innerHeight
      };
    })()`);
    ok('B 清单图标弹层仍能打开', iconPop.open === true && iconPop.icons > 0, iconPop);
    if (iconPop.open) {
      ok(
        'B 清单图标弹层也在视口内（共用同一套硬夹取）',
        iconPop.top >= -0.5 &&
          iconPop.left >= -0.5 &&
          iconPop.bottom <= iconPop.vh + 0.5 &&
          iconPop.right <= iconPop.vw + 0.5,
        iconPop,
      );
    }
    await pressEscape();
  }

  // B 就地改名（任务行右键 → 重命名任务 → 行内输入框）
  await js(`(() => {
    const row = document.querySelector('.task-entry');
    if (!row) return 'no-row';
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 220 }));
    return 'ok';
  })()`);
  await sleep(240);
  const renameOpened = await js(`(() => {
    const m = document.querySelector('.ctx-menu.active');
    if (!m) return 'no-menu';
    const items = Array.prototype.slice.call(m.querySelectorAll('.ctx-menu-item'));
    const item = items.filter(function (el) { return (el.textContent || '').indexOf('重命名任务') >= 0; })[0];
    if (!item) return 'no-item';
    item.click();
    return 'ok';
  })()`);
  await sleep(260);
  const inlineEdit = await js(`(() => {
    const el = document.querySelector('.inline-task-edit');
    return { present: !!el, value: el ? el.value : null };
  })()`);
  ok(
    'B 就地改名仍在（行内输入框带当前标题）',
    renameOpened === 'ok' && inlineEdit.present === true && !!inlineEdit.value,
    { renameOpened, inlineEdit },
  );
  await js(`(() => {
    const el = document.querySelector('.inline-task-edit');
    if (el) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  })()`);
  await sleep(200);

  // 窄窗回到默认尺寸，避免影响后续（本契约已是最后一段）
  await setViewport(win, 1180, 760);
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
