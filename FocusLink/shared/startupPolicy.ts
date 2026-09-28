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
