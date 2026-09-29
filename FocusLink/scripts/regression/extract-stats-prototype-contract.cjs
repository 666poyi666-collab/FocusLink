/* 统计页「原型 → 客户端」契约提取器
 *
 * 为什么存在（2026-09-29）：
 *   项目里同一个病反复发作 —— **原型改了、客户端只搬了一部分、然后被声明为完成**。
 *   v1.3.9 任务页 b50b858 宣称「1:1 完全对齐」被实测推翻；v1.3.12 统计页同样只搬了
 *   卡贴层，页面级结构（统计视图侧栏、清单分类、页头语义、96px 表盘）全都没落，
 *   而当时的验收只看「有没有写进代码」，不看「两侧是否一致」。
 *
 * 做法：把用户已确认的原型抽成一份**冻结契约**（结构选择器 + 关键计算值 + 文案 +
 *   原型文件 SHA256），写进 tests/fixtures/statsPrototypeContract.json；
 *   tests/statsStyleContract.test.ts 消费它。原型一变，SHA256 就对不上，
 *   测试会明确要求重新提取 —— 客户端不可能再「悄悄落后于原型」。
 *
 * 用法（在 FocusLink/ 下）：
 *   node scripts/regression/extract-stats-prototype-contract.cjs
 * 可用 FOCUSLINK_STATS_PROTOTYPE 覆盖原型路径。
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const PROTOTYPE =
  process.env.FOCUSLINK_STATS_PROTOTYPE ||
  'C:\\Users\\16408\\Desktop\\FocusLink-统计页-预览\\统计页原型.html';
const OUT = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'statsPrototypeContract.json');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
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

/* 契约要求的结构：这些选择器必须同时存在于原型与客户端 */
const REQUIRED_SELECTORS = [
  '.stats-dashboard-grid',
  '.dashboard-card-tile',
  '.card-widget',
  '.side-item',
  '.side-name',
  '.nav-num',
  '.nav-section',
  '.nav-section-title',
  '.project-dot',
  '.btn-tool',
  '.period-cap-card',
  '.period-cap-head',
  '.period-cap-val',
  '.task-rank-card',
  '.alloc-row-main',
  '.hm-day-lbl',
  '.bar-col',
  '.bar-track',
  '.dial-center-content',
  '.section-panel',
];

/* 契约要求的文案（用户已确认的界面语言） */
const REQUIRED_TEXTS = [
  '统计视图',
  '今日看板',
  '最近 7 天',
  '最近 30 天',
  '心流热力全景',
  '清单分类',
  '全部分类',
  '今日心流看板',
  '导出账本',
  '会话时间账本',
];

/* 冻结的计算值：容差 1px（原型侧 dsf=1 实测） */
const FROZEN_SELECTORS = [
  '.stats-dashboard-grid',
  '.dashboard-card-tile',
  '.card-widget',
  '.side-item',
  '.side-name',
  '.nav-num',
  '.btn-tool',
  '.dial-center-content',
  '.period-cap-card',
  '.period-cap-head',
  '.period-cap-val',
  '.task-rank-card',
  '.alloc-row-main',
  '.hm-day-lbl',
  '.bar-col',
  '.bar-track',
  '.section-panel',
];

const MEASURE = `(() => {
  const out = { found: {}, styles: {}, texts: [], viewport: { w: innerWidth, h: innerHeight } };
  for (const sel of ${JSON.stringify(REQUIRED_SELECTORS)}) {
    out.found[sel] = document.querySelectorAll(sel).length;
  }
  const cs = (el, prop) => getComputedStyle(el).getPropertyValue(prop);
  for (const sel of ${JSON.stringify(FROZEN_SELECTORS)}) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    out.styles[sel] = {
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
      bg: cs(el, 'background-color'),
      radius: cs(el, 'border-top-left-radius'),
      fontSize: cs(el, 'font-size'),
      fontWeight: cs(el, 'font-weight'),
    };
  }
  const seen = new Set();
  document.querySelectorAll('*').forEach((el) => {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    t = t.trim().replace(/\\s+/g, ' ');
    if (t && t.length <= 40 && !seen.has(t)) {
      seen.add(t);
      out.texts.push(t);
    }
  });
  return out;
})()`;

async function main() {
  if (!fs.existsSync(PROTOTYPE)) {
    console.error('[stats-contract] 找不到原型文件：' + PROTOTYPE);
    process.exit(1);
  }
  const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!edge) {
    console.error('[stats-contract] 找不到可用的 Chromium（Edge/Chrome）');
    process.exit(1);
  }

  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(PROTOTYPE)).digest('hex');
  const port = 9401 + (process.pid % 100);
  const profile = path.join(require('node:os').tmpdir(), 'fl-stats-contract-' + process.pid);

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

  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    try {
      const list = JSON.parse(await get(`http://127.0.0.1:${port}/json/list`));
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* 还没起来 */
    }
  }
  if (!wsUrl) {
    console.error('[stats-contract] 连不上无头浏览器');
    proc.kill();
    process.exit(1);
  }

  const c = await connect(wsUrl);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Page.navigate', { url: pathToFileURL(PROTOTYPE).href });
  await sleep(2500);
  await c.ev('(async()=>{await document.fonts.ready})()', true);
  await sleep(800);

  const measured = await c.ev(MEASURE);

  const missing = REQUIRED_SELECTORS.filter((s) => !measured.found[s]);
  const missingTexts = REQUIRED_TEXTS.filter((t) => !measured.texts.includes(t));
  if (missing.length || missingTexts.length) {
    const dbg = path.join(require('node:os').tmpdir(), 'fl-stats-contract-texts.txt');
    fs.writeFileSync(dbg, measured.texts.join('\n'), 'utf8');
    console.error('[stats-contract] 原型缺少契约要求的结构/文案，请先更新契约：');
    if (missing.length) console.error('  缺选择器: ' + missing.join(', '));
    if (missingTexts.length) console.error('  缺文案: ' + missingTexts.join(', '));
    console.error('  原型实际文案已导出到: ' + dbg);
    proc.kill();
    process.exit(1);
  }

  const contract = {
    _comment:
      '由 scripts/regression/extract-stats-prototype-contract.cjs 从用户已确认的统计页原型抽取。原型变更后必须重新运行该脚本，否则 tests/statsStyleContract.test.ts 会因 SHA256 不符而失败。',
    prototypeFile: path.basename(PROTOTYPE),
    prototypeSha256: sha256,
    capturedAt: new Date().toISOString().slice(0, 10),
    prototypeViewport: measured.viewport,
    requiredSelectors: REQUIRED_SELECTORS,
    requiredTexts: REQUIRED_TEXTS,
    frozenStyles: measured.styles,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(contract, null, 2) + '\n', 'utf8');

  console.log('[stats-contract] 契约已写入 ' + OUT);
  console.log('  原型 SHA256: ' + sha256);
  console.log('  结构选择器: ' + REQUIRED_SELECTORS.length + ' 个，全部命中');
  console.log('  文案: ' + REQUIRED_TEXTS.length + ' 条，全部命中');
  console.log('  冻结计算值: ' + Object.keys(measured.styles).length + ' 项');
  for (const [sel, v] of Object.entries(measured.styles)) {
    console.log(
      `    ${sel.padEnd(24)} ${v.w}x${v.h} bg=${v.bg} radius=${v.radius} ${v.fontSize}/${v.fontWeight}`,
    );
  }

  proc.kill();
  await sleep(300);
}

main().catch((e) => {
  console.error('[stats-contract] 失败', e);
  process.exit(1);
});
