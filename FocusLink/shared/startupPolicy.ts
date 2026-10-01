export const HIDDEN_START_ARG = '--hidden';
export const LEGACY_HIDDEN_START_ARGS = ['--start-minimized', '--minimized'] as const;

export function getLoginItemSettings(autoStart: boolean): {
  openAtLogin: boolean;
  args: string[];
} {
  return {
    openAtLogin: autoStart,
    args: autoStart ? [HIDDEN_START_ARG] : [],
  };
}

export function shouldRunDeviceSyncAtLogin(input: {
  autoStart: boolean;
  syncEnabled: boolean;
  autoSync: boolean;
}): boolean {
  return input.autoStart || (input.syncEnabled && input.autoSync);
}

export function shouldStartHiddenToTray(
  startMinimizedToTray: boolean,
  argv: readonly string[],
): boolean {
  if (startMinimizedToTray) return true;
  return argv.some(
    (arg) =>
      arg === HIDDEN_START_ARG || (LEGACY_HIDDEN_START_ARGS as readonly string[]).includes(arg),
  );
}

export function shouldAutoSelectDidaTaskSource(input: {
  migrationDone: boolean;
  didaInstalled: boolean;
  taskSource: 'local' | 'ticktick-cli' | 'ticktick-oauth';
}): boolean {
  return !input.migrationDone && input.didaInstalled && input.taskSource === 'local';
}

/* ────────────────────────────────────────────────────────────────────────────
   主窗口可见性兜底（FL-INSTALL-011）
   ────────────────────────────────────────────────────────────────────────────
   2026-09-29 实测事故：安装 1.3.12 后进程长期存活、事件循环正常、每 60 秒仍在
   写同步心跳，但**顶层窗口数为 0**（用对照过的枚举器验证：同机 493 个顶层窗口，
   且隔离实验证明 `show:false` 的 Electron 窗口同样可被枚举）。此后每次点桌面
   图标都只是拉起一个注定退出的第二实例，原实例既不显示窗口也不留任何日志，
   用户侧表现为「永远打不开」。

   两个必须由纯函数钉死的不变量：
     1. **渲染没画出首帧，不能成为用户永远看不到窗口的理由。**
        只要不是用户显式要求隐藏启动，首帧超时就必须强制显示。
     2. **主窗口不存在时，第二个实例必须重建它。**
        只做 show()/focus() 会静默无效，把用户的每一次点击都吞掉。          */

/** `ready-to-show` 的兜底时限：超过它仍未可见就强制显示并留证。 */
export const MAIN_WINDOW_FIRST_PAINT_FALLBACK_MS = 3_000;

export type MainWindowShowTrigger =
  'ready-to-show' | 'first-paint-timeout' | 'second-instance' | 'activate';

export type SecondInstanceAction = 'ignore-hidden-start' | 'focus-existing' | 'recreate';

export function shouldForceShowAfterFirstPaintTimeout(input: {
  startMinimizedToTray: boolean;
  argv: readonly string[];
  windowDestroyed: boolean;
  windowVisible: boolean;
}): boolean {
  if (input.windowDestroyed) return false;
  if (input.windowVisible) return false;
  return !shouldStartHiddenToTray(input.startMinimizedToTray, input.argv);
}

export function planSecondInstanceAction(input: {
  argv: readonly string[];
  windowExists: boolean;
  windowDestroyed: boolean;
}): SecondInstanceAction {
  if (shouldStartHiddenToTray(false, input.argv)) return 'ignore-hidden-start';
  return input.windowExists && !input.windowDestroyed ? 'focus-existing' : 'recreate';
}

/* ────────────────────────────────────────────────────────────────────────────
   主窗口落点与交互桌面自检（FL-INSTALL-012）
   ────────────────────────────────────────────────────────────────────────────
   2026-10-01 复发事故：装的是 1.3.15，进程跑了 2 天，**应用自己写下
   `main window shown {"visible":true}`**，但用户在桌面上看不到任何窗口、
   `MainWindowHandle` 为 0、从交互桌面枚举不到该进程的任何顶层窗口。
   即：窗口确实被「显示」了，却不在用户所在的会话/桌面上；
   而它占着单实例锁，用户之后每次点图标都被吞掉 —— 又是「打不开」。

   这说明 FL-INSTALL-011 的「必须留下可见性证据」还不够：**证据为真，
   窗口照样不可见。** 因此补两条纯函数不变量：

     3. **窗口必须落在某个显示器工作区内。** 落在所有显示器之外（换过显示器、
        分辨率变化、被创建在异常上下文里）时要能算出「移回主显示器」的目标矩形。
     4. **进程必须运行在交互式会话里。** Windows 上 `SESSIONNAME` 为空或
        `Services` 表示非交互上下文（自动化/服务拉起），此时窗口永不可见，
        必须主动退出把单实例锁让给用户自己的启动。                          */

export type Rect = { x: number; y: number; width: number; height: number };

export type WindowPlacementProblem = 'no-display' | 'outside-all-displays' | null;

export function rectIntersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function detectWindowPlacementProblem(input: {
  displayWorkAreas: readonly Rect[];
  windowBounds: Rect;
}): WindowPlacementProblem {
  if (input.displayWorkAreas.length === 0) return 'no-display';
  const intersects = input.displayWorkAreas.some((area) =>
    rectIntersects(input.windowBounds, area),
  );
  return intersects ? null : 'outside-all-displays';
}

/** 窗口尺寸夹进工作区并居中 —— 「窗口跑到屏幕外」的自愈落点。 */
export function centerWindowInWorkArea(input: {
  windowSize: { width: number; height: number };
  workArea: Rect;
}): Rect {
  const width = Math.min(input.windowSize.width, input.workArea.width);
  const height = Math.min(input.windowSize.height, input.workArea.height);
  return {
    x: input.workArea.x + Math.round((input.workArea.width - width) / 2),
    y: input.workArea.y + Math.round((input.workArea.height - height) / 2),
    width,
    height,
  };
}

/** Windows 会话名：交互式会话是 `Console` 或 `RDP-Tcp#N`；服务/非交互上下文为空或 `Services`。 */
export function isInteractiveSessionName(sessionName: string | undefined): boolean {
  if (!sessionName) return false;
  const value = sessionName.trim();
  if (value === '') return false;
  if (value.toLowerCase() === 'services') return false;
  return true;
}
