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
