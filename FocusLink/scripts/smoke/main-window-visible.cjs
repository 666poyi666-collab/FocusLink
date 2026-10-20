/* 主窗口「用户真的看得见」验收（FL-INSTALL-011 / FL-INSTALL-012）
 *
 * 为什么需要它：
 *   2026-09-29（v1.3.12）进程长期存活、事件循环正常，但顶层窗口数为 0；此后每次点图标
 *   都被静默吞掉，用户侧表现为「永远打不开」。
 *   2026-10-01（v1.3.15）进程跑了 2 天，应用自己写下
 *     `main window shown {"trigger":"ready-to-show","visible":true}`
 *   —— 证据为真，但用户桌面上看不到窗口、`MainWindowHandle` 为 0。
 *   **教训：`visible:true` 是应用内部的判断，不等于用户看得见；「进程存在」更不等于
 *   「应用已打开」。验收必须在交互桌面上独立枚举窗口。**
 *
 * 2026-10-02 修正：不能再用 `Get-Process.MainWindowHandle`。
 *   主窗口失焦会自动弹出小窗（标题 `FocusLink Mini`）后，.NET 的 `MainWindowHandle`
 *   可能返回**小窗**的句柄 —— 于是「主窗口没显示、只有小窗」会被误判为通过。
 *   现在改为 `EnumWindows` 逐窗口枚举，按标题精确区分主窗口与小窗。
 *
 * 判定（两条都要满足）：
 *   ① 当前账户存在一个**可见**的顶层窗口，标题恰为 `FocusLink`（小窗不算）；
 *   ② 当天日志里有 `main window shown` 且 `visible: true`。
 *
 * 2026-10-15 22:28（FL-INSTALL-012 复发）补充：验收期拉起的 pid 46636 验收后仍存活、占住
 *   单实例锁，用户点桌面图标只拉起一个注定退出的第二实例，当天日志里没有 `main window shown`，
 *   用户看到的是「点了没反应」。本脚本只做只读枚举，**不拉起也不回收任何进程**；拉起即回收由
 *   `launch-and-verify-main-window.cjs` 负责。当检测到「有进程存活但没有任何可见主窗口」时，
 *   本脚本额外输出 `FL-INSTALL-012` 诊断块（进程 pid/startTime、结论、处置顺序），退出码仍非 0。
 *
 * 用法（在 FocusLink/ 下）：
 *   node scripts/smoke/main-window-visible.cjs
 * 退出码非 0 即「安装后打不开」，按 INSTALLER_TROUBLESHOOTING.md 的 FL-INSTALL-012 处理。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LOG_DIR = path.join(process.env.APPDATA || '', 'focuslink', 'logs');

const PS_ENUM = `
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FLWindowEnum {
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
[FLWindowEnum]::Dump()
`;

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

function focusLinkPids() {
  const raw = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$p = @(Get-Process -Name FocusLink -ErrorAction SilentlyContinue); if ($p.Count -eq 0) { '' } else { ($p | Select-Object -ExpandProperty Id) -join ',' }",
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  return raw ? raw.split(',').map(Number) : [];
}

/* 只读取证：进程 pid / startTime / .NET MainWindowHandle / 会话号。
 * MainWindowHandle 只作参考，不能替代 EnumWindows 判据（它可能返回小窗句柄）。 */
const PS_PROCESS_DETAILS = `
$ErrorActionPreference = 'SilentlyContinue'
Get-Process -Name FocusLink | ForEach-Object {
  $item = $_
  try { $start = $item.StartTime.ToString('yyyy-MM-dd HH:mm:ss') } catch { $start = 'unknown' }
  "$($item.Id)|$start|$($item.MainWindowHandle)|$($item.SessionId)"
}
`;

function focusLinkProcessDetails() {
  const raw = execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', PS_PROCESS_DETAILS],
    {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, startTime, mainWindowHandle, sessionId] = line.split('|');
      return {
        pid: Number(pid),
        startTime: startTime || 'unknown',
        mainWindowHandle: mainWindowHandle || '0',
        sessionId: sessionId || 'unknown',
      };
    });
}

/* FL-INSTALL-012 诊断块：进程在跑、但没有任何可见主窗口。
 * 本脚本只读，诊断块里的第 1 步命令**不会**由脚本执行，只能由用户/操作者自己执行。 */
function printInstall012Diagnostic(pids) {
  console.error(
    '\n[window-visible] FL-INSTALL-012 诊断：有 FocusLink 进程存活，但没有任何可见的主窗口',
  );
  console.error('  当前会话：SESSIONNAME=' + (process.env.SESSIONNAME || '(未设置)'));
  let details = [];
  try {
    details = focusLinkProcessDetails();
  } catch (error) {
    console.error(
      '  （读取进程 startTime 失败：' +
        (error instanceof Error ? error.message : String(error)) +
        '）',
    );
  }
  const rows = details.filter((item) => pids.includes(item.pid));
  console.error('  进程（当前账户）：');
  if (rows.length > 0) {
    for (const row of rows) {
      console.error(
        '    pid=' +
          row.pid +
          ' startTime=' +
          row.startTime +
          ' mainWindowHandle=' +
          row.mainWindowHandle +
          ' session=' +
          row.sessionId,
      );
    }
  } else {
    for (const pid of pids) console.error('    pid=' + pid);
  }
  console.error(
    '  结论：这些实例占着 Electron 单实例锁；用户点桌面图标只会拉起一个注定退出的第二实例，',
  );
  console.error(
    '        日志里可能写着 main window shown visible:true，但窗口不在用户桌面上 —— 日志证据为真、窗口不可见。',
  );
  console.error('  处置顺序（本脚本只读，不结束任何进程；第 1 步需要你或用户自己执行）：');
  console.error('    1) Get-Process FocusLink -ErrorAction SilentlyContinue | Stop-Process -Force');
  console.error(
    '    2) 由用户从桌面图标（或开始菜单）启动 FocusLink —— 不要用后台自动化代替用户拉起 GUI。',
  );
  console.error(
    '    3) 再跑一次：node scripts/smoke/main-window-visible.cjs（或 npm run smoke:window-visible）。',
  );
}

function visibilityEvidence() {
  if (!fs.existsSync(LOG_DIR)) return [];
  const files = fs
    .readdirSync(LOG_DIR)
    .filter((n) => /^focuslink-\d{4}-\d{2}-\d{2}\.log$/.test(n))
    .sort()
    .reverse()
    .slice(0, 2);
  const lines = [];
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(LOG_DIR, file), 'utf8').split('\n')) {
      if (
        /main window shown|failed to become visible|first paint timed out|off every display|not an interactive session|no display in this session/.test(
          line,
        )
      ) {
        lines.push(line.trim());
      }
    }
  }
  return lines;
}

function main() {
  const pids = focusLinkPids();
  const windows = enumerateWindows().filter((w) => pids.includes(w.pid));
  const mainWindows = windows.filter((w) => w.title === 'FocusLink');
  const miniWindows = windows.filter((w) => /FocusLink Mini/i.test(w.title));
  const mainVisible = mainWindows.filter((w) => w.visible);
  const miniVisible = miniWindows.filter((w) => w.visible);
  const evidence = visibilityEvidence();

  console.log('[window-visible] 当前账户 FocusLink 进程：' + pids.length);
  for (const w of windows) {
    console.log(`  pid=${w.pid} handle=${w.handle} visible=${w.visible} title="${w.title}"`);
  }
  if (miniVisible.length > 0) {
    console.log(
      '  （可见小窗 ' +
        miniVisible.length +
        ' 个：小窗不算主窗口 —— 主窗口不在前台时它本来就会自动显示）',
    );
  }
  console.log('\n[window-visible] 可见性证据（最近 6 条）：');
  for (const line of evidence.slice(-6)) console.log('  ' + line);
  if (evidence.length === 0) {
    console.log('  （没有任何窗口可见性记录 —— 版本可能早于 FL-INSTALL-011）');
  }

  const problems = [];

  if (pids.length === 0) {
    problems.push('没有任何 FocusLink 进程 —— 应用根本没起来。');
  } else if (mainVisible.length === 0) {
    problems.push(
      '没有任何可见的顶层窗口标题为 `FocusLink`' +
        (miniVisible.length > 0 ? '（只有小窗可见）' : '') +
        '。进程在跑但主窗口没显示，就是「打不开」：它占着单实例锁，' +
        '用户点图标只会拉起一个注定退出的第二实例。',
    );
  }

  const shownLine = evidence.filter((l) => /main window shown/.test(l)).pop();
  if (!shownLine) {
    problems.push('日志里没有 `main window shown`：应用从未写下「窗口已显示」的证据。');
  } else if (!/"visible":\s*true/.test(shownLine)) {
    problems.push('最近一条 `main window shown` 的 visible 不是 true：' + shownLine);
  }
  const offDisplay = evidence
    .filter((l) => /off every display|no display in this session/.test(l))
    .pop();
  if (offDisplay) {
    problems.push('应用自愈路径被触发过（窗口曾落在所有显示器之外）：' + offDisplay);
  }

  if (problems.length > 0) {
    console.error('\n[window-visible] 失败：');
    for (const p of problems) console.error('  · ' + p);
    console.error(
      '\n处置：按 backend-design/INSTALLER_TROUBLESHOOTING.md 的 FL-INSTALL-012 走；' +
        '不要用「进程存在」当作「应用已打开」。',
    );
    process.exit(1);
  }

  console.log(
    '\n[window-visible] 通过：pid ' +
      mainVisible[0].pid +
      ' 的主窗口 handle=' +
      mainVisible[0].handle +
      '，标题「' +
      mainVisible[0].title +
      '」。',
  );
}

try {
  main();
} catch (error) {
  console.error('[window-visible] 执行失败', error);
  process.exit(1);
}
