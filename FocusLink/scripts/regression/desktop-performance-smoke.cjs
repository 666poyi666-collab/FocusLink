// Headless renderer regression against the real built App and MiniWindow.
// Synthetic IPC only: no installed application, native input, credentials or user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-performance-'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fixture = `
import { DEFAULT_SETTINGS } from './shared/types';
import { buildSessionAnalytics } from './shared/sessionAnalytics';
import { MINI_WINDOW_COLLAPSED_SIZE, MINI_WINDOW_EXPANDED_SIZE } from './shared/miniWindowLayout';
const listeners = new Map();
const emit = (channel, value) => [...(listeners.get(channel) || [])].forEach(fn => fn(value));
let settings = {...DEFAULT_SETTINGS, theme:'dark', miniWindow:{...DEFAULT_SETTINGS.miniWindow, collapsed:false}};
const now = Date.now();
let snapshot = {state:location.pathname.includes('mini.html')?'paused':'idle',sessionId:'fixture-session',currentSegmentId:'fixture-segment',currentTaskId:'task-0',currentTaskTitle:'本地缓存任务0',currentTaskSource:'local',sessionDefaultTaskId:'task-0',sessionDefaultTaskTitle:'本地缓存任务0',activeElapsedMs:45000,pauseElapsedMs:10000,wallElapsedMs:55000,currentPauseStartedAt:now-10000,segments:[{id:'fixture-segment',startedAt:now-55000,endedAt:now-10000,activeElapsedMs:45000,taskTitle:'本地缓存任务0',taskId:'task-0',taskSource:'local'}],pauseEvents:[],lastTick:now};
let tasks = Array.from({length:240}, (_,i)=>({id:'task-'+i,source:'local',externalId:'task-'+i,projectId:'local-inbox',parentId:null,title:'本地缓存任务'+i,status:'pending',isCompleted:false,priority:0,dueDate:null,startDate:null,tags:[],content:null,sortOrder:i,createdAt:now,updatedAt:now}));
const projects = [{id:'local-inbox',source:'local',externalId:'local-inbox',name:'收件箱',color:'#2563eb'}];
const data = () => ({provider:'focuslink-local',tasks:structuredClone(tasks),projects,refreshedAt:Date.now()});
let resolveRefresh, rejectToggle, resolveToggle;
window.smoke = {localReads:0,remoteReads:0,toggleCalls:0,commits:0,errors:[],sizes:{collapsed:MINI_WINDOW_COLLAPSED_SIZE,expanded:MINI_WINDOW_EXPANDED_SIZE},emit,
  failRefresh:()=>resolveRefresh({ok:false,error:'fixture: cloud unavailable'}),
  failToggle:()=>rejectToggle(new Error('连接超时，操作未确认，请重试')),
  confirmToggle:()=>{snapshot={...snapshot,state:'running',lastTick:Date.now()};emit('tick',snapshot);resolveToggle(snapshot);},
  setTheme:theme=>window.focuslink.settings.set({theme}),
};
window.addEventListener('unhandledrejection', e => window.smoke.errors.push(String(e.reason)));
window.addEventListener('error', e => window.smoke.errors.push(e.message));
window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {supportsFiber:true,renderers:new Map(),inject:()=>1,onCommitFiberRoot:()=>window.smoke.commits++,onCommitFiberUnmount:()=>{}};
window.focuslink = {
  on:(channel,fn)=>{if(!listeners.has(channel))listeners.set(channel,new Set());listeners.get(channel).add(fn);return ()=>listeners.get(channel).delete(fn);},
  settings:{get:async()=>settings,set:async(patch)=>{settings={...settings,...patch};emit('settings:changed',settings);return settings;}},
  sync:{list:async()=>[]},
  sessions:{list:async()=>[],analytics:async(range)=>buildSessionAnalytics(range,{sessions:[],segments:[],pauses:[]}),get:async()=>null},
  timer:{getSnapshot:async()=>snapshot,toggle:()=>{window.smoke.toggleCalls++;return new Promise((resolve,reject)=>{resolveToggle=resolve;rejectToggle=reject;});},stop:async()=>snapshot,reset:async()=>snapshot},
  tasks:{refresh:async(options)=>{if(options?.localOnly){window.smoke.localReads++;return {ok:true,data:data()};}window.smoke.remoteReads++;return new Promise(resolve=>{resolveRefresh=resolve;});},
    create:async(title,projectId)=>{const task={...tasks[0],id:'new-task',title,projectId:projectId||'local-inbox'};tasks=[task,...tasks];emit('tasks:changed',data());return task;},
  },
  window:{minimize:()=>{},toggleMaximize:()=>{},close:()=>{},show:()=>{},setFullScreen:async()=>false,isFullScreen:async()=>false},
  mini:{show:()=>{},hide:()=>{},collapse:()=>{settings={...settings,miniWindow:{...settings.miniWindow,collapsed:true}};emit('settings:changed',settings);},expand:()=>{settings={...settings,miniWindow:{...settings.miniWindow,collapsed:false}};emit('settings:changed',settings);}},
};
`;

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const response = JSON.parse(data);
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    clearTimeout(waiter.timeout);
    response.error
      ? waiter.reject(new Error(JSON.stringify(response.error)))
      : waiter.resolve(response.result);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }, 15000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.text + ': ' + JSON.stringify(result.exceptionDetails.exception),
      );
    return result.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

async function main() {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'Run npm run build first');
  const compiled = await build({
    stdin: { contents: fixture, resolveDir: root, loader: 'ts' },
    bundle: true,
    write: false,
    platform: 'browser',
    alias: { '@shared': path.join(root, 'shared') },
  });
  const server = http.createServer((request, response) => {
    const requested = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(
      dist,
      '.' + decodeURIComponent(requested === '/' ? '/index.html' : requested),
    );
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    const mime = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.woff2': 'font/woff2',
    };
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(output, 'profile');
  const browser = spawn(
    process.env.FOCUSLINK_SMOKE_BROWSER ||
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  let cdp;
  const results = {};
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let attempt = 0; attempt < 80 && !fs.existsSync(portFile); attempt++) await delay(100);
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    cdp = await connect(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const waitFor = async (expression) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await cdp.evaluate(expression)) return;
        await delay(50);
      }
      throw new Error('Timed out: ' + expression);
    };
    const screenshot = async (name) => {
      const result = await cdp.send('Page.captureScreenshot', { captureBeyondViewport: false });
      fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(result.data, 'base64'));
    };
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: compiled.outputFiles[0].text,
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1240,
      height: 802,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    await cdp.send('Page.navigate', { url: origin + '/index.html' });
    await waitFor('window.smoke?.remoteReads===1 && !!document.querySelector(".timer-dial")');
    await cdp.evaluate('document.fonts.ready');
    const started = Date.now();
    await cdp.evaluate('document.querySelector(\'.edge-dock button[aria-label="任务"]\').click()');
    await waitFor('document.querySelectorAll(".entry-title").length>0');
    results.cachedTaskOpenMs = Date.now() - started;
    assert.equal(
      await cdp.evaluate('!!document.querySelector(".task-loading-list")'),
      false,
      'task page must render its local list while remote refresh hangs',
    );
    assert.equal(
      await cdp.evaluate('window.smoke.remoteReads'),
      1,
      'opening the task page must share the outstanding background refresh',
    );
    const palette = await cdp.evaluate(
      `(()=>{const page=document.querySelector('.task-workspace-root'),s=getComputedStyle(page),root=getComputedStyle(document.documentElement);return {theme:page.dataset.theme,surface:s.getPropertyValue('--bg-list').trim(),expected:'rgb('+root.getPropertyValue('--app-surface').trim()+')'};})()`,
    );
    assert.equal(palette.theme, 'dark');
    assert.equal(
      palette.surface,
      palette.expected,
      'default task palette must inherit the main surface',
    );
    await cdp.evaluate('document.querySelector(\'input[placeholder="添加任务…"]\').focus()');
    await cdp.send('Input.insertText', { text: '新建后立即出现在选择器' });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    });
    await waitFor(
      'Array.from(document.querySelectorAll(".entry-title")).some(n=>n.textContent.includes("新建后立即出现在选择器"))',
    );
    assert.equal(
      await cdp.evaluate(
        'Array.from(document.querySelectorAll(".entry-title")).filter(n=>n.textContent.includes("新建后立即出现在选择器")).length',
      ),
      1,
      'the mutation event and IPC return must not duplicate the new task',
    );
    await screenshot('tasks-dark');
    await cdp.evaluate('document.querySelector(\'.edge-dock button[aria-label="专注"]\').click()');
    await waitFor(
      'Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="选择任务")',
    );
    for (let round = 0; round < 2; round++) {
      await cdp.evaluate(
        'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="选择任务").click()',
      );
      await waitFor('!!document.querySelector("#task-picker-listbox")');
      assert.equal(
        await cdp.evaluate(
          'document.querySelector("#task-picker-listbox").textContent.includes("新建后立即出现在选择器")',
        ),
        true,
        'picker must receive the latest local mutation',
      );
      assert.equal(
        await cdp.evaluate('!!document.querySelector(".picker-skeleton-row")'),
        false,
        'cached picker opens without a loading skeleton',
      );
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await waitFor('!document.querySelector("#task-picker-listbox")');
    }
    assert.equal(await cdp.evaluate('window.smoke.remoteReads'), 1);
    await cdp.evaluate('window.smoke.failRefresh()');
    await delay(100);
    await cdp.evaluate('document.querySelector(\'.edge-dock button[aria-label="任务"]\').click()');
    await waitFor('!!document.querySelector(".task-workspace-root .sync-badge")');
    assert.ok(
      await cdp.evaluate('document.querySelector(".sync-badge").textContent.includes("更新失败")'),
      'background failure must be distinguishable from an empty local list',
    );
    await cdp.evaluate('document.querySelector(\'.edge-dock button[aria-label="统计"]\').click()');
    await waitFor('!!document.querySelector(".stats-page")');
    assert.equal(
      await cdp.evaluate('document.querySelector(".stats-page").dataset.theme'),
      'dark',
      'statistics must follow the existing theme',
    );
    await cdp.evaluate('window.smoke.setTheme("light")');
    await waitFor('document.querySelector(".stats-page")?.dataset.theme==="light"');
    await screenshot('stats-light');
    assert.deepEqual(
      await cdp.evaluate('window.smoke.errors'),
      [],
      'main renderer must have no uncaught errors',
    );
    console.log(
      'PASS real App: local-first tasks, repeated picker, mutation events, failure status and shared themes',
      results,
    );

    await cdp.send('Page.navigate', { url: origin + '/mini.html' });
    await waitFor('!!document.querySelector(\'[data-testid="mini-primary-action"]\')');
    const sizes = await cdp.evaluate('window.smoke.sizes');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      ...sizes.expanded,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.evaluate('document.fonts.ready');
    await delay(400);
    const commits = await cdp.evaluate('window.smoke.commits');
    assert.ok(commits > 0, 'React commit observer must be attached to the actual renderer');
    await delay(2500);
    results.pausedReactCommitsIn2500ms = (await cdp.evaluate('window.smoke.commits')) - commits;
    assert.ok(
      results.pausedReactCommitsIn2500ms <= 10,
      'paused timer must not rerender the whole console at 30fps',
    );
    await cdp.evaluate(
      'document.querySelector(\'[data-testid="mini-primary-action"]\').click();document.querySelector(\'[data-testid="mini-primary-action"]\').click()',
    );
    await waitFor(
      'document.querySelector(\'[data-testid="mini-primary-action"]\').textContent.includes("确认中")',
    );
    assert.equal(await cdp.evaluate('window.smoke.toggleCalls'), 1);
    await cdp.evaluate('window.smoke.failToggle()');
    await waitFor('!!document.querySelector(".mini-command-error")');
    assert.equal(
      await cdp.evaluate('document.querySelector(\'[data-testid="mini-shell"]\').dataset.state'),
      'paused',
      'failed resume must retain the confirmed state',
    );
    assert.equal(
      await cdp.evaluate(
        'document.querySelector(\'[data-testid="mini-primary-action"]\').disabled',
      ),
      false,
      'failure releases the controls',
    );
    await screenshot('mini-error');
    await cdp.evaluate('document.querySelector(\'[data-testid="mini-primary-action"]\').click()');
    await cdp.evaluate('window.smoke.confirmToggle()');
    await waitFor(
      'document.querySelector(\'[data-testid="mini-shell"]\').dataset.state==="running"',
    );
    const geometry = await cdp.evaluate(
      `(()=>{const shell=document.querySelector('[data-testid="mini-shell"]'),r=shell.getBoundingClientRect();return {width:r.width,height:r.height,radius:getComputedStyle(shell).borderRadius,overflow:document.documentElement.scrollWidth-innerWidth};})()`,
    );
    assert.equal(geometry.width, sizes.expanded.width);
    assert.equal(geometry.height, sizes.expanded.height);
    assert.notEqual(geometry.radius, '0px');
    assert.ok(geometry.overflow <= 1);
    await screenshot('mini-expanded');
    await cdp.evaluate('document.querySelector(\'[data-testid="mini-collapse"]\').click()');
    await waitFor(
      'document.querySelector(\'[data-testid="mini-shell"]\').dataset.mode==="collapsed"',
    );
    await delay(350);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      ...sizes.collapsed,
      deviceScaleFactor: 1.5,
      mobile: false,
    });
    await cdp.evaluate('window.smoke.emit("timer:command-pending",true)');
    await waitFor('document.querySelector(".mini-collapsed-label").textContent.includes("确认中")');
    await cdp.evaluate(
      'window.smoke.emit("toast:show",{type:"error",message:"连接超时，操作未确认"});window.smoke.emit("timer:command-pending",false)',
    );
    await waitFor('document.querySelector(".mini-collapsed-label").textContent.includes("未确认")');
    assert.equal(await cdp.evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
    await screenshot('mini-collapsed');
    await cdp.evaluate('document.querySelector(\'[data-testid="mini-expand"]\').click()');
    await waitFor(
      'document.querySelector(\'[data-testid="mini-shell"]\').dataset.mode==="expanded"',
    );
    assert.deepEqual(
      await cdp.evaluate('window.smoke.errors'),
      [],
      'mini renderer must have no unhandled promise rejections',
    );
    console.log(
      'PASS real MiniWindow: bounded rendering, duplicate clicks, failed/retried command, two modes, rounding and DPR',
      results,
    );
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify({ status: 'PASS', ...results }, null, 2),
    );
    console.log('Screenshots and results:', output);
  } catch (error) {
    if (cdp) {
      console.error(
        'Renderer diagnostics:',
        await cdp
          .evaluate(
            'JSON.stringify({url:location.href,text:document.body?.innerText?.slice(0,2000),errors:window.smoke?.errors,localReads:window.smoke?.localReads,remoteReads:window.smoke?.remoteReads})',
          )
          .catch(() => 'unavailable'),
      );
      const shot = await cdp
        .send('Page.captureScreenshot', { captureBeyondViewport: false })
        .catch(() => null);
      if (shot)
        fs.writeFileSync(path.join(output, 'failure.png'), Buffer.from(shot.data, 'base64'));
      console.error('Failure screenshot:', path.join(output, 'failure.png'));
    }
    throw error;
  } finally {
    if (cdp) {
      await cdp.send('Browser.close').catch(() => {});
      cdp.close();
    }
    browser.kill();
    server.close();
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await delay(200);
      }
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
