import { describe, expect, it } from 'vitest';
import {
  HIDDEN_START_ARG,
  MAIN_WINDOW_FIRST_PAINT_FALLBACK_MS,
  getLoginItemSettings,
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
