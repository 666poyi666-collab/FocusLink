// Isolated renderer acceptance: synthetic IPC only, never opens the user's database.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { build } = require('esbuild');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'test-data', 'stats-responsive');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HistoryPanel } from './src/features/history/HistoryPanel';
import { TaskWorkspace } from './src/features/tasks/TaskWorkspace';
import { DEFAULT_SETTINGS } from './shared/types';
import { useStore } from './src/app/store';
import { buildSessionAnalytics } from './shared/sessionAnalytics';
import './src/styles/main.css';
const day = new Date().setHours(0,0,0,0);
const longTitle = '第一章第四节｜空间向量的应用：长标题、多个片段与跨清单任务关联验收';
const tasks = [{id:'task-1',title:longTitle,source:'local',projectId:'p1',status:0,children:[],priority:0},{id:'task-2',title:'已完成的复习任务',source:'local',projectId:'p1',status:2,children:[],priority:0}];
tasks[0].children = [10,2,1].map((number,index)=>({id:'child-'+number,parentId:'task-1',title:'循环'+number,source:'local',projectId:'p1',status:'0',isCompleted:false,priority:number===2?3:0,sortOrder:index+1,dueDate:number===10?null:day+number*86400000,children:[],tags:[],content:null}));
const sessions = Array.from({length:6},(_,i)=>({id:'session-'+i,title:i===0?longTitle:'专注会话 '+i,status:'finished',startedAt:day+(8+i)*3600000,endedAt:day+(9+i)*3600000,activeElapsedMs:2700000,pauseElapsedMs:900000,wallElapsedMs:3600000,defaultTaskId:i===1?'task-1':null,defaultTaskTitle:i===1?longTitle:null,defaultTaskSource:i===1?'local':null,note:null,createdAt:day,updatedAt:day,segmentCount:2,linkedSegmentCount:i===1?2:0}));
const segments = sessions.flatMap(s=>[0,1].map((n)=>({id:s.id+'-seg-'+n,sessionId:s.id,taskId:s.defaultTaskId,taskSource:s.defaultTaskSource,title:s.defaultTaskTitle||s.title,startedAt:s.startedAt+n*1800000,endedAt:s.startedAt+n*1800000+1350000,activeElapsedMs:1350000,note:null,cloudFocusId:null,tomatodoSubject:null,createdAt:day,updatedAt:day})));
const pauses = sessions.map(s=>({id:s.id+'-pause',sessionId:s.id,segmentId:s.id+'-seg-0',pauseStartedAt:s.startedAt+1350000,pauseEndedAt:s.startedAt+2250000,durationMs:900000,reason:null,createdAt:day,updatedAt:day}));
window.smokeCalls=[];
window.focuslink={
 sessions:{list:async()=>sessions,analytics:async(range)=>buildSessionAnalytics(range,{sessions,segments,pauses},day+23*3600000),get:async(id)=>({session:sessions.find(s=>s.id===id),segments:segments.filter(s=>s.sessionId===id),pauses:pauses.filter(s=>s.sessionId===id)}),export:async()=> '# 会话记录'},
 timer:{linkSessionTask:async(id,taskId,source,title)=>{window.smokeCalls.push(['session',id,taskId]);Object.assign(sessions.find(s=>s.id===id),{defaultTaskId:taskId,defaultTaskSource:source,defaultTaskTitle:title});},linkSegmentsBatch:async(id,taskId,source,title,onlyUnlinked)=>{window.smokeCalls.push(['batch',id,taskId,onlyUnlinked]);segments.filter(s=>s.sessionId===id&&(!onlyUnlinked||!s.taskId)).forEach(s=>Object.assign(s,{taskId,taskSource:source,title}));},linkTask:async(id,taskId,source,title)=>{window.smokeCalls.push(['segment',id,taskId]);Object.assign(segments.find(s=>s.id===id),{taskId,taskSource:source,title});}},
 tasks:{refresh:async()=>({ok:true,data:{provider:'focuslink-local',tasks,projects:[{id:'p1',name:'学习',color:'#2563eb'}]}}),reorder:async(ids)=>{window.smokeCalls.push(['reorder',ids]);tasks[0].children.forEach(task=>task.sortOrder=ids.indexOf(task.id)+1);}},settings:{get:async()=>DEFAULT_SETTINGS,set:async(patch)=>({...DEFAULT_SETTINGS,...patch})},on:()=>()=>{},
};
useStore.setState({settings:DEFAULT_SETTINGS,ticktickTasks:tasks,ticktickProjects:[{id:'p1',name:'学习',color:'#2563eb'}]});
const reactRoot=createRoot(document.getElementById('root'));
const render=(view)=>reactRoot.render(<div className={'app-shell view-'+view}><div className="window-controls"><span className="window-drag-region"/><button>−</button><button>□</button><button>×</button></div><main className="app-stage">{view==='tasks'?<TaskWorkspace/>:<HistoryPanel/>}</main></div>);
window.showTasks=()=>render('tasks');
render('history');
`;

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
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
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      pending.set(id, { resolve, reject, timeout });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails)
      throw new Error(response.exceptionDetails.exception?.description || 'Renderer exception');
    return response.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  await build({
    stdin: { contents: entry, resolveDir: root, loader: 'tsx' },
    bundle: true,
    outdir: out,
    entryNames: 'smoke',
    platform: 'browser',
    alias: { '@shared': path.join(root, 'shared') },
    loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  fs.writeFileSync(
    path.join(out, 'index.html'),
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="smoke.css"><div id="root" style="height:100vh"></div><script src="smoke.js"></script></html>',
  );
  const server = http.createServer((request, response) => {
    const file = path.join(
      out,
      path.basename(new URL(request.url, 'http://localhost').pathname) || 'index.html',
    );
    if (!fs.existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const mime = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.woff2': 'font/woff2',
    };
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browserPath =
    process.env.FOCUSLINK_SMOKE_BROWSER ||
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const profile = fs.mkdtempSync(path.join(out, 'profile-'));
  const browser = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  let cdp;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let attempt = 0; attempt < 80 && !fs.existsSync(portFile); attempt++) await delay(150);
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    cdp = await connect(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await cdp.evaluate('document.querySelectorAll(".seg-mini-row").length === 3')) break;
      await delay(100);
    }
    assert.equal(
      await cdp.evaluate('document.querySelectorAll(".seg-mini-row").length'),
      3,
      'must render two real segments and one pause',
    );
    const sizes = [
      [1920, 1080, 1],
      [1536, 864, 1.25],
      [1280, 720, 1.5],
      [1024, 768, 1],
      [800, 600, 1.25],
      [640, 720, 1.5],
    ];
    for (const [width, height, scale] of sizes) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: scale,
        mobile: false,
      });
      await delay(120);
      const metrics = await cdp.evaluate(`(() => {
        const page=document.querySelector('.stats-page'), workspace=document.querySelector('.workspace-body');
        const donut=document.querySelector('.donut-center-metric'), ring=document.querySelector('.donut-svg-wrap');
        const d=donut.getBoundingClientRect(),r=ring.getBoundingClientRect();
        const appearance=document.querySelector('#appearanceBtn').getBoundingClientRect(), controls=document.querySelector('.window-controls').getBoundingClientRect();
        const input=document.querySelector('#globalSearchInput'), ir=input.getBoundingClientRect();
        const stats=document.querySelector('#statsDashboardGrid').getBoundingClientRect(), ledger=document.querySelector('.detail-pane').getBoundingClientRect();
        return {pageOverflow:page.scrollWidth-page.clientWidth,workspaceOverflow:workspace.scrollWidth-workspace.clientWidth,ringContained:d.left>=r.left&&d.right<=r.right&&d.top>=r.top&&d.bottom<=r.bottom,donutOverflow:donut.scrollWidth-donut.clientWidth,ledgerVisible:ledger.width>=260&&ledger.top<innerHeight&&ledger.bottom<=innerHeight+1,ledgerEntry:!!document.querySelector('.ledger-toggle'),outerBorder:getComputedStyle(document.querySelector('.stats-dashboard')).borderTopWidth,barText:document.querySelector('#spectrumBar').textContent.trim(),toolbarReachable:appearance.right<=controls.left&&document.elementFromPoint(ir.left+ir.width/2,ir.top+ir.height/2)===input};
      })()`);
      assert.ok(
        metrics.pageOverflow <= 1 && metrics.workspaceOverflow <= 1,
        JSON.stringify({ width, height, metrics }),
      );
      assert.ok(
        metrics.ringContained && metrics.donutOverflow <= 1,
        'donut center must remain inside the ring',
      );
      assert.ok(
        metrics.toolbarReachable,
        'native window controls/drag surface must not cover appearance or search',
      );
      assert.equal(metrics.outerBorder, '0px', 'no rectangular frame around rounded cards');
      assert.equal(
        metrics.barText,
        '',
        'narrow timeline intervals must not contain clipped labels',
      );
      if (width >= 980)
        assert.ok(
          metrics.ledgerVisible,
          'ledger must be visible beside statistics at common widths',
        );
      else assert.ok(metrics.ledgerEntry, 'narrow windows must have a first-screen ledger entry');
      const screenshot = await cdp.send('Page.captureScreenshot', { captureBeyondViewport: false });
      fs.writeFileSync(
        path.join(out, `${width}-${height}.png`),
        Buffer.from(screenshot.data, 'base64'),
      );
      console.log(`PASS ${width}×${height} @${scale}: no horizontal overflow, ring contained`);
    }
    await cdp.evaluate(`document.querySelector('.ledger-toggle').click()`);
    await delay(100);
    assert.ok(
      await cdp.evaluate(
        `document.querySelector('.detail-pane').getBoundingClientRect().width > 260`,
      ),
      'drawer opens on narrow windows',
    );
    await cdp.evaluate(
      `document.querySelectorAll('.stats-sidebar .nav-section')[1].querySelectorAll('button')[1].click()`,
    );
    await delay(100);
    assert.equal(
      await cdp.evaluate('document.querySelectorAll(".session-card").length'),
      1,
      'category must filter by stable task identity',
    );
    assert.equal(
      await cdp.evaluate('document.querySelector("#toastContainer")'),
      null,
      'routine filter must not create stacked notices',
    );
    await cdp.evaluate(
      `document.querySelectorAll('.stats-sidebar .nav-section')[1].querySelector('button').click()`,
    );
    await delay(100);
    await cdp.evaluate(`document.querySelector('.sc-link-btn').click()`);
    await delay(250);
    assert.equal(
      await cdp.evaluate('!!document.querySelector("[role=dialog]")'),
      true,
      'task picker must open',
    );
    assert.ok(
      await cdp.evaluate(
        `(() => { const r=document.querySelector('[role=dialog]').getBoundingClientRect(); return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight; })()`,
      ),
      'task picker must fit the scaled viewport',
    );
    await cdp.evaluate(
      `document.querySelector('[role=combobox]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
    );
    await delay(200);
    assert.equal(await cdp.evaluate('window.smokeCalls.length'), 0, 'cancel must not write');
    await cdp.evaluate(`document.querySelector('.sc-link-btn').click()`);
    await delay(250);
    await cdp.evaluate(
      `document.querySelector('[role=combobox]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
    );
    await delay(500);
    assert.equal(await cdp.evaluate('window.smokeCalls[0]?.[0]'), 'session');
    assert.equal(
      await cdp.evaluate('window.smokeCalls[1]?.[3]'),
      true,
      'session association must preserve already linked segments',
    );
    await cdp.evaluate(`document.querySelector('.seg-mini-row .sc-link-btn').click()`);
    await delay(250);
    await cdp.evaluate(
      `document.querySelector('[role=combobox]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
    );
    await delay(500);
    assert.equal(await cdp.evaluate('window.smokeCalls[2]?.[0]'), 'segment');
    await cdp.evaluate(
      `document.querySelectorAll('.stats-sidebar .nav-section')[0].querySelectorAll('button')[1].click()`,
    );
    await delay(200);
    assert.ok(
      await cdp.evaluate(
        `Array.from(document.querySelectorAll('#rhythmBarContainer .bar-seg-focus')).some(e=>parseFloat(e.style.height)>0)`,
      ),
      '7-day chart must use real daily values',
    );
    await cdp.evaluate(
      `(() => { const input=document.querySelector('#globalSearchInput'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'不存在的会话 smoke'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`,
    );
    await delay(100);
    assert.equal(
      await cdp.evaluate('document.querySelectorAll(".session-card").length'),
      0,
      'search empty state must have no sessions',
    );
    assert.equal(
      await cdp.evaluate('document.querySelector("#deepDiveBox")'),
      null,
      'empty search must not show an unrelated detail',
    );
    console.log('PASS filter, cancel, session/segment association and real multi-day chart');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1.25,
      mobile: false,
    });
    await cdp.evaluate('window.showTasks()');
    await delay(250);
    assert.deepEqual(
      await cdp.evaluate(
        `Array.from(document.querySelectorAll('[data-subtask-id]')).map(node=>node.dataset.subtaskId)`,
      ),
      ['child-1', 'child-2', 'child-10'],
      'natural subtask order',
    );
    await cdp.evaluate(
      `(() => {const select=document.querySelector('select[aria-label="子任务排序"]');select.value='date-desc';select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await delay(100);
    assert.deepEqual(
      await cdp.evaluate(
        `Array.from(document.querySelectorAll('[data-subtask-id]')).map(node=>node.dataset.subtaskId)`,
      ),
      ['child-2', 'child-1', 'child-10'],
      'dates descending, undated last',
    );
    await cdp.evaluate(
      `(() => {const select=document.querySelector('select[aria-label="子任务排序"]');select.value='manual';select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await delay(100);
    await cdp.evaluate(
      `document.querySelector('[data-subtask-id="child-10"] button[aria-label^="下移"]').click()`,
    );
    await delay(100);
    assert.deepEqual(
      await cdp.evaluate(`window.smokeCalls.filter(call=>call[0]==='reorder').at(-1)[1]`),
      ['child-2', 'child-10', 'child-1'],
      'manual order uses durable API and sibling IDs only',
    );
    const divider = await cdp.evaluate(
      `(() => {const r=document.querySelector('.workspace-divider-left').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+150,width:document.querySelector('.task-workspace-root .sidebar').getBoundingClientRect().width};})()`,
    );
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: divider.x,
      y: divider.y,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: divider.x + 45,
      y: divider.y,
      button: 'left',
      buttons: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: divider.x + 45,
      y: divider.y,
      button: 'left',
      clickCount: 1,
    });
    await delay(100);
    assert.ok(
      await cdp.evaluate(
        `document.querySelector('.task-workspace-root .sidebar').getBoundingClientRect().width > ${divider.width + 30}`,
      ),
      'pointer drag actually resizes pane',
    );
    const savedWidth = await cdp.evaluate(
      `JSON.parse(localStorage.getItem('focuslink.task.columns')).left`,
    );
    await cdp.evaluate(
      `document.querySelector('.task-workspace-root .tasks-scroll-area').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:1150,clientY:690}))`,
    );
    await delay(220);
    assert.ok(
      await cdp.evaluate(
        `(() => {const r=document.querySelector('.appearance-menu').getBoundingClientRect();return r.height<300&&r.right<=innerWidth&&r.bottom<=innerHeight;})()`,
      ),
      'compact appearance menu clamped inside viewport',
    );
    const menuShot = await cdp.send('Page.captureScreenshot', { captureBeyondViewport: false });
    fs.writeFileSync(path.join(out, 'tasks-appearance.png'), Buffer.from(menuShot.data, 'base64'));
    await cdp.evaluate(
      `document.querySelector('.appearance-menu [data-app-theme="dark"]').click()`,
    );
    await delay(100);
    assert.equal(
      await cdp.evaluate(`document.querySelector('.task-workspace-root').dataset.theme`),
      'dark',
      'appearance controls apply theme',
    );
    await cdp.evaluate(
      `document.querySelector('.appearance-menu [data-app-theme="light"]').click()`,
    );
    await delay(100);
    await cdp.evaluate(
      `document.querySelector('.task-paper').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}))`,
    );
    await delay(100);
    assert.equal(
      await cdp.evaluate(`!!document.querySelector('.appearance-menu')`),
      false,
      'outside left pointer closes menu',
    );
    await cdp.send('Page.reload');
    await delay(300);
    await cdp.evaluate('window.showTasks()');
    await delay(250);
    assert.equal(
      await cdp.evaluate(`JSON.parse(localStorage.getItem('focuslink.task.columns')).left`),
      savedWidth,
      'width survives reload',
    );
    for (const width of [1280, 1024, 980]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 800,
        deviceScaleFactor: 1.25,
        mobile: false,
      });
      await delay(100);
      assert.ok(
        await cdp.evaluate(
          `document.querySelector('.workspace-body').scrollWidth <= document.querySelector('.workspace-body').clientWidth+1`,
        ),
        'task columns fit resized window',
      );
      const shot = await cdp.send('Page.captureScreenshot', { captureBeyondViewport: false });
      fs.writeFileSync(path.join(out, 'tasks-' + width + '.png'), Buffer.from(shot.data, 'base64'));
    }
    console.log(
      'PASS natural/date/manual subtask order, compact menu dismissal, pointer resize and persistence',
    );
  } finally {
    if (cdp) {
      await cdp.send('Browser.close').catch(() => {});
      cdp.close();
    }
    browser.kill();
    server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
