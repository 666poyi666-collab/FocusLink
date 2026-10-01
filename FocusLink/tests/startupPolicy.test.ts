import { describe, expect, it } from 'vitest';
import {
  HIDDEN_START_ARG,
  MAIN_WINDOW_FIRST_PAINT_FALLBACK_MS,
  centerWindowInWorkArea,
  detectWindowPlacementProblem,
  getLoginItemSettings,
  isInteractiveSessionName,
  planSecondInstanceAction,
  shouldAutoSelectDidaTaskSource,
  shouldForceShowAfterFirstPaintTimeout,
  shouldStartHiddenToTray,
  shouldRunDeviceSyncAtLogin,
} from '../shared/startupPolicy';

describe('startup policy', () => {
  it('registers auto-start with a hidden launch argument', () => {
    expect(getLoginItemSettings(true)).toEqual({
      openAtLogin: true,
      args: [HIDDEN_START_ARG],
    });
    expect(getLoginItemSettings(false)).toEqual({
      openAtLogin: false,
      args: [],
    });
  });

  it('keeps the desktop resident when authenticated auto sync is enabled', () => {
    expect(
      shouldRunDeviceSyncAtLogin({ autoStart: false, syncEnabled: true, autoSync: true }),
    ).toBe(true);
    expect(
      shouldRunDeviceSyncAtLogin({ autoStart: false, syncEnabled: true, autoSync: false }),
    ).toBe(false);
    expect(
      shouldRunDeviceSyncAtLogin({ autoStart: true, syncEnabled: false, autoSync: false }),
    ).toBe(true);
  });

  it('hides the main window only for explicit hidden startup modes', () => {
    expect(shouldStartHiddenToTray(false, ['FocusLink.exe'])).toBe(false);
    expect(shouldStartHiddenToTray(true, ['FocusLink.exe'])).toBe(true);
    expect(shouldStartHiddenToTray(false, ['FocusLink.exe', '--hidden'])).toBe(true);
    expect(shouldStartHiddenToTray(false, ['FocusLink.exe', '--start-minimized'])).toBe(true);
  });

  it('selects an installed dida CLI once without overriding an explicit source later', () => {
    expect(
      shouldAutoSelectDidaTaskSource({
        migrationDone: false,
        didaInstalled: true,
        taskSource: 'local',
      }),
    ).toBe(true);
    expect(
      shouldAutoSelectDidaTaskSource({
        migrationDone: true,
        didaInstalled: true,
        taskSource: 'local',
      }),
    ).toBe(false);
    expect(
      shouldAutoSelectDidaTaskSource({
        migrationDone: false,
        didaInstalled: true,
        taskSource: 'ticktick-oauth',
      }),
    ).toBe(false);
  });
});

/* 2026-09-29 事故回归（FL-INSTALL-011）：
   安装 1.3.12 后进程长期存活、事件循环正常，但顶层窗口数为 0；此后每次点图标
   都只是拉起一个注定退出的第二实例，原实例既不显示窗口也不留日志 ——
   用户侧就是「永远打不开」。以下两条把当时缺失的两个不变量钉死。 */
describe('main window visibility recovery (FL-INSTALL-011)', () => {
  const plainArgv = ['FocusLink.exe'];

  it('forces the window visible when first paint never arrives', () => {
    /* 渲染没画出首帧不能让用户永远看不到窗口。 */
    expect(
      shouldForceShowAfterFirstPaintTimeout({
        startMinimizedToTray: false,
        argv: plainArgv,
        windowDestroyed: false,
        windowVisible: false,
      }),
    ).toBe(true);
    /* 已经可见就不要多动。 */
    expect(
      shouldForceShowAfterFirstPaintTimeout({
        startMinimizedToTray: false,
        argv: plainArgv,
        windowDestroyed: false,
        windowVisible: true,
      }),
    ).toBe(false);
    /* 用户显式要求隐藏启动时保持隐藏。 */
    expect(
      shouldForceShowAfterFirstPaintTimeout({
        startMinimizedToTray: false,
        argv: ['FocusLink.exe', HIDDEN_START_ARG],
        windowDestroyed: false,
        windowVisible: false,
      }),
    ).toBe(false);
    expect(
      shouldForceShowAfterFirstPaintTimeout({
        startMinimizedToTray: true,
        argv: plainArgv,
        windowDestroyed: false,
        windowVisible: false,
      }),
    ).toBe(false);
    /* 窗口已经销毁时这里不负责重建（重建由 second-instance 负责）。 */
    expect(
      shouldForceShowAfterFirstPaintTimeout({
        startMinimizedToTray: false,
        argv: plainArgv,
        windowDestroyed: true,
        windowVisible: false,
      }),
    ).toBe(false);
  });

  it('recreates the main window when a second instance arrives and none exists', () => {
    /* 这条是本次事故的核心：此前只有 focus-existing 分支，窗口不在时静默吞掉点击。 */
    expect(
      planSecondInstanceAction({
        argv: plainArgv,
        windowExists: false,
        windowDestroyed: true,
      }),
    ).toBe('recreate');
    expect(
      planSecondInstanceAction({
        argv: plainArgv,
        windowExists: true,
        windowDestroyed: true,
      }),
    ).toBe('recreate');
    expect(
      planSecondInstanceAction({
        argv: plainArgv,
        windowExists: true,
        windowDestroyed: false,
      }),
    ).toBe('focus-existing');
    /* 第二实例自己带隐藏参数时仍然尊重隐藏启动。 */
    expect(
      planSecondInstanceAction({
        argv: ['FocusLink.exe', HIDDEN_START_ARG],
        windowExists: true,
        windowDestroyed: false,
      }),
    ).toBe('ignore-hidden-start');
  });

  it('keeps a bounded first-paint fallback window', () => {
    expect(MAIN_WINDOW_FIRST_PAINT_FALLBACK_MS).toBeGreaterThan(0);
    expect(MAIN_WINDOW_FIRST_PAINT_FALLBACK_MS).toBeLessThanOrEqual(10_000);
  });
});

/* 2026-10-01 复发事故回归（FL-INSTALL-012）：
   装的是 1.3.15，进程跑了 2 天，**应用自己写下 `main window shown {"visible":true}`**，
   但用户桌面上看不到窗口、`MainWindowHandle` 为 0、从交互桌面枚举不到该进程的任何顶层
   窗口 —— 即「可见性证据为真，窗口照样不可见」。它占着单实例锁，用户之后每次点图标
   都被吞掉。以下两条把当时缺失的不变量钉死。 */
describe('main window placement and session (FL-INSTALL-012)', () => {
  const primary = { x: 0, y: 0, width: 3840, height: 2088 };

  it('detects a window that is off every display', () => {
    /* 正常落点：相交 → 没问题 */
    expect(
      detectWindowPlacementProblem({
        displayWorkAreas: [primary],
        windowBounds: { x: 660, y: 295, width: 1241, height: 802 },
      }),
    ).toBeNull();
    /* 换过显示器 / 分辨率变小后跑到屏幕外 → 必须报出来 */
    expect(
      detectWindowPlacementProblem({
        displayWorkAreas: [primary],
        windowBounds: { x: 9000, y: 5000, width: 1241, height: 802 },
      }),
    ).toBe('outside-all-displays');
    /* 完全不相交但相邻（边界刚好贴合）也算在外面 */
    expect(
      detectWindowPlacementProblem({
        displayWorkAreas: [primary],
        windowBounds: { x: 3840, y: 0, width: 800, height: 600 },
      }),
    ).toBe('outside-all-displays');
    /* 一个显示器都没有（非交互上下文）→ 单独一类，调用方据此退出让锁 */
    expect(
      detectWindowPlacementProblem({
        displayWorkAreas: [],
        windowBounds: { x: 0, y: 0, width: 1241, height: 802 },
      }),
    ).toBe('no-display');
  });

  it('computes a recentering target inside the work area', () => {
    const target = centerWindowInWorkArea({
      windowSize: { width: 1241, height: 802 },
      workArea: primary,
    });
    expect(target.width).toBe(1241);
    expect(target.height).toBe(802);
    expect(target.x).toBeGreaterThanOrEqual(0);
    expect(target.y).toBeGreaterThanOrEqual(0);
    expect(target.x + target.width).toBeLessThanOrEqual(primary.width);
    expect(target.y + target.height).toBeLessThanOrEqual(primary.height);
    /* 自愈后的落点自身必须通过落点自检，否则会来回横跳 */
    expect(
      detectWindowPlacementProblem({ displayWorkAreas: [primary], windowBounds: target }),
    ).toBeNull();
    /* 窗口比工作区还大时要夹进工作区，不能把标题栏顶到屏幕外 */
    const clamped = centerWindowInWorkArea({
      windowSize: { width: 9999, height: 9999 },
      workArea: { x: 100, y: 50, width: 1280, height: 720 },
    });
    expect(clamped).toEqual({ x: 100, y: 50, width: 1280, height: 720 });
  });

  it('recognises non-interactive Windows sessions', () => {
    /* 交互式：控制台会话与 RDP 会话都算 */
    expect(isInteractiveSessionName('Console')).toBe(true);
    expect(isInteractiveSessionName('RDP-Tcp#12')).toBe(true);
    /* 非交互：服务上下文 / 环境变量缺失 / 空串 */
    expect(isInteractiveSessionName('Services')).toBe(false);
    expect(isInteractiveSessionName('services')).toBe(false);
    expect(isInteractiveSessionName('')).toBe(false);
    expect(isInteractiveSessionName(undefined)).toBe(false);
    expect(isInteractiveSessionName('   ')).toBe(false);
  });
});
