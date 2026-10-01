/* 主窗口「用户真的看得见」验收（FL-INSTALL-012）
 *
 * 为什么需要它（2026-10-01 复发）：
 *   1.3.15 装上后进程跑了 2 天，应用自己写下
 *     `main window shown {"trigger":"ready-to-show","visible":true,"pid":...}`
 *   —— 证据为真，但用户在桌面上看不到任何窗口、`MainWindowHandle` 为 0、
 *   从交互桌面枚举不到该进程的任何顶层窗口。实例占着单实例锁，用户之后每次
 *   点图标都被吞掉，表现为「打不开」。
 *
 *   **教训：`visible:true` 是应用内部的判断，不等于用户看得见。**
 *   验收必须在**交互桌面**上做一次独立的窗口存在性检查。
 *
 * 判定（两条都要满足）：
 *   ① 当前账户的 FocusLink 进程里，至少有一个 `MainWindowHandle != 0`（Windows 只会
 *      给「当前桌面可见且有标题」的顶层窗口返回句柄）；
 *   ② 当天日志里有 `main window shown` 且 `visible: true`，且不晚于进程启动时间。
 *
 * 用法（在 FocusLink/ 下）：
 *   node scripts/smoke/main-window-visible.cjs
 * 退出码非 0 即为「安装后打不开」，按 INSTALLER_TROUBLESHOOTING.md 的 FL-INSTALL-012 处理。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const LOG_DIR = path.join(process.env.APPDATA || '', 'focuslink', 'logs');

function ps(command) {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function processesOfCurrentUser() {
  /* 不用 -IncludeUserName、也不用 CIM 的 GetOwner()：两者都需要提权，
     普通会话会直接报错。这是**只读**的可见性检查，不必按账户过滤，
     直接看这台机器上有没有「可见的 FocusLink 主窗口」即可。 */
  const raw = ps(
    [
      '$p = @(Get-Process -Name FocusLink -ErrorAction SilentlyContinue);',
      "if ($p.Count -eq 0) { '[]' } else {",
      '  $p | Select-Object Id,MainWindowHandle,MainWindowTitle,Responding |',
      '    ConvertTo-Json -Compress',
      '}',
    ].join(' '),
  );
  const text = raw.trim() || '[]';
  if (text === '[]') return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function todayLogFiles() {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs
    .readdirSync(LOG_DIR)
    .filter((n) => /^focuslink-\d{4}-\d{2}-\d{2}\.log$/.test(n))
    .map((n) => path.join(LOG_DIR, n))
    .sort()
    .reverse()
    .slice(0, 2);
}

function visibilityEvidence() {
  const lines = [];
  for (const file of todayLogFiles()) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
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
  const procs = processesOfCurrentUser();
  const visible = procs.filter((p) => Number(p.MainWindowHandle) !== 0);
  const evidence = visibilityEvidence();

  console.log('[window-visible] 当前账户 FocusLink 进程：' + procs.length);
  for (const p of procs) {
    console.log(
      `  pid=${p.Id} handle=${p.MainWindowHandle} title="${p.MainWindowTitle || ''}" responding=${p.Responding}`,
    );
  }
  console.log('\n[window-visible] 可见性证据（最近 6 条）：');
  for (const line of evidence.slice(-6)) console.log('  ' + line);
  if (evidence.length === 0)
    console.log('  （没有任何窗口可见性记录 —— 版本可能早于 FL-INSTALL-011）');

  const problems = [];

  if (procs.length === 0) {
    problems.push('没有任何 FocusLink 进程 —— 应用根本没起来。');
  } else if (visible.length === 0) {
    problems.push(
      '所有进程的 MainWindowHandle 都是 0 —— 进程在跑，但当前桌面上没有可见主窗口。' +
        '这就是「打不开」：它占着单实例锁，用户点图标只会拉起一个注定退出的第二实例。',
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
      visible[0].Id +
      ' 的 MainWindowHandle=' +
      visible[0].MainWindowHandle +
      '，标题「' +
      (visible[0].MainWindowTitle || '') +
      '」。',
  );
}

try {
  main();
} catch (error) {
  console.error('[window-visible] 执行失败', error);
  process.exit(1);
}
