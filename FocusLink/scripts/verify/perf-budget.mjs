#!/usr/bin/env node
/* 渲染预算门禁（v1.6.8，对应 FL-PERF-20261021-BUDGET）
 *
 * 为什么需要它：
 *   用户反复反馈「不够丝滑」，但仓库里没有任何延迟/内存/体积的阈值——
 *   desktop-performance-smoke.cjs 只记录 cachedTaskOpenMs 而不断言，
 *   INP、长任务、DOM 规模、安装包/asar 体积从未进过门禁，于是「丝滑」既不能证伪也不能回归。
 *   本脚本把这些变成可打分的数字（阈值来源见 TEST_AND_RELEASE.md 的「渲染预算门禁」一节）。
 *
 * 契约：
 *   ① 只读发布目录，不改、不写、不改名；拉起前把产物暂存到短 ASCII 路径
 *      （FL-INSTALL-016：同字节产物从本仓库长中文路径直接拉起必崩）。
 *   ② 静态预算：安装包 / 便携版 / app.asar / 运行时依赖数，不需要拉起应用。
 *   ③ 动态预算：冷启动到页面就绪、导航点击到下一帧、长任务(>50ms)、DOM 节点数、JS 堆。
 *   ④ 自己拉起的实例在 finally 里回收并回读 pid 已消失；只杀自己的进程树。
 *   ⑤ 清掉 ELECTRON_RUN_AS_NODE（继承它会让 Electron 退化成纯 Node）。
 *
 * 用法（FocusLink/ 下）：
 *   node scripts/verify/perf-budget.mjs            按阈值判定，超限退出码 1
 *   node scripts/verify/perf-budget.mjs --report   只报数字，不判定（用于标定阈值）
 *   node scripts/verify/perf-budget.mjs --dir ../release-v167
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/* 阈值：来源见 backend-design/TEST_AND_RELEASE.md「渲染预算门禁」。
 *
 * 两类数字必须分开，不要混为一谈：
 *   · 行业目标（尚未达标，作为债务记在文档里）：点击反馈 ≤100ms、INP p75 ≤200ms、0 个 >50ms 长任务。
 *   · 门禁棘轮（本脚本判定用）：当前实测基线 + 余量，作用只是「不许更差」。
 * 2026-10-21 v1.6.7 基线（冷启后立即测、未预热）：导航点击 p75 77–120ms、
 * 最慢一次导航（设置页）290–564ms、>50ms 长任务 2–3 个（最长 215–358ms）、DOM 1004–1610、JS 堆 7–8.4MB。
 * 2026-10-21 v1.6.8 复测（--detail 三轮中位）：任务首访 35/38ms、统计 66/132ms、设置 167/191ms、
 * 专注 35/51ms；三类再访 13–43ms；设置页最慢长任务 209 → 111–123ms。冷启动 1330–2603ms。
 *
 * 冷启动门槛只量 win-unpacked：它等于静默安装后的形态（%LOCALAPPDATA%\Programs\FocusLink）。
 * portable 版**不计入冷启动判定**——它每次拉起都要把约 120MB 自解包到临时目录，
 * 实测 6.5s / 16.1s / 15.6s 且随机器负载漂移，量的是解包器而不是界面手感；
 * 它的导航/长任务/DOM/堆仍然照判。*/
const BUDGET = {
  installerMB: 130, // 棘轮：当前 119.87（Electron 空白应用 158.8，Tauri 2.84）
  portableMB: 130, // 棘轮：当前 119.66
  appAsarMB: 40, // 棘轮：当前 31.41
  runtimeDeps: 5, // 棘轮：当前 3
  coldStartMs: 4000, // 棘轮：当前 1661–2296（目标 ≤1200）
  navClickP75Ms: 200, // 行业线（INP 良好）：当前 77–120，已达标
  navClickMaxMs: 700, // 棘轮：当前最慢 290–564（行业目标 ≤100，属债务）
  longTaskMs: 50, // 行业线：超此值即长任务
  maxLongTasks: 4, // 棘轮：当前 2–3（行业目标 0，属债务）
  domNodes: 4000, // 棘轮：当前 1004–1610
  heapUsedMB: 200, // 棘轮：当前 7–8.4
};

const PORT_MIN = 9400;
const PORT_MAX = 9900;
const args = process.argv.slice(2);
const reportOnly = args.includes('--report');
const detailMode = args.includes('--detail');
/* --style <页面名>：只点一次该页，用 CDP Performance 指标把这次切换拆成
 * 「脚本 / 样式重算 / 布局 / 其它」四块，回答「卡在 JS 还是在样式层」。
 * 页面名用导航按钮的 aria-label（专注/任务/统计/设置）。 */
const styleIdx = args.indexOf('--style');
const stylePage = styleIdx >= 0 ? args[styleIdx + 1] : null;
/* --probe <js 表达式>：在页内求值并打印 JSON。
 * 用来量真实尺寸/计算样式/字体装载情况，避免按经验猜 contain-intrinsic-size。 */
const probeIdx = args.indexOf('--probe');
const probeExpr = probeIdx >= 0 ? args[probeIdx + 1] : null;
const dirArg = args.indexOf('--dir') >= 0 ? args[args.indexOf('--dir') + 1] : null;

function out(line) {
  process.stdout.write(line + '\n');
}
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function newestReleaseDir() {
  if (dirArg) return path.resolve(ROOT, dirArg);
  const parent = path.dirname(ROOT);
  const dirs = fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^release-v\d+$/.test(e.name))
    .map((e) => path.join(parent, e.name))
    .sort();
  return dirs.length ? dirs[dirs.length - 1] : null;
}

function findTargets(dir) {
  const exeArg = args.indexOf('--exe') >= 0 ? args[args.indexOf('--exe') + 1] : null;
  if (exeArg) {
    const exe = path.resolve(ROOT, exeArg);
    return [{ kind: 'exe', exe, dir: path.dirname(exe) }];
  }
  const targets = [];
  const unpacked = path.join(dir, 'win-unpacked', 'FocusLink.exe');
  if (fs.existsSync(unpacked))
    targets.push({ kind: 'unpacked', exe: unpacked, dir: path.dirname(unpacked) });
  const files = fs.readdirSync(dir);
  const portable = files.find((f) => /-portable\.exe$/.test(f));
  if (portable) targets.push({ kind: 'portable', exe: path.join(dir, portable), dir: null });
  return targets;
}

function staticBudgets(dir, problems) {
  const stats = [];
  const files = fs.readdirSync(dir);
  const installer = files.find((f) => /-x64\.exe$/.test(f) && !/-portable\.exe$/.test(f));
  const portable = files.find((f) => /-portable\.exe$/.test(f));
  const asar = path.join(dir, 'win-unpacked', 'resources', 'app.asar');
  const mb = (p) => Math.round((fs.statSync(p).size / 1048576) * 100) / 100;

  if (installer)
    stats.push({
      name: '安装包',
      value: mb(path.join(dir, installer)),
      unit: 'MB',
      limit: BUDGET.installerMB,
    });
  if (portable)
    stats.push({
      name: '便携版',
      value: mb(path.join(dir, portable)),
      unit: 'MB',
      limit: BUDGET.portableMB,
    });
  if (fs.existsSync(asar))
    stats.push({ name: 'app.asar', value: mb(asar), unit: 'MB', limit: BUDGET.appAsarMB });

  let deps = [];
  try {
    const raw = execFileSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['ls', '--omit=dev', '--depth=0', '--parseable'],
      { cwd: ROOT, encoding: 'utf8', windowsHide: true },
    );
    deps = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((p) => path.basename(p))
      .filter((n) => n && n !== 'focuslink' && !n.startsWith('extraneous'));
  } catch {
    // 受限 shell 里 npm ls 可能因 pipe 限制失败；真正要守的是「electron-builder 会把
    // dependencies 打进 asar」这条口径，退回读 package.json 的 dependencies 等价。
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
      deps = Object.keys(pkg.dependencies || {});
    } catch (error) {
      problems.push(
        '无法读取运行时依赖清单：' + (error instanceof Error ? error.message : String(error)),
      );
    }
  }
  stats.push({ name: '运行时依赖', value: deps.length, unit: '个', limit: BUDGET.runtimeDeps });

  for (const s of stats) {
    if (s.value > s.limit)
      problems.push(s.name + ' ' + s.value + s.unit + ' 超过预算 ' + s.limit + s.unit);
  }
  return stats;
}

function stageArtifact(exe) {
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-budget-'));
  const exeDir = path.dirname(exe);
  if (fs.existsSync(path.join(exeDir, 'resources'))) {
    const dest = path.join(stageRoot, path.basename(exeDir));
    fs.cpSync(exeDir, dest, { recursive: true });
    return { exe: path.join(dest, path.basename(exe)), dir: dest, root: stageRoot };
  }
  const dest = path.join(stageRoot, path.basename(exe));
  fs.copyFileSync(exe, dest);
  return { exe: dest, dir: stageRoot, root: stageRoot };
}

async function waitForPage(port, liveness, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const live = liveness();
    if (live.exit) return { exit: live.exit };
    if (live.spawnError) return { spawnError: live.spawnError };
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list');
      const targets = await res.json();
      const page = targets.find(
        (t) =>
          t.type === 'page' &&
          !String(t.url).includes('mini.html') &&
          !String(t.url).startsWith('devtools://'),
      );
      if (page && page.webSocketDebuggerUrl) return { page };
    } catch {
      /* 还没起来 */
    }
    await delay(120);
  }
  return { timedOut: true };
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params: params || {} }));
    });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result ? response.result.value : undefined;
  };
  return { send, evaluate, close: () => socket.close() };
}

const MEASURE_EXPR = `(async () => {
  const longTasks = [];
  let observer = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration));
    });
    observer.observe({ type: 'longtask', buffered: false });
  } catch (error) {
    /* 旧内核没有 longtask，留空数组 */
  }
  const buttons = [...document.querySelectorAll('.edge-dock-button')];
  const nav = [];
  for (const button of buttons) {
    const started = performance.now();
    button.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    nav.push(Math.round(performance.now() - started));
    await new Promise((resolve) => setTimeout(resolve, 240));
  }
  if (observer) observer.disconnect();
  return {
    nav,
    longTasks,
    domNodes: document.getElementsByTagName('*').length,
    buttonCount: buttons.length,
  };
})()`;

/* 逐页明细（--detail）：`MEASURE_EXPR` 只报总体 p75/最慢值，无法回答
 * 「哪一页顿、顿在哪」以及「是首次挂载贵还是每次切换都贵」。
 * 这里在**刚冷启动**的实例上按 任务→统计→设置→专注 连点三轮：
 *   · round 0 = 每页首次挂载；round 1/2 = 再次访问（命中模块缓存）。
 *   · frameMs  = 点击到两帧后（视觉响应）
 *   · settledMs= 点击到主线程真正空下来（含同步挂载 + 淡入动画）。
 *   · skeleton = 该页首帧就出现骨架占位时记 true（任务页 IPC 加载）。
 * 首次与再次的差值就是「页面挂载成本」，这决定了要不要做保活(mount-once)策略。*/
const DETAIL_EXPR = `(async () => {
  const longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        longTasks.push({ start: entry.startTime, dur: Math.round(entry.duration) });
    }).observe({ type: 'longtask', buffered: false });
  } catch (error) {
    /* 旧内核没有 longtask */
  }
  const buttons = [...document.querySelectorAll('.edge-dock-button')];
  const byLabel = new Map(
    buttons.map((b) => [b.getAttribute('aria-label') || (b.textContent || '').trim(), b]),
  );
  const order = ['任务', '统计', '设置', '专注'];
  const idle = () =>
    new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      try {
        requestIdleCallback(finish, { timeout: 1200 });
      } catch (error) {
        setTimeout(finish, 60);
      }
    });
  const rows = [];
  for (let round = 0; round < 3; round++) {
    for (const label of order) {
      const button = byLabel.get(label);
      if (!button) continue;
      const from = longTasks.length;
      const started = performance.now();
      button.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const frameMs = Math.round(performance.now() - started);
      const skeleton = !!document.querySelector('.task-loading-list');
      await idle();
      const settledMs = Math.round(performance.now() - started);
      rows.push({
        round,
        label,
        frameMs,
        settledMs,
        skeleton,
        longTasks: longTasks.slice(from).map((entry) => entry.dur),
        dom: document.getElementsByTagName('*').length,
      });
      await new Promise((resolve) => setTimeout(resolve, 140));
    }
  }
  return rows;
})()`;

function styleExpr(label) {
  return (
    '(async () => {' +
    'const target = ' +
    JSON.stringify(label) +
    ';' +
    'const buttons = [...document.querySelectorAll(".edge-dock-button")];' +
    'const button = buttons.find((b) => (b.getAttribute("aria-label") || "") === target);' +
    'if (!button) return { clicked: false, available: buttons.map((b) => b.getAttribute("aria-label")) };' +
    'const idle = () => new Promise((resolve) => {' +
    '  let done = false;' +
    '  const finish = () => { if (done) return; done = true; resolve(); };' +
    '  try { requestIdleCallback(finish, { timeout: 1200 }); } catch (error) { setTimeout(finish, 60); }' +
    '});' +
    'const started = performance.now();' +
    'button.click();' +
    'await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));' +
    'const frameMs = Math.round(performance.now() - started);' +
    'await idle();' +
    'return { clicked: true, frameMs, settledMs: Math.round(performance.now() - started) };' +
    '})()'
  );
}

function metricMap(entries) {
  const map = {};
  for (const entry of entries || []) map[entry.name] = entry.value;
  return map;
}

function p75(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 0.75)];
}

function processTreeGone(rootPid) {
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-Process -Id ' + rootPid + ' -ErrorAction SilentlyContinue | Out-Null',
      ],
      {
        windowsHide: true,
      },
    );
    return false;
  } catch {
    return true;
  }
}

async function measureTarget(target, problems) {
  const staged = stageArtifact(target.exe);
  const port = PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-budget-ud-'));
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  let child = null;
  let cdp = null;
  const metrics = { kind: target.kind };

  try {
    const spawnAt = Date.now();
    child = spawn(
      staged.exe,
      ['--remote-debugging-port=' + port, '--user-data-dir=' + userDataDir, '--hidden'],
      { stdio: 'ignore', windowsHide: true, env: childEnv, cwd: staged.dir },
    );
    let exitState = null;
    let spawnError = null;
    child.on('exit', (code, signal) => (exitState = { code, signal }));
    child.on('error', (error) => (spawnError = error));

    const found = await waitForPage(port, () => ({ exit: exitState, spawnError }), 45000);
    if (found.spawnError || found.exit || found.timedOut) {
      problems.push(target.kind + ' 启动失败（无法进入测量): ' + JSON.stringify(found));
      return metrics;
    }
    metrics.coldStartMs = Date.now() - spawnAt;
    cdp = await connectCdp(found.page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    try {
      await cdp.evaluate(
        'window.focuslink && window.focuslink.window.show && window.focuslink.window.show()',
      );
    } catch {
      /* 外壳断言另有人管 */
    }
    // 明细模式也要让启动期的后台活（字体、IPC 水化）先跑完，
    // 否则「首次访问某页」测得的是启动债，不是该页的挂载成本。
    await delay(detailMode || stylePage || probeExpr ? 3000 : 2000);
    if (probeExpr) {
      const probeCode = probeExpr.startsWith('@')
        ? fs.readFileSync(path.resolve(ROOT, probeExpr.slice(1)), 'utf8')
        : probeExpr;
      await cdp.evaluate(
        '(async () => { const b = [...document.querySelectorAll(".edge-dock-button")].find((x) => (x.getAttribute("aria-label") || "") === ' +
          JSON.stringify(process.env.FL_PROBE_PAGE || '') +
          '); if (b) b.click(); await new Promise((r) => setTimeout(r, 1200)); })()',
      );
      metrics.probe = await cdp.evaluate(probeCode);
      metrics.nav = [];
      metrics.longTasks = [];
      metrics.domNodes = 0;
    } else if (stylePage) {
      // 单页拆解：脚本 / 样式重算 / 布局各占多少毫秒。
      await cdp.send('Performance.enable');
      const before = metricMap((await cdp.send('Performance.getMetrics')).metrics);
      const click = await cdp.evaluate(styleExpr(stylePage));
      await delay(250);
      const after = metricMap((await cdp.send('Performance.getMetrics')).metrics);
      const delta = (key) => Math.round(((after[key] || 0) - (before[key] || 0)) * 1000 * 10) / 10;
      const count = (key) => Math.round((after[key] || 0) - (before[key] || 0));
      metrics.style = {
        page: stylePage,
        click,
        taskMs: delta('TaskDuration'),
        scriptMs: delta('ScriptDuration'),
        styleMs: delta('RecalcStyleDuration'),
        layoutMs: delta('LayoutDuration'),
        styleCount: count('RecalcStyleCount'),
        layoutCount: count('LayoutCount'),
      };
      metrics.nav = [click.frameMs || 0];
      metrics.navP75 = click.frameMs || 0;
      metrics.navMax = click.frameMs || 0;
      metrics.longTasks = [];
      metrics.domNodes = 0;
    } else if (detailMode) {
      // 明细模式必须在「还没访问过任何页面」的实例上跑，否则首次挂载成本被提前吃掉。
      metrics.detail = await cdp.evaluate(DETAIL_EXPR);
      metrics.nav = metrics.detail.map((row) => row.frameMs);
      metrics.navP75 = p75(metrics.nav);
      metrics.navMax = metrics.nav.length ? Math.max(...metrics.nav) : 0;
      metrics.longTasks = metrics.detail.flatMap((row) => row.longTasks);
      metrics.domNodes = metrics.detail.length ? metrics.detail[metrics.detail.length - 1].dom : 0;
    } else {
      const measured = await cdp.evaluate(MEASURE_EXPR);
      metrics.nav = measured.nav || [];
      metrics.navP75 = p75(metrics.nav);
      metrics.navMax = metrics.nav.length ? Math.max(...metrics.nav) : 0;
      metrics.longTasks = measured.longTasks || [];
      metrics.domNodes = measured.domNodes || 0;
    }
    try {
      const heap = await cdp.send('Runtime.getHeapUsage');
      metrics.heapUsedMB = Math.round((heap.usedSize / 1048576) * 10) / 10;
    } catch {
      metrics.heapUsedMB = null;
    }
  } catch (error) {
    problems.push(
      target.kind + ' 测量异常：' + (error instanceof Error ? error.message : String(error)),
    );
  } finally {
    if (cdp) {
      try {
        cdp.close();
      } catch {
        /* ignore */
      }
    }
    if (child && child.pid) {
      try {
        execFileSync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            'Stop-Process -Id ' + child.pid + ' -Force -ErrorAction SilentlyContinue',
          ],
          {
            windowsHide: true,
          },
        );
      } catch {
        /* ignore */
      }
      await delay(500);
      if (!processTreeGone(child.pid))
        problems.push(target.kind + ' 实例回收失败（pid ' + child.pid + ' 仍在）');
    }
    for (const p of [staged.root, userDataDir]) {
      try {
        fs.rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
      } catch {
        /* ignore */
      }
    }
  }
  return metrics;
}

function assertMetrics(metrics, problems, kind) {
  if (!metrics.coldStartMs) return;
  if (kind !== 'portable' && metrics.coldStartMs > BUDGET.coldStartMs) {
    problems.push('冷启动 ' + metrics.coldStartMs + 'ms 超过预算 ' + BUDGET.coldStartMs + 'ms');
  }
  if (metrics.navP75 > BUDGET.navClickP75Ms) {
    problems.push('导航点击 p75 ' + metrics.navP75 + 'ms 超过预算 ' + BUDGET.navClickP75Ms + 'ms');
  }
  if (metrics.navMax > BUDGET.navClickMaxMs) {
    problems.push(
      '最慢一次导航点击 ' + metrics.navMax + 'ms 超过预算 ' + BUDGET.navClickMaxMs + 'ms',
    );
  }
  const slow = metrics.longTasks.filter((d) => d > BUDGET.longTaskMs);
  if (slow.length > BUDGET.maxLongTasks) {
    problems.push(
      '长任务 >' +
        BUDGET.longTaskMs +
        'ms 共 ' +
        slow.length +
        ' 个，超过预算 ' +
        BUDGET.maxLongTasks +
        ' 个',
    );
  }
  if (metrics.domNodes > BUDGET.domNodes) {
    problems.push('DOM 节点 ' + metrics.domNodes + ' 超过预算 ' + BUDGET.domNodes);
  }
  if (metrics.heapUsedMB !== null && metrics.heapUsedMB > BUDGET.heapUsedMB) {
    problems.push('JS 堆 ' + metrics.heapUsedMB + 'MB 超过预算 ' + BUDGET.heapUsedMB + 'MB');
  }
}

async function main() {
  const dir = newestReleaseDir();
  if (!dir || !fs.existsSync(dir)) {
    out('[perf-budget] 找不到 release-v* 发布目录：' + String(dir));
    process.exit(1);
  }
  out('[perf-budget] 发布目录：' + dir);
  const problems = [];
  const staticStats = staticBudgets(dir, problems);
  for (const s of staticStats)
    out('  · ' + s.name + ' = ' + s.value + s.unit + '（预算 ' + s.limit + s.unit + '）');

  const targets = findTargets(dir);
  if (!targets.length) {
    out('[perf-budget] 发布目录里没有可测量的产物（win-unpacked / portable）');
    process.exit(1);
  }

  let measuredCount = 0;
  for (const target of targets) {
    const metrics = await measureTarget(target, problems);
    if (!metrics.coldStartMs) continue;
    measuredCount += 1;
    out(
      '  · ' +
        target.kind +
        '：冷启动 ' +
        metrics.coldStartMs +
        'ms｜导航点击 ' +
        JSON.stringify(metrics.nav) +
        '（p75 ' +
        metrics.navP75 +
        'ms，最慢 ' +
        metrics.navMax +
        'ms）｜长任务 >50ms ' +
        metrics.longTasks.filter((d) => d > BUDGET.longTaskMs).length +
        ' 个（最长 ' +
        (metrics.longTasks.length ? Math.max(...metrics.longTasks) : 0) +
        'ms）｜DOM ' +
        metrics.domNodes +
        ' 节点｜JS 堆 ' +
        metrics.heapUsedMB +
        'MB',
    );
    if (detailMode && metrics.detail) {
      out('    页面 | 轮次 | 点击→两帧 | 点击→主线程空闲 | 骨架 | 长任务 | DOM');
      for (const row of metrics.detail) {
        out(
          '    ' +
            row.label +
            ' | ' +
            (row.round === 0 ? '首访' : '再访' + row.round) +
            ' | ' +
            row.frameMs +
            'ms | ' +
            row.settledMs +
            'ms | ' +
            (row.skeleton ? '有' : '无') +
            ' | ' +
            (row.longTasks.length ? row.longTasks.join('+') + 'ms' : '0') +
            ' | ' +
            row.dom,
        );
      }
    }
    if (probeExpr) {
      out('    probe = ' + JSON.stringify(metrics.probe, null, 1));
    }
    if (stylePage && metrics.style) {
      const s = metrics.style;
      if (!s.click.clicked) {
        out('    未找到导航按钮，可用：' + JSON.stringify(s.click.available));
      } else {
        out(
          '    单页拆解 ' +
            s.page +
            '：点击→两帧 ' +
            s.click.frameMs +
            'ms｜点击→空闲 ' +
            s.click.settledMs +
            'ms',
        );
        out(
          '    主线程任务总时长 ' +
            s.taskMs +
            'ms = 脚本 ' +
            s.scriptMs +
            'ms + 样式重算 ' +
            s.styleMs +
            'ms（' +
            s.styleCount +
            ' 次）+ 布局 ' +
            s.layoutMs +
            'ms（' +
            s.layoutCount +
            ' 次）+ 其它 ' +
            Math.round((s.taskMs - s.scriptMs - s.styleMs - s.layoutMs) * 10) / 10 +
            'ms',
        );
      }
    }
    if (target.kind === 'portable') {
      out(
        '    注：portable 冷启动 ' +
          metrics.coldStartMs +
          'ms 不计入预算——每次拉起都要把约 120MB 自解包到临时目录，量的是解包器不是界面；其余项照判。',
      );
    }
    if (!reportOnly && !stylePage) assertMetrics(metrics, problems, target.kind);
  }
  if (!measuredCount) {
    out('[perf-budget] 没有任何产物完成测量');
    process.exit(1);
  }

  if (problems.length) {
    out('[perf-budget] FAIL：' + problems.length + ' 项超预算');
    for (const p of problems) out('  - ' + p);
    process.exit(1);
  }
  out(
    '[perf-budget] PASS：' + (reportOnly ? '仅报告（未判定阈值）' : '静态与动态预算全部在范围内'),
  );
  process.exit(0);
}

main().catch((error) => {
  out(
    '[perf-budget] 崩溃：' +
      (error instanceof Error ? error.stack || error.message : String(error)),
  );
  process.exit(1);
});
