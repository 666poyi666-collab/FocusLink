#!/usr/bin/env node
/* 拉起即回收的主窗口可见性验收（FL-INSTALL-012 治本，v1.6.6）
 *
 * 为什么需要它：
 *   2026-09-15 起 `smoke:window-visible` 只做只读枚举 —— 它不拉起进程，因此也谈不上回收。
 *   2026-10-15 22:28（FL-INSTALL-012 复发）验收期拉起的 pid 46636 验收结束后仍存活，占住
 *   Electron 单实例锁；用户点桌面图标时第二实例走到 `createMainWindow` 后退出，当天日志里
 *   没有 `main window shown`，用户看到的就是「点了没反应」。
 *
 * 本脚本的契约：
 *   ① 自己拉起已安装的 FocusLink（先清掉 `ELECTRON_RUN_AS_NODE`，否则拉起的是纯 Node）；
 *   ② 只读枚举窗口：必须在**我们拉起的进程树**里出现标题恰为 `FocusLink` 且可见的顶层窗口；
 *   ③ 当天日志里必须出现 `main window shown` 且 `"visible":true`，且失败标记不晚于本次启动；
 *   ④ **无论成功失败，finally 里都要结束自己拉起的进程树**，并回读确认已消失；
 *   ⑤ 只结束自己记录的 pid 与子孙，绝不 `Stop-Process` 全部 FocusLink.exe。
 *
 * 用法（FocusLink/ 下）：
 *   node scripts/smoke/launch-and-verify-main-window.cjs
 *   node scripts/smoke/launch-and-verify-main-window.cjs --exe <path> --timeout 45000
 * 退出码 0 = 通过；1 = 失败（含清理失败）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const DEFAULT_EXE = path.join(
  process.env.LOCALAPPDATA || '',
  'Programs',
  'FocusLink',
  'FocusLink.exe',
);

const PS_ENUM = `
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FLWindowEnum2 {
  public delegate bool Callback(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string Dump() {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      var s = new StringBuilder(512); GetWindowText(h, s, 512);
      if (s.Length > 0) sb.Append(p + "|" + h + "|" + IsWindowVisible(h) + "|" + s.ToString().Replace("|", " ") + "\\n");
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
'@
[FLWindowEnum2]::Dump()
`;

function parseArgs(argv) {
  const options = { exe: DEFAULT_EXE, timeout: 30000, interval: 400 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--exe') {
      options.exe = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--timeout') {
      options.timeout = Number(argv[index + 1]);
      index += 1;
    } else if (argv[index] === '--interval') {
      options.interval = Number(argv[index + 1]);
      index += 1;
    }
  }
  return options;
}

function enumerateWindows() {
  const raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_ENUM], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, handle, visible, ...rest] = line.split('|');
      return {
        pid: Number(pid),
        handle: Number(handle),
        visible: visible === 'True',
        title: rest.join('|'),
      };
    });
}

function processTree(rootPid) {
  const raw = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; $all | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)" }',
    ],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  const parents = new Map();
  for (const line of raw.split('\n')) {
    const [pid, parent] = line.trim().split('|');
    if (pid) parents.set(Number(pid), Number(parent));
  }
  const tree = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, parent] of parents) {
      if (tree.has(parent) && !tree.has(pid)) {
        tree.add(pid);
        grew = true;
      }
    }
  }
  return [...tree];
}

function killTree(rootPid) {
  const pids = processTree(rootPid);
  for (const pid of pids.reverse()) {
    try {
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`,
        ],
        { encoding: 'utf8', windowsHide: true },
      );
    } catch {
      /* 已经退出 */
    }
  }
  return pids;
}

function pidAlive(pid) {
  const raw = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'alive' } else { 'gone' }`,
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  return raw === 'alive';
}

function logDir() {
  const appData = process.env.APPDATA || '';
  for (const name of ['FocusLink', 'focuslink']) {
    const candidate = path.join(appData, name, 'logs');
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(appData, 'FocusLink', 'logs');
}

function recentLogLines(limitFiles = 2) {
  const dir = logDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((name) => /^focuslink-\d{4}-\d{2}-\d{2}\.log$/.test(name))
    .sort()
    .reverse()
    .slice(0, limitFiles);
  const lines = [];
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n'))
      lines.push(line.trim());
  }
  return lines;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.exe)) {
    console.error(`FAIL exe-missing ${options.exe}`);
    process.exit(1);
  }

  // Electron 会继承 ELECTRON_RUN_AS_NODE，导致拉起的是纯 Node（实测退出码 9 或静默退出）。
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const startedAt = Date.now();
  const logLinesBefore = recentLogLines().length;
  const child = spawn(options.exe, [], {
    detached: false,
    stdio: 'ignore',
    env,
    windowsHide: false,
  });
  const pid = child.pid;
  console.log(`[launch-verify] 拉起 ${options.exe} pid=${pid} (ELECTRON_RUN_AS_NODE 已清理)`);

  const deadline = Date.now() + options.timeout;
  let visibleWindow = null;
  let shownLine = null;
  let failureLine = null;
  let cleanup = { attempted: false, pids: [], gone: null, error: null };
  let firstError = null;

  try {
    while (Date.now() < deadline) {
      const tree = new Set(processTree(pid));
      visibleWindow =
        enumerateWindows().find(
          (window) => tree.has(window.pid) && window.visible && window.title === 'FocusLink',
        ) ?? null;
      const lines = recentLogLines().slice(logLinesBefore);
      shownLine =
        lines
          .filter((line) => line.includes('main window shown') && line.includes(`"pid":${pid}`))
          .pop() ?? null;
      failureLine =
        lines
          .filter((line) =>
            /failed to become visible|first paint timed out|off every display|not an interactive session|no display in this session/.test(
              line,
            ),
          )
          .pop() ?? null;
      if (visibleWindow || failureLine) break;
      await new Promise((resolve) => setTimeout(resolve, options.interval));
    }
  } catch (error) {
    firstError = error;
  } finally {
    cleanup.attempted = true;
    try {
      cleanup.pids = killTree(pid);
      await new Promise((resolve) => setTimeout(resolve, 600));
      cleanup.gone = !pidAlive(pid);
    } catch (error) {
      cleanup.error = error instanceof Error ? error.message : String(error);
      cleanup.gone = false;
    }
  }

  const problems = [];
  if (firstError) problems.push(`拉起/枚举过程中出错：${firstError.message}`);
  if (!visibleWindow) {
    problems.push(
      '我们拉起的进程树里没有标题恰为 `FocusLink` 的可见顶层窗口（只读 EnumWindows 判定）。',
    );
  }
  if (!shownLine) {
    problems.push('当天日志里没有本次 pid 的 `main window shown` 证据。');
  } else if (!/"visible":\s*true/.test(shownLine)) {
    problems.push(`最近一条 main window shown 的 visible 不是 true：${shownLine}`);
  }
  if (failureLine) problems.push(`日志出现失败标记：${failureLine}`);
  if (!cleanup.attempted) problems.push('清理阶段未执行。');
  if (cleanup.error) problems.push(`清理报错：${cleanup.error}`);
  if (cleanup.gone !== true) problems.push(`清理后 pid ${pid} 仍然存在（FL-INSTALL-012 的成因）。`);

  console.log(
    `[launch-verify] window=${visibleWindow ? `pid=${visibleWindow.pid} handle=${visibleWindow.handle}` : 'none'}`,
  );
  console.log(`[launch-verify] log=${logDir()}`);
  console.log(`[launch-verify] elapsed=${Date.now() - startedAt}ms`);
  console.log(
    `[launch-verify] cleanup pid=${pid} tree=[${cleanup.pids.join(',')}] removed=${cleanup.gone}`,
  );

  if (problems.length > 0) {
    console.error('\n[launch-verify] 失败：');
    for (const problem of problems) console.error('  · ' + problem);
    console.error('\n处置：按 backend-design/INSTALLER_TROUBLESHOOTING.md 的 FL-INSTALL-012 走；');
    console.error('      验收「通过」必须同时满足「用户桌面可见」和「验收实例已被回收」。');
    process.exit(1);
  }

  console.log(
    `\n[launch-verify] 通过：pid ${pid} 主窗口 handle=${visibleWindow.handle} 可见，且实例已回收。`,
  );
}

main().catch((error) => {
  console.error('[launch-verify] 执行失败', error);
  process.exit(1);
});
