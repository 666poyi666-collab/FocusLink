#!/usr/bin/env node
/* 打包产物启动自检门禁（v1.6.8 B3，FL-INSTALL-013）
 *
 * 为什么需要它：
 *   2026-10-20 用户打完包才发现产物启动即崩（exit 0x80000003，无窗口、无日志），
 *   靠人工排查花了 40 分钟。这一类「打包出来的东西根本起不来」必须在门禁阶段变红，
 *   而不是等装到桌面之后由用户发现。
 *
 * 本脚本的契约（对照 FL-INSTALL-011 / FL-INSTALL-012）：
 *   ① 自己拉起产物：隔离 --user-data-dir + 随机 CDP 端口；拉起前必须清掉
 *      ELECTRON_RUN_AS_NODE（继承它会让 Electron 退化成纯 Node：实测退出码 9 或静默退出）。
 *   ② 不以「进程存在」为通过条件：必须连上 CDP 真实页面，回读版本 / commit / 外壳 /
 *      导航栏 / 专注仪表 / 暂停色。
 *   ③ 失败当场变红：进程提前退出时立刻失败，并打印十进制 + 十六进制 + NTSTATUS 名字，
 *      附上子进程 stdout/stderr 尾巴与隔离日志尾巴 —— 这正是人工排查最缺的两样东西。
 *   ④ finally 里结束自己拉起的进程树并回读 pid 已消失；只碰自己记录的 pid 与子孙，
 *      绝不 Stop-Process 全部 FocusLink.exe。
 *   ⑤ 只读发布目录里的可执行文件（读版本资源、执行它），不复制、不改名、不写发布目录。
 *
 * 覆盖对象（默认取最新 release-v* 目录）：
 *   · release-vNNN/win-unpacked/FocusLink.exe        —— npm run dist 之后立刻可验
 *   · release-vNNN/FocusLink-<ver>-x64-portable.exe  —— 便携版
 *   · release-vNNN/FocusLink-<ver>-x64.exe 是 NSIS 安装版，直接拉起会弹安装向导，
 *     本脚本跳过它并说明原因（安装版由正式构建第 3 步的隔离安装验收覆盖）。
 *
 * 用法（FocusLink/ 下）：
 *   node scripts/verify/packaged-startup.mjs                 自动发现最新 release 目录
 *   node scripts/verify/packaged-startup.mjs --list          只列将校验哪些文件，不拉起
 *   node scripts/verify/packaged-startup.mjs --dir ../release-v168
 *   node scripts/verify/packaged-startup.mjs --exe <path>
 *   node scripts/verify/packaged-startup.mjs --timeout 90000 --keep-user-data
 * 退出码：0 = 全部产物通过且实例已回收；1 = 任一产物失败 / 无产物可验 / 回收失败。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PARENT = path.resolve(ROOT, '..');

/** Windows 常见 NTSTATUS：把退出码直接翻译成可检索原因。 */
const NTSTATUS = {
  0x80000003: 'STATUS_BREAKPOINT（断点/访问冲突类崩溃）',
  0xc0000005: 'STATUS_ACCESS_VIOLATION（访问冲突）',
  0xc0000135: 'STATUS_DLL_NOT_FOUND（缺 DLL）',
  0xc0000142: 'STATUS_DLL_INIT_FAILED（DLL 初始化失败）',
  0xc0000409: 'STATUS_STACK_BUFFER_OVERRUN',
  0xc0000374: 'STATUS_HEAP_CORRUPTION',
};

const PORT_MIN = 9200;
const PORT_MAX = 9800;
const DEFAULT_TIMEOUT_MS = 90000;
const RESULT_EXPR =
  "(() => ({ version: document.documentElement.dataset.appVersion || '', commit: document.documentElement.dataset.appCommit || '', hasShell: Boolean(document.querySelector('.app-shell')), hasRail: Boolean(document.querySelector('.edge-dock')), hasNavButton: Boolean(document.querySelector('.edge-dock-button')), hasConsole: Boolean(document.querySelector('.focus-console')), pauseToken: getComputedStyle(document.documentElement).getPropertyValue('--app-pause').trim() }))()";

function parseArgs(argv) {
  const options = {
    exe: [],
    dir: null,
    timeout: DEFAULT_TIMEOUT_MS,
    list: false,
    keepUserData: false,
    expectVersion: null,
    expectCommit: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[(index += 1)];
    if (arg === '--exe') options.exe.push(path.resolve(String(next())));
    else if (arg === '--dir') options.dir = path.resolve(String(next()));
    else if (arg === '--timeout') options.timeout = Number(next());
    else if (arg === '--list') options.list = true;
    else if (arg === '--keep-user-data') options.keepUserData = true;
    else if (arg === '--expect-version') options.expectVersion = String(next());
    else if (arg === '--expect-commit') options.expectCommit = String(next());
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error('未知参数：' + arg);
  }
  return options;
}

function usage() {
  process.stdout.write(
    [
      '打包产物启动自检（v1.6.8 B3）',
      '  node scripts/verify/packaged-startup.mjs [--dir <release dir>] [--exe <path>]...',
      '        [--timeout 90000] [--list] [--keep-user-data] [--expect-version X] [--expect-commit Y]',
      '',
      '默认自动发现最新 release-v*/ 下的 win-unpacked/FocusLink.exe 与 *-portable.exe。',
      '任一起不来 → 退出码 1。',
      '',
    ].join('\n'),
  );
}

/** 最新 release 目录：按版本数字排序，避免 v169 排在 v170 前面。 */
function newestReleaseDir() {
  const dirs = fs
    .readdirSync(PARENT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^release-v\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(right.slice(9)) - Number(left.slice(9)));
  return dirs.length > 0 ? path.join(PARENT, dirs[0]) : null;
}

/** 收集要校验的可执行文件；明确跳过 NSIS 安装版。 */
function discoverTargets(options) {
  const targets = [];
  const skipped = [];
  if (options.exe.length > 0) {
    for (const exe of options.exe) targets.push({ exe, releaseDir: path.dirname(exe) });
    return { targets, skipped };
  }
  const dir = options.dir ?? newestReleaseDir();
  if (!dir) return { targets, skipped, error: '父目录 ' + PARENT + ' 下没有 release-v* 目录' };
  if (!fs.existsSync(dir)) return { targets, skipped, error: 'release 目录不存在：' + dir };
  const unpacked = path.join(dir, 'win-unpacked', 'FocusLink.exe');
  if (fs.existsSync(unpacked)) targets.push({ exe: unpacked, releaseDir: dir });
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!name.toLowerCase().endsWith('.exe')) continue;
    if (!fs.statSync(full).isFile()) continue;
    if (/-portable\.exe$/i.test(name)) targets.push({ exe: full, releaseDir: dir });
    else skipped.push({ exe: full, reason: 'NSIS 安装版：直接拉起会弹安装向导' });
  }
  if (targets.length === 0) {
    return {
      targets,
      skipped,
      error: dir + ' 下没有可校验产物（既无 win-unpacked/FocusLink.exe，也无 *-portable.exe）',
    };
  }
  return { targets, skipped };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushRing(ring, chunk, max) {
  ring.push(String(chunk));
  let total = ring.reduce((sum, part) => sum + part.length, 0);
  while (total > max && ring.length > 1) total -= ring.shift().length;
}

function ringTail(ring) {
  const text = ring.join('').trim();
  return text.length > 0 ? text.slice(-1500) : '(空)';
}

/* ─── 进程树：只碰自己拉起的 pid 与子孙（FL-INSTALL-012） ─── */

function processTree(rootPid) {
  let raw = '';
  try {
    raw = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; $all | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)" }',
      ],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
  } catch {
    return [rootPid];
  }
  const parents = new Map();
  for (const line of raw.split('\n')) {
    const [pidText, parentText] = line.trim().split('|');
    if (pidText) parents.set(Number(pidText), Number(parentText));
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

function pidAlive(pid) {
  try {
    const raw = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'if (Get-Process -Id ' +
          pid +
          " -ErrorAction SilentlyContinue) { 'alive' } else { 'gone' }",
      ],
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    return raw === 'alive';
  } catch {
    return false;
  }
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
          'Stop-Process -Id ' + pid + ' -Force -ErrorAction SilentlyContinue',
        ],
        { encoding: 'utf8', windowsHide: true },
      );
    } catch {
      /* 已经退出 */
    }
  }
  return pids;
}

/* ─── 产物元数据（只读版本资源，不复制文件） ─── */

function readExeVersion(exe) {
  try {
    const escaped = exe.replace(/'/g, "''");
    const raw = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$v = (Get-Item -LiteralPath ' +
          "'" +
          escaped +
          "'" +
          ').VersionInfo; if ($v.ProductVersion) { $v.ProductVersion } elseif ($v.FileVersion) { $v.FileVersion } else { ' +
          "''" +
          ' }',
      ],
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    if (!raw || raw === '0.0.0.0' || /\s/.test(raw)) return null;
    // Windows 版本资源常是四段（1.6.7.0），运行时 app.getVersion() 是三段（1.6.7）：
    // 归一化到三段再比较，否则会把「版本正确」误判成「版本不符」（2026-10-20 实际踩到）。
    return raw.split('.').slice(0, 3).join('.');
  } catch {
    return null;
  }
}

function repoPackageVersion() {
  try {
    return String(
      JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '',
    ).trim();
  } catch {
    return '';
  }
}

function repoCommit() {
  try {
    const generated = fs.readFileSync(path.join(ROOT, 'shared', 'version.generated.ts'), 'utf8');
    const matched = /APP_COMMIT\s*=\s*'([^']+)'/.exec(generated);
    return matched ? matched[1] : '';
  } catch {
    return '';
  }
}

/* ─── CDP ─── */

async function waitForPage(port, userDataDir, liveness, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = liveness();
    if (state.exit) return { exit: state.exit };
    if (state.spawnError) return { spawnError: state.spawnError };
    try {
      let effective = port;
      if (!effective) {
        const portFile = path.join(userDataDir, 'DevToolsActivePort');
        if (fs.existsSync(portFile)) {
          const parsed = Number.parseInt(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0], 10);
          if (Number.isInteger(parsed) && parsed > 0) effective = parsed;
        }
      }
      if (effective) {
        const response = await fetch('http://127.0.0.1:' + effective + '/json/list');
        const targets = await response.json();
        const page = targets.find(
          (target) =>
            target.type === 'page' &&
            !String(target.url).includes('mini.html') &&
            !String(target.url).startsWith('devtools://'),
        );
        if (page && page.webSocketDebuggerUrl) return { page };
      }
    } catch {
      /* 还没起来 */
    }
    await delay(250);
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

/* ─── 暂存到短 ASCII 路径 ─── */

/**
 * 2026-10-20 实测：同一份产物（文件树 76 项零差异、exe 逐字节相同）从本仓库的长中文路径
 * （…\Desktop\开发\foucslink\release-vNNN\win-unpacked）直接拉起**必崩**（0x80000003，
 * 无窗口、无日志、user-data-dir 里连 Chromium profile 都不建，四连复现），而复制到
 * C:\fltest、Desktop\foucslink-copy、Desktop\测试目录、%TEMP% 后全部通过。
 * 这是**拉起位置**的环境效应，不是产物缺陷（安装器从同一条中文路径执行也会静默退出 0）。
 * 因此门禁一律先把产物暂存到 os.tmpdir() 下的短路径再拉起，保证红/绿只反映产物本身。
 */
function stageArtifact(exe) {
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-stage-'));
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

/* ─── 单个产物校验 ─── */

async function verifyOne(target, options, index) {
  const label = '[verify-packaged] ' + path.basename(target.exe);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-packaged-'));
  const port = PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN));
  const childEnv = { ...process.env };
  const hadRunAsNode = Object.prototype.hasOwnProperty.call(childEnv, 'ELECTRON_RUN_AS_NODE');
  delete childEnv.ELECTRON_RUN_AS_NODE;

  let staged = null;
  try {
    staged = stageArtifact(target.exe);
  } catch (error) {
    staged = null;
    process.stdout.write(
      label +
        ' 暂存到短路径失败，将直接在原位置拉起：' +
        (error instanceof Error ? error.message : String(error)) +
        '\n',
    );
  }
  const launchExe = staged ? staged.exe : target.exe;

  const stdoutRing = [];
  const stderrRing = [];
  let exitState = null;
  let spawnError = null;
  let app = null;
  const cleanup = { pids: [], gone: false, error: null };
  const problems = [];
  let result = null;
  let cdp = null;

  try {
    app = spawn(
      launchExe,
      ['--remote-debugging-port=' + port, '--user-data-dir=' + userDataDir, '--hidden'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: childEnv,
        cwd: staged ? staged.dir : path.dirname(target.exe),
      },
    );
    const childPid = app.pid;
    if (app.stdout) app.stdout.on('data', (chunk) => pushRing(stdoutRing, chunk, 8000));
    if (app.stderr) app.stderr.on('data', (chunk) => pushRing(stderrRing, chunk, 8000));
    app.on('exit', (code, signal) => {
      exitState = { code, signal };
    });
    app.on('error', (error) => {
      spawnError = error;
    });
    let builtAt = 'unknown';
    let justBuilt = false;
    try {
      const info = fs.statSync(target.exe);
      builtAt = info.mtime.toTimeString().slice(0, 8);
      justBuilt = Date.now() - info.mtimeMs < 30000;
    } catch {
      /* 读不到 mtime 不影响判定 */
    }
    process.stdout.write(
      label +
        (childPid ? ' 拉起 pid=' + childPid : ' 拉起失败') +
        '（ELECTRON_RUN_AS_NODE ' +
        (hadRunAsNode ? '已清理' : '未设置') +
        '，产物写入 ' +
        builtAt +
        (justBuilt ? '，30s 内刚写入：构建可能仍在进行，红可能是半成品' : '') +
        '）\n',
    );

    const started = Date.now();
    const found = await waitForPage(
      port,
      userDataDir,
      () => ({ exit: exitState, spawnError }),
      options.timeout,
    );

    if (found.spawnError) {
      problems.push('拉起失败：' + found.spawnError.message);
    } else if (found.exit) {
      const code = found.exit.code;
      const unsigned = typeof code === 'number' ? code >>> 0 : null;
      const hex = unsigned === null ? 'n/a' : '0x' + unsigned.toString(16).toUpperCase();
      const known = unsigned === null ? undefined : NTSTATUS[unsigned];
      problems.push(
        '进程在暴露页面之前退出：code=' +
          code +
          ' (' +
          hex +
          ')' +
          (known ? ' = ' + known : '') +
          (found.exit.signal ? ' signal=' + found.exit.signal : ''),
      );
    } else if (found.timedOut) {
      problems.push(
        '等待页面超时（' + options.timeout + 'ms 内既无页面也无退出），进程可能卡在启动期。',
      );
    } else if (found.page) {
      cdp = await connectCdp(found.page.webSocketDebuggerUrl);
      await cdp.send('Runtime.enable');
      try {
        await cdp.evaluate('window.focuslink.window.show()');
      } catch {
        /* show 失败不单独判红，下面的外壳断言会兜住 */
      }
      await delay(2500);
      result = await cdp.evaluate(RESULT_EXPR);

      const packageVersion = repoPackageVersion();
      const expectedVersion = options.expectVersion || readExeVersion(target.exe) || packageVersion;
      const sameBuild = expectedVersion === packageVersion;
      const expectedCommit = options.expectCommit || (sameBuild ? repoCommit() : '');
      if (!expectedVersion) {
        problems.push('无法确定期望版本：exe 版本资源与 package.json 都读不到');
      } else if (result.version !== expectedVersion) {
        problems.push('version ' + (result.version || '(空)') + ' != 期望 ' + expectedVersion);
      }
      if (expectedCommit && result.commit !== expectedCommit) {
        problems.push('commit ' + (result.commit || '(空)') + ' != ' + expectedCommit);
      }
      if (!result.hasShell) problems.push('缺少 .app-shell（渲染进程没起来）');
      if (!result.hasRail) problems.push('缺少 .edge-dock（导航栏未渲染）');
      if (!result.hasNavButton) problems.push('缺少 .edge-dock-button');
      if (!result.hasConsole) problems.push('缺少 .focus-console（专注仪表未渲染）');
      if (result.pauseToken !== '210 67 57')
        problems.push('暂停色 token 异常：' + result.pauseToken);
      if (!expectedCommit) result.commitNote = '未对 commit 断言（非当前源码版本）';

      try {
        await cdp.evaluate('window.focuslink.window.quit()');
      } catch {
        /* 兜底由 finally 的进程树回收负责 */
      }
      await delay(300);
      process.stdout.write(label + ' 页面就绪 ' + (Date.now() - started) + 'ms\n');
    }

    const logDir = path.join(userDataDir, 'logs');
    const logFiles = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
    if (logFiles.length === 0) {
      problems.push('隔离 user-data-dir 下没有生成任何日志文件（崩溃时无日志可查）');
    } else {
      const newest = logFiles
        .map((name) => path.join(logDir, name))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
      const lines = fs.readFileSync(newest, 'utf8').trim().split('\n');
      process.stdout.write(
        label + ' 日志 ' + lines.length + ' 行（' + path.basename(newest) + '）\n',
      );
      const fatal = lines.filter((line) =>
        /failed to become visible|first paint timed out|off every display|no display in this session|Uncaught|FATAL/.test(
          line,
        ),
      );
      if (fatal.length > 0) problems.push('日志出现失败标记：' + fatal.slice(-2).join(' | '));
    }
  } catch (error) {
    problems.push('校验过程抛错：' + (error instanceof Error ? error.message : String(error)));
  } finally {
    if (cdp) {
      try {
        cdp.close();
      } catch {
        /* ignore */
      }
    }
    try {
      if (app && app.pid) {
        cleanup.pids = killTree(app.pid);
        await delay(600);
        cleanup.gone = !pidAlive(app.pid);
      } else {
        /* 进程根本没拉起来（spawn ENOENT 等）：没有实例可回收，不算 FL-INSTALL-012。 */
        cleanup.gone = true;
      }
    } catch (error) {
      cleanup.error = error instanceof Error ? error.message : String(error);
      cleanup.gone = false;
    }
    if (!cleanup.gone) {
      problems.push(
        '清理后 pid ' +
          (app ? app.pid : '?') +
          ' 仍然存活（FL-INSTALL-012：会占住单实例锁，用户点图标打不开）',
      );
    }
    if (staged && staged.root) {
      try {
        fs.rmSync(staged.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
      } catch {
        /* 暂存目录清理失败不影响判定 */
      }
    }
    if (options.keepUserData || problems.length > 0) {
      process.stdout.write(label + ' user-data-dir 保留：' + userDataDir + '\n');
    } else {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
      } catch {
        /* 临时目录清理失败不影响判定 */
      }
    }
  }

  if (problems.length > 0) {
    process.stderr.write('\n' + label + ' 失败（第 ' + (index + 1) + ' 个）：\n');
    for (const problem of problems) process.stderr.write('  · ' + problem + '\n');
    process.stderr.write('  stdout: ' + ringTail(stdoutRing) + '\n');
    process.stderr.write('  stderr: ' + ringTail(stderrRing) + '\n');
  } else {
    process.stdout.write(
      label +
        ' PASS version=' +
        (result ? result.version : '?') +
        ' commit=' +
        (result ? result.commit : '?') +
        (result && result.commitNote ? '（' + result.commitNote + '）' : '') +
        ' 实例已回收\n',
    );
  }
  return { exe: target.exe, ok: problems.length === 0, problems };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return 0;
  }
  const discovered = discoverTargets(options);
  if (discovered.error) {
    process.stderr.write('[verify-packaged] ' + discovered.error + '\n');
    return 1;
  }
  const targets = discovered.targets;
  process.stdout.write('[verify-packaged] 待校验产物 ' + targets.length + ' 个\n');
  for (const target of targets) process.stdout.write('  · ' + target.exe + '\n');
  for (const skip of discovered.skipped) {
    process.stdout.write('  - 跳过 ' + path.basename(skip.exe) + '：' + skip.reason + '\n');
  }
  if (options.list) return 0;

  const outcomes = [];
  for (let index = 0; index < targets.length; index += 1) {
    outcomes.push(await verifyOne(targets[index], options, index));
  }
  const failed = outcomes.filter((outcome) => !outcome.ok);
  process.stdout.write('\n');
  if (failed.length > 0) {
    process.stderr.write(
      '[verify-packaged] FAIL：' +
        failed.length +
        '/' +
        outcomes.length +
        ' 个产物未通过（' +
        failed.map((outcome) => path.basename(outcome.exe)).join(', ') +
        '）—— 此结果阻断发布。\n',
    );
    return 1;
  }
  process.stdout.write(
    '[verify-packaged] PASS：' +
      outcomes.length +
      '/' +
      outcomes.length +
      ' 个产物启动正常、页面已回读、实例已回收（' +
      targets.map((target) => path.basename(target.exe)).join(', ') +
      '）\n',
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(
      '[verify-packaged] 执行失败：' + (error && error.stack ? error.stack : error) + '\n',
    );
    process.exitCode = 1;
  });
