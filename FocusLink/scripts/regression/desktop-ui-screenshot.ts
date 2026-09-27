// 隔离 Electron 实例，走遍桌面端四个页面，捕获明暗两套主题并断言全局排版契约。
// 运行方式（在 FocusLink/ 下）：
//   npx electron scripts/regression/desktop-ui-screenshot-entry.cjs
//
// 断言的重点是「静默失效」这一类问题：CSS 里引用了未定义的自定义属性时，
// 整条声明在计算期作废且不报任何错。`font: 620 13px/1.2 var(--font-display)`
// 这样的简写一旦失效，连字号字重一起丢，标题会悄悄退回浏览器默认值——
// 页面依旧能跑，只是看起来处处不对。这里把结果量出来。
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureIsolatedUserData } from './isolatedUserData';
import {
  initDatabase,
  closeDatabase,
  insertSession,
  insertSegment,
} from '../../electron/db/index.js';
import { TimerManager } from '../../electron/timer/manager.js';
import { FocusTimerController } from '../../electron/timer/focusTimerController.js';
import { registerIpc } from '../../electron/ipc.js';
import { MAIN_WINDOW_DEFAULT_SIZE } from '@shared/mainWindowLayout';

// 150% 缩放下 1px 会被算成 0.667px，截图与边框断言必须钉死 dsf=1，
// 否则会造出一堆假边框差异（diff-auditor 踩过）。
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const outputDir = path.resolve(projectRoot, 'test-data', 'desktop-ui-screenshots');

const PAGES = [
  { id: 'timer', label: '专注', anchor: '.timer-dial' },
  { id: 'tasks', label: '任务', anchor: '.task-workspace-root' },
  { id: 'history', label: '统计', anchor: '.history-page' },
  { id: 'settings', label: '设置', anchor: '.settings-page' },
] as const;

// 单实例锁按 userData 路径区分：必须先切到隔离目录再抢锁。
// 否则用户桌面上正在运行的 FocusLink 会让本 harness 拿不到锁并静默 exit 0，
// 看起来像「通过」，实际上一个断言都没跑。
configureIsolatedUserData('desktop-ui-screenshot', true);
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error(
    '[ui] another isolated UI regression instance owns the lock; refusing to report a pass',
  );
  app.quit();
  process.exit(2);
}

app
  .whenReady()
  .then(async () => {
    fs.mkdirSync(outputDir, { recursive: true });
    initDatabase();

    // Isolated regression data: night-time focus must be visible to the second.
    const fixtureDay = new Date();
    fixtureDay.setDate(fixtureDay.getDate() - 1);
    fixtureDay.setHours(0, 0, 0, 0);
    const fixtureStart = fixtureDay.getTime();
    const fixtureElapsed = 10_516_000;
    const fixtureEnd = fixtureStart + fixtureElapsed;
    insertSession({
      id: 'dashboard-night-regression',
      title: '夜间统计回归',
      status: 'finished',
      startedAt: fixtureStart,
      endedAt: fixtureEnd,
      activeElapsedMs: fixtureElapsed,
      pauseElapsedMs: 0,
      wallElapsedMs: fixtureElapsed,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
      note: null,
      createdAt: fixtureStart,
      updatedAt: fixtureEnd,
    });
    insertSegment({
      id: 'dashboard-night-segment',
      sessionId: 'dashboard-night-regression',
      taskId: null,
      taskSource: null,
      title: '夜间统计回归',
      startedAt: fixtureStart,
      endedAt: fixtureEnd,
      activeElapsedMs: fixtureElapsed,
      note: null,
      cloudFocusId: null,
      tomatodoSubject: null,
      createdAt: fixtureStart,
      updatedAt: fixtureEnd,
    });

    const timer = new FocusTimerController(new TimerManager());
    timer.recover();

    const mainWindow = new BrowserWindow({
      width: MAIN_WINDOW_DEFAULT_SIZE.width,
      height: MAIN_WINDOW_DEFAULT_SIZE.height,
      show: false,
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: '#f5f7f4',
      webPreferences: {
        backgroundThrottling: false,
        preload: path.join(projectRoot, 'dist-electron', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    registerIpc(timer, mainWindow, () => undefined);
    timer.onSnapshot((snapshot) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tick', snapshot);
        mainWindow.webContents.send('timer:state-changed', snapshot);
      }
    });
    mainWindow.loadFile(path.join(projectRoot, 'dist', 'index.html'));
    await waitForDidFinishLoad(mainWindow);
    mainWindow.show();
    await sleep(800);

    // ── 全局排版契约 ──────────────────────────────────────────
    // 这些令牌被 Tailwind 的 font-mono / font-display 与多条 font 简写引用；
    // 未定义时不会报错，只会让排版整体走样。
    const tokens = await mainWindow.webContents.executeJavaScript(`(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        display: style.getPropertyValue('--font-display').trim(),
        mono: style.getPropertyValue('--font-mono').trim(),
        canvas: style.getPropertyValue('--app-canvas').trim(),
        companion: style.getPropertyValue('--app-accent-companion').trim(),
      };
    })()`);
    for (const [name, value] of Object.entries(tokens)) {
      if (!value) throw new Error(`Design token --${name} resolves to nothing`);
    }
    if (!/mono/i.test(String(tokens.mono))) {
      throw new Error(`--font-mono is not a monospace stack: ${String(tokens.mono)}`);
    }
    console.log('[ui] tokens resolve:', JSON.stringify(tokens));

    mainWindow.webContents.send('navigate', 'settings');
    await waitForSelector(mainWindow, '.settings-section-heading h3');
    await sleep(320);

    // 分区标题的字号字重来自一条 font 简写；简写作废时会退回 UA 的 h3 样式
    // （约 1.17em 加粗），这正是「标题莫名其妙很大」的成因。
    const heading = await mainWindow.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('.settings-section-heading h3');
      const style = getComputedStyle(el);
      return { fontSize: style.fontSize, fontWeight: style.fontWeight, family: style.fontFamily };
    })()`);
    if (heading.fontSize !== '15px') {
      throw new Error(`Section heading font shorthand did not apply: ${JSON.stringify(heading)}`);
    }
    console.log('[ui] section heading:', JSON.stringify(heading));

    // 设置面已按 FL-REQ-20260927-DIDA-L1 退役滴答/CLI/OAuth：
    // 这里断言「设置面不再提供任何第三方任务适配器」，与 tests/settingsAccountUi.test.ts 的新契约一致。
    await mainWindow.webContents.executeJavaScript(`(() => {
      const groups = [...document.querySelectorAll('.settings-nav-list .settings-tab')];
      groups[3]?.click();
    })()`);
    await sleep(320);
    const adapterAudit = await mainWindow.webContents.executeJavaScript(`(() => {
      const text = document.querySelector('.settings-page')?.textContent ?? document.body.textContent ?? '';
      const forbiddenText = ['外部任务导入', '滴答', 'TickTick', '任务来源'].filter((needle) => text.includes(needle));
      const forbiddenNodes = [
        '.settings-external-task-disclosure',
        '.settings-provider-advanced',
        '[data-settings-section="dida-connection"]',
        '[data-settings-section="dida-sync"]',
        '[data-settings-section="dida-oauth"]',
      ].filter((selector) => document.querySelector(selector));
      return {
        forbiddenText,
        forbiddenNodes,
        tomatodoPresent: text.includes('番茄'),
        tabs: [...document.querySelectorAll('.settings-nav-list .settings-tab')].map(
          (tab) => tab.textContent?.trim() ?? '',
        ),
      };
    })()`);
    if (!adapterAudit.tomatodoPresent) {
      throw new Error(
        `TomaToDo section disappeared from settings: ${JSON.stringify(adapterAudit)}`,
      );
    }
    if (adapterAudit.forbiddenText.length > 0 || adapterAudit.forbiddenNodes.length > 0) {
      throw new Error(
        `Retired third-party task adapters are still visible: ${JSON.stringify(adapterAudit)}`,
      );
    }
    console.log('[ui] no third-party task adapter in settings:', JSON.stringify(adapterAudit));

    // TomaToDo 高级区的数据库路径输入框仍是等宽字体，用它验证 font-mono 真的解析。
    await mainWindow.webContents.executeJavaScript(`
      document.querySelector('.settings-tomatodo-advanced')?.setAttribute('open', '')
    `);
    await sleep(220);
    const monoFamily = await mainWindow.webContents.executeJavaScript(`(() => {
      const el =
        document.querySelector('.settings-tomatodo-advanced .font-mono') ??
        document.querySelector('.settings-page .font-mono');
      return el ? getComputedStyle(el).fontFamily : null;
    })()`);
    if (!monoFamily || !/mono/i.test(String(monoFamily))) {
      throw new Error(`Tailwind font-mono did not resolve: ${String(monoFamily)}`);
    }
    console.log('[ui] font-mono resolves to:', monoFamily);
    await mainWindow.webContents.executeJavaScript(`
      window.focuslink.settings.set({ taskSource: 'local', syncMode: 'local-only' })
    `);
    await sleep(320);
    const seededTasks = await mainWindow.webContents.executeJavaScript(`(async () => {
      const study = await window.focuslink.tasks.createProject('学习计划', '#2f6fed');
      const life = await window.focuslink.tasks.createProject('生活安排', '#c56a2d');
      const updatedStudy = await window.focuslink.tasks.updateProject(study.id, { color: '#7957c7' });
      await window.focuslink.tasks.create('整理高数错题', study.id);
      await window.focuslink.tasks.create('复习线性代数', study.id);
      await window.focuslink.tasks.create('给家里打电话', life.id);
      const captured = await window.focuslink.tasks.create('临时想到的事');
      const moved = await window.focuslink.tasks.moveTask(captured.id, life.id);
      await window.focuslink.tasks.create('等待归档的想法');
      return {
        study: study.id,
        life: life.id,
        color: updatedStudy.color,
        movedProjectId: moved.projectId,
      };
    })()`);
    if (
      !seededTasks?.study ||
      !seededTasks?.life ||
      seededTasks.color !== '#7957c7' ||
      seededTasks.movedProjectId !== seededTasks.life
    ) {
      throw new Error('Could not seed independent FocusLink task projects');
    }

    // ── 任务页真实锚点与关键控件 ──────────────────────────────
    // 旧门禁用的是已不存在的 `.task-workbench-*` 类名，子任务折叠永远 skipped，
    // 等于对任务页没有任何覆盖。这里改用真实类名，并钉住「勾选圆环必须有可见描边」——
    // 正是那个被 0-1-1 reset 通杀后静默消失的控件。
    mainWindow.webContents.send('navigate', 'tasks');
    await waitForSelector(mainWindow, '.task-workspace-root');
    await settle(mainWindow, 'tasks');
    const taskPage = await mainWindow.webContents.executeJavaScript(`(() => {
      const circle = document.querySelector('.task-check-circle');
      const style = circle ? getComputedStyle(circle) : null;
      return {
        rows: document.querySelectorAll('.task-entry').length,
        circles: document.querySelectorAll('.task-check-circle').length,
        borderWidth: style ? style.borderTopWidth : null,
        borderStyle: style ? style.borderTopStyle : null,
      };
    })()`);
    if (taskPage.rows < 1 || taskPage.circles < 1) {
      throw new Error(`Task page did not render task rows: ${JSON.stringify(taskPage)}`);
    }
    if (Number.parseFloat(String(taskPage.borderWidth)) <= 0 || taskPage.borderStyle === 'none') {
      throw new Error(`Task check circle lost its visible ring: ${JSON.stringify(taskPage)}`);
    }
    console.log('[ui] task page check circle ring:', JSON.stringify(taskPage));
    await capture('tasks-seeded', mainWindow);

    // ── 逐页截图（明 / 暗）+ 溢出检查 ────────────────────────
    for (const theme of ['light', 'dark'] as const) {
      await mainWindow.webContents.executeJavaScript(
        `window.focuslink.settings.set({ theme: ${JSON.stringify(theme)} })`,
      );
      await waitForSelector(mainWindow, `html.${theme}`);
      await sleep(300);
      for (const page of PAGES) {
        mainWindow.webContents.send('navigate', page.id);
        await waitForSelector(mainWindow, page.anchor);
        await settle(mainWindow, page.id);
        if (page.id === 'tasks') {
          await mainWindow.webContents.executeJavaScript(`(() => {
            const row = document.querySelector('.task-entry');
            if (row instanceof HTMLElement) row.click();
          })()`);
          await sleep(120);
        }
        if (page.id === 'history') {
          await mainWindow.webContents.executeJavaScript(`(() => {
            document.querySelector('[aria-label="回到今天"]')?.click();
          })()`);
          await sleep(150);
          await mainWindow.webContents.executeJavaScript(
            `document.querySelector('[aria-label="前一天"]')?.click()`,
          );
          let exactReadout = '';
          for (let attempt = 0; attempt < 40; attempt += 1) {
            exactReadout = await mainWindow.webContents.executeJavaScript(
              `document.querySelector('.stats-primary-readout strong')?.textContent ?? ''`,
            );
            if (exactReadout === '02:55:16') break;
            await sleep(100);
          }
          if (exactReadout !== '02:55:16')
            throw new Error(`Night-time dashboard readout is ${exactReadout}, expected 02:55:16`);
          // Snapshot the settled chart, not an arbitrary first frame of its decorative entrance.
          await mainWindow.webContents.executeJavaScript(`(() => {
            for (const element of document.querySelectorAll('.history-insights .hm-fade-in')) {
              for (const animation of element.getAnimations()) animation.finish();
            }
          })()`);
          const map = await mainWindow.webContents.executeJavaScript(`(() => ({
            readoutFont: Number.parseFloat(getComputedStyle(document.querySelector('.stats-primary-readout strong')).fontSize),
            ticks: document.querySelectorAll('.stats-day-map-axis > span').length,
            lanes: document.querySelectorAll('.stats-day-lane').length,
            periods: document.querySelectorAll('.stats-day-periods > span').length,
            laneTotals: document.querySelectorAll('.stats-day-lane-label > small').length,
            axisFontSize: Number.parseFloat(getComputedStyle(document.querySelector('.stats-day-map-axis > span')).fontSize),
            height: document.querySelector('.stats-day-map')?.getBoundingClientRect().height ?? 0,
            clientWidth: document.querySelector('.stats-day-map-scroll')?.clientWidth ?? 0,
            scrollWidth: document.querySelector('.stats-day-map-scroll')?.scrollWidth ?? 0,
          }))()`);
          if (
            map.readoutFont < 24 ||
            map.ticks !== 25 ||
            map.lanes !== 3 ||
            map.periods !== 5 ||
            map.laneTotals !== 3 ||
            map.axisFontSize < 10 ||
            map.height < 200 ||
            map.scrollWidth > map.clientWidth + 1
          ) {
            throw new Error(`Desktop 24-hour map contract failed: ${JSON.stringify(map)}`);
          }
        }
        await capture(`${theme}-${page.id}`, mainWindow);
        if (theme === 'light' && page.id === 'tasks') {
          // 清单颜色编辑器：右键清单行 → 「更换图标与颜色」→ .iconpop。
          // 旧门禁用的是已不存在的 `.task-project-edit`。
          const editorOpened = await mainWindow.webContents.executeJavaScript(`(() => {
            const row = [...document.querySelectorAll('.sidebar .side-item')].find((item) =>
              item.textContent?.includes('学习计划')
            );
            if (!(row instanceof HTMLElement)) return false;
            const rect = row.getBoundingClientRect();
            row.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: rect.left + 8,
                clientY: rect.top + 8,
              })
            );
            return true;
          })()`);
          if (!editorOpened)
            throw new Error('Desktop project row for the color editor is unavailable');
          await sleep(160);
          const pickerOpened = await mainWindow.webContents.executeJavaScript(`(() => {
            const item = [...document.querySelectorAll('.ctx-menu.active .ctx-menu-item')].find(
              (node) => node.textContent?.includes('更换图标与颜色')
            );
            if (!(item instanceof HTMLElement)) return false;
            item.click();
            return true;
          })()`);
          if (!pickerOpened) throw new Error('Desktop project color editor entry is unavailable');
          await sleep(160);
          const pickerVisible = await mainWindow.webContents.executeJavaScript(
            `Boolean(document.querySelector('.iconpop.active'))`,
          );
          if (!pickerVisible) throw new Error('Desktop project color editor did not open');
          await capture('light-task-project-editor', mainWindow);
        }
      }
    }

    await mainWindow.webContents.executeJavaScript(
      `window.focuslink.settings.set({ theme: 'light' })`,
    );
    await waitForSelector(mainWindow, 'html.light');
    mainWindow.setContentSize(980, 660);
    await sleep(320);
    for (const page of PAGES) {
      mainWindow.webContents.send('navigate', page.id);
      await waitForSelector(mainWindow, page.anchor);
      await settle(mainWindow, page.id);
      const overflow = await mainWindow.webContents.executeJavaScript(`(() => ({
        viewportWidth: window.innerWidth,
        scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
      }))()`);
      if (overflow.scrollWidth > overflow.viewportWidth + 1) {
        throw new Error(`Page "${page.label}" overflowed at 980x660: ${JSON.stringify(overflow)}`);
      }
      await capture(`min-${page.id}`, mainWindow);
    }

    console.log('[ui] all typography and layout assertions passed');
    timer.dispose();
    closeDatabase();
    app.exit(0);
  })
  .catch((error) => {
    console.error('[ui] failed', error);
    try {
      closeDatabase();
    } catch {
      // The database may not have opened yet.
    }
    app.exit(1);
  });

function waitForDidFinishLoad(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (win.webContents.isLoadingMainFrame()) {
      win.webContents.once('did-finish-load', () => resolve());
    } else {
      resolve();
    }
  });
}

function waitForSelector(win: BrowserWindow, selector: string, timeoutMs = 8000): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      if (win.isDestroyed()) {
        reject(new Error(`Window closed while waiting for selector: ${selector}`));
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
        reject(new Error(`Timed out waiting for selector ${selector}`));
        return;
      }
      setTimeout(() => void check(), 50);
    };
    void check();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 任务页要真的去跑一次 dida CLI，进程启动就要好几秒。固定 sleep 只会拍到骨架屏，
 * 看不出实际布局。这里等骨架消失，超时也不报错——本机没装 CLI 时停在读取中
 * 是正确行为，不该让视觉回归因此变红。
 */
async function settle(win: BrowserWindow, pageId: string): Promise<void> {
  if (pageId !== 'tasks') {
    await sleep(520);
    return;
  }
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const loading = await win.webContents.executeJavaScript(
      `Boolean(document.querySelector('.task-skeleton-list'))`,
    );
    if (!loading) break;
    await sleep(250);
  }
  await sleep(600);
}

async function capture(tag: string, win: BrowserWindow): Promise<void> {
  const shot = await win.capturePage();
  fs.writeFileSync(path.join(outputDir, `${tag}.png`), shot.toPNG());
  console.log(`[ui] captured ${tag}`);
}
