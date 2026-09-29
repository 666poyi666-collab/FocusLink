/* 统计页「原型 ↔ 客户端」运行时数值对比
 *
 * 与 tests/statsStyleContract.test.ts 的分工：
 *   · 那个是**源码级**闸门（结构选择器 / 界面文案 / 原型指纹），跑在 `npm test` 里，快、稳。
 *   · 这个脚本是**运行时实测**闸门：两侧都用真实渲染后的 getComputedStyle /
 *     getBoundingClientRect 量同一批选择器，逐项并列打印差异。像素值会被 token 与
 *     父容器影响，只有实测才可信（源码级字面量断言极易假阴性）。
 *
 * 为什么需要它（2026-09-29）：
 *   v1.3.12 只把卡贴层搬进客户端，页面级结构（统计视图侧栏、清单分类、页头语义、
 *   96px 表盘）全都没落，而当时的验收只看「有没有写进代码」。这个脚本让「两侧不一致」
 *   变成一条会红的命令，而不是靠人眼。
 *
 * 用法（在 FocusLink/ 下）：
 *   node scripts/regression/stats-prototype-parity.cjs
 * 环境变量：
 *   FOCUSLINK_STATS_PROTOTYPE  原型路径（默认用户桌面的统计页原型）
 *   FOCUSLINK_CLIENT_EXE       客户端可执行文件（默认已安装的 FocusLink.exe）
 *   FOCUSLINK_PARITY_TOLERANCE 允许的像素误差，默认 1.5
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const PROTOTYPE =
  process.env.FOCUSLINK_STATS_PROTOTYPE ||
  'C:\\Users\\16408\\Desktop\\FocusLink-统计页-预览\\统计页原型.html';
const CLIENT_EXE =
  process.env.FOCUSLINK_CLIENT_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'FocusLink', 'FocusLink.exe');
const TOLERANCE = Number(process.env.FOCUSLINK_PARITY_TOLERANCE || 1.5);
const REAL_PROFILE = path.join(process.env.APPDATA || '', 'focuslink');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

/* 对比同一批选择器。
 *
 * **只有「尺寸由 CSS 决定、与内容/容器无关」的元素才能跨侧严格比较。**
 * 网格子项（卡贴、面板、排行卡…）的宽高由容器宽度与真实数据决定 ——
 * 客户端窗口 1240px、原型画布 1570px，且客户端右侧还有账本列，
 * 这类元素的 Δ 是环境差异不是缺陷。把它们标成 `fixed: false` 只做信息展示，
 * 避免假阳性把闸门淹掉（这与 v1.3.9 那次「实测差异表」被误读是同类风险）。 */
const SELECTORS = [
  { sel: '.dashboard-card-tile', fixedW: false, fixedH: false },
  { sel: '.card-widget', fixedW: false, fixedH: false },
  { sel: '.section-panel', fixedW: false, fixedH: false },
  { sel: '.task-rank-card', fixedW: false, fixedH: false },
  { sel: '.alloc-row-main', fixedW: false, fixedH: false },
  { sel: '.period-cap-card', fixedW: false, fixedH: false },
  { sel: '.period-cap-head', fixedW: false, fixedH: false },
  { sel: '.period-cap-val', fixedW: false, fixedH: false },
  { sel: '.dial-center-content', fixedW: true, fixedH: true },
  { sel: '.side-item', fixedW: true, fixedH: true },
  /* nav-num 是文本元素：宽度由内容（"4.6h" vs "39.4h"）决定，不可跨侧比宽度；
     高度由行高决定，可以比。 */
  { sel: '.nav-num', fixedW: false, fixedH: true },
  { sel: '.nav-section-title', fixedW: true, fixedH: false },
  { sel: '.hm-day-lbl', fixedW: true, fixedH: true },
  /* 轨道宽度由 CSS 固定，高度由图表容器决定 → 只判宽度。 */
  { sel: '.bar-track', fixedW: true, fixedH: false },
  { sel: '.btn-tool', fixedW: true, fixedH: true },
];

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const get = (u) =>
  new Promise((res, rej) => {
    http
      .get(u, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => res(d));
      })
      .on('error', rej);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const wait = new Map();
  ws.onmessage = (m) => {
    const g = JSON.parse(m.data);
    if (g.id && wait.has(g.id)) {
      const { r, j } = wait.get(g.id);
      wait.delete(g.id);
      g.error ? j(new Error(JSON.stringify(g.error))) : r(g.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r, j) => {
      const i = ++id;
      wait.set(i, { r, j });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => {
        if (wait.has(i)) {
          wait.delete(i);
          j(new Error('timeout ' + method));
        }
      }, 30000);
    });
  const ev = async (e, aw = false) => {
    const r = await send('Runtime.evaluate', {
      expression: e,
      awaitPromise: aw,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description));
    return r.result.value;
  };
  return { send, ev };
}

function measureExpr() {
  return `(function(){
    var out={};
    ${JSON.stringify(SELECTORS.map((s) => s.sel))}.forEach(function(sel){
      var el=document.querySelector(sel);
      if(!el){ out[sel]=null; return; }
      var cs=getComputedStyle(el), r=el.getBoundingClientRect();
      out[sel]={ w:+r.width.toFixed(1), h:+r.height.toFixed(1),
        bg:cs.backgroundColor, radius:cs.borderTopLeftRadius,
        fontSize:cs.fontSize, fontWeight:cs.fontWeight };
    });
    return out;
  })()`;
}

async function waitForTarget(port, predicate, tries = 60) {
  for (let i = 0; i < tries; i++) {
    await sleep(500);
    try {
      const list = JSON.parse(await get(`http://127.0.0.1:${port}/json/list`));
      const t = list.find(predicate);
      if (t && t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
  }
  return null;
}

async function measurePrototype(port) {
  const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!edge) throw new Error('找不到 Chromium（Edge/Chrome）');
  const profile = path.join(os.tmpdir(), 'fl-parity-proto-' + process.pid);
  const proc = spawn(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + profile,
      '--window-size=1600,1100',
      '--force-device-scale-factor=1',
      '--allow-file-access-from-files',
      'about:blank',
    ],
    { env, stdio: 'ignore' },
  );
  const ws = await waitForTarget(port, (t) => t.type === 'page');
  if (!ws) throw new Error('原型侧连不上无头浏览器');
  const c = await connect(ws);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Page.navigate', { url: pathToFileURL(PROTOTYPE).href });
  await sleep(2500);
  await c.ev('(async()=>{await document.fonts.ready})()', true);
  await sleep(800);
  const data = await c.ev(measureExpr());
  const png = await c.send('Page.captureScreenshot', { format: 'png' });
  const shot = Buffer.from(png.data, 'base64');
  proc.kill();
  return { data, proc, shot };
}

async function measureClient(port) {
  if (!fs.existsSync(CLIENT_EXE)) throw new Error('找不到客户端可执行文件：' + CLIENT_EXE);
  const profile = path.join(os.tmpdir(), 'fl-parity-client-' + process.pid);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  /* 必须复制真实库：隔离 profile 默认空库会走空态分支，量到的不是完整界面。 */
  for (const f of ['focuslink.db', 'focuslink.db-wal', 'focuslink.db-shm']) {
    const from = path.join(REAL_PROFILE, f);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(profile, f));
  }
  const proc = spawn(
    CLIENT_EXE,
    [
      '--user-data-dir=' + profile,
      '--remote-debugging-port=' + port,
      '--force-device-scale-factor=1',
      '--window-size=1600,1100',
    ],
    { env, stdio: 'ignore', detached: true },
  );
  const ws = await waitForTarget(port, (t) => t.type === 'page' && /index\.html/.test(t.url));
  if (!ws) throw new Error('客户端侧连不上 renderer');
  const c = await connect(ws);
  await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(3000);
  await c.ev('(async()=>{await document.fonts.ready})()', true);

  const clicked = await c.ev(`(function(){
    var b=[...document.querySelectorAll('button')].find(function(x){return (x.textContent||'').trim()==='统计';});
    if(!b) return 'no-stats-button'; b.click(); return 'clicked';
  })()`);
  await sleep(2500);
  /* 今天可能 0 条记录 → 空态。退一天拿到有数据的完整界面。 */
  const back = await c.ev(`(function(){
    var b=[...document.querySelectorAll('button')].find(function(x){
      return (x.getAttribute('aria-label')||'').indexOf('前一天')>=0 || (x.textContent||'').trim()==='‹';});
    if(!b) return 'no-prev-button'; b.click(); return 'clicked';
  })()`);
  await sleep(3000);

  const data = await c.ev(measureExpr());
  const shots = {};
  const png = await c.send('Page.captureScreenshot', { format: 'png' });
  shots.client = Buffer.from(png.data, 'base64');
  try {
    process.kill(-proc.pid);
  } catch {
    /* ignore */
  }
  try {
    proc.kill();
  } catch {
    /* ignore */
  }
  return { data, clicked, back, shots };
}

function fmt(v) {
  return v ? `${v.w}x${v.h}` : '(缺失)';
}

async function main() {
  console.log('[stats-parity] 原型: ' + PROTOTYPE);
  console.log('[stats-parity] 客户端: ' + CLIENT_EXE);
  console.log('[stats-parity] 容差: ' + TOLERANCE + 'px\n');

  const proto = await measurePrototype(9501 + (process.pid % 50));
  const client = await measureClient(9601 + (process.pid % 50));

  console.log('客户端操作：点统计=' + client.clicked + '，退一天=' + client.back + '\n');

  const rows = [];
  let hardFail = 0;
  let infoDiff = 0;
  for (const { sel, fixedW, fixedH } of SELECTORS) {
    const p = proto.data[sel];
    const c = client.data[sel];
    const status = !p && !c ? 'both-missing' : !p ? 'proto-missing' : !c ? 'CLIENT-MISSING' : 'ok';
    const isFixed = fixedW || fixedH;
    let dw = null;
    let dh = null;
    let verdict = isFixed ? '' : 'INFO';
    if (p && c) {
      dw = +(c.w - p.w).toFixed(1);
      dh = +(c.h - p.h).toFixed(1);
      const bad = (fixedW && Math.abs(dw) > TOLERANCE) || (fixedH && Math.abs(dh) > TOLERANCE);
      if (isFixed && bad) {
        verdict = 'DIFF';
        hardFail++;
      } else if (!isFixed && (Math.abs(dw) > TOLERANCE || Math.abs(dh) > TOLERANCE)) {
        verdict = 'info-diff';
        infoDiff++;
      } else {
        verdict = isFixed ? 'ok' : 'INFO';
      }
    } else if (status === 'CLIENT-MISSING') {
      verdict = 'MISSING';
      hardFail++;
    }
    rows.push({ sel, fixedW, fixedH, proto: fmt(p), client: fmt(c), dw, dh, verdict, status });
  }

  console.log(
    '选择器'.padEnd(26) +
      '原型'.padEnd(16) +
      '客户端'.padEnd(16) +
      'Δw'.padEnd(8) +
      'Δh'.padEnd(8) +
      '判定',
  );
  console.log('-'.repeat(90));
  for (const r of rows) {
    console.log(
      r.sel.padEnd(26) +
        r.proto.padEnd(16) +
        r.client.padEnd(16) +
        String(r.dw ?? '-').padEnd(8) +
        String(r.dh ?? '-').padEnd(8) +
        r.verdict,
    );
  }

  const outDir = path.join(__dirname, '..', '..', '.tmp', 'stats-parity');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'client-stats.png'), client.shots.client);
  if (proto.shot) fs.writeFileSync(path.join(outDir, 'prototype-stats.png'), proto.shot);
  fs.writeFileSync(
    path.join(outDir, 'parity.json'),
    JSON.stringify({ prototype: proto.data, client: client.data, rows }, null, 2),
    'utf8',
  );

  console.log('\n客户端截图: ' + path.join(outDir, 'client-stats.png'));
  console.log('明细 JSON : ' + path.join(outDir, 'parity.json'));
  console.log(
    '\n说明：只有「尺寸由 CSS 决定」的元素（fixed）参与判定；' +
      '网格子项的 Δ 由窗口宽度与真实数据造成，仅作信息展示。',
  );
  if (infoDiff > 0) {
    console.log('  信息项（非缺陷）差异：' + infoDiff + ' 项');
  }
  if (hardFail > 0) {
    console.error('\n[stats-parity] 失败：' + hardFail + ' 项固定尺寸元素与原型不一致或缺失。');
    process.exit(1);
  }
  console.log('\n[stats-parity] 通过：固定尺寸元素与原型一致（容差 ' + TOLERANCE + 'px）。');
}

main().catch((e) => {
  console.error('[stats-parity] 出错', e);
  process.exit(1);
});
