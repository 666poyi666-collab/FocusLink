import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/types';
import type { AppSettings } from '@shared/types';

let blockedAccelerators: Set<string>;
let registeredCallbacks: Map<string, () => void>;
let registerCalls: string[];
let unregisterCalls: string[];
const hotkeyLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../electron/logger.js', () => ({ logger: hotkeyLog }));

vi.mock('electron', () => ({
  globalShortcut: {
    register: vi.fn((accelerator: string, callback: () => void) => {
      registerCalls.push(accelerator);
      if (blockedAccelerators.has(accelerator)) return false;
      registeredCallbacks.set(accelerator, callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => {
      unregisterCalls.push(accelerator);
      registeredCallbacks.delete(accelerator);
    }),
  },
  BrowserWindow: class BrowserWindow {},
}));

async function loadHotkeys() {
  vi.resetModules();
  return import('../electron/hotkeys.js');
}

function settingsWithHotkeys(hotkeys: Partial<AppSettings['hotkeys']>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    hotkeys: {
      ...DEFAULT_SETTINGS.hotkeys,
      ...hotkeys,
    },
  };
}

describe('hotkey registration regression guards', () => {
  it('does not log success before an asynchronous timer action is confirmed', async () => {
    const hotkeys = await loadHotkeys();
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    let state = 'paused';
    hotkeys.setStateGetter(() => state);
    hotkeys.setHotkeyHandlers({
      toggleTimer: () => pending,
      stopTimer: () => {},
      toggleWindow: () => {},
      linkTask: () => {},
      toggleMiniWindow: () => {},
    });
    hotkeys.registerAllHotkeys(settingsWithHotkeys({ toggleTimer: 'CommandOrControl+1' }));
    hotkeyLog.info.mockClear();
    registeredCallbacks.get('CommandOrControl+1')!();
    expect(hotkeyLog.info.mock.calls.some((call) => call[1] === 'trigger handled')).toBe(false);
    state = 'running';
    resolve();
    await pending;
    await Promise.resolve();
    expect(hotkeyLog.info).toHaveBeenCalledWith(
      'hotkey',
      'trigger handled',
      expect.objectContaining({ beforeState: 'paused', afterState: 'running', success: true }),
    );
  });

  it('logs a rejected timer action as a failure instead of reporting it handled', async () => {
    const hotkeys = await loadHotkeys();
    hotkeys.setHotkeyHandlers({
      toggleTimer: async () => {
        throw new Error('unconfirmed');
      },
      stopTimer: () => {},
      toggleWindow: () => {},
      linkTask: () => {},
      toggleMiniWindow: () => {},
    });
    hotkeys.registerAllHotkeys(settingsWithHotkeys({ toggleTimer: 'CommandOrControl+1' }));
    hotkeyLog.info.mockClear();
    hotkeyLog.error.mockClear();
    registeredCallbacks.get('CommandOrControl+1')!();
    await Promise.resolve();
    await Promise.resolve();
    expect(hotkeyLog.info.mock.calls.some((call) => call[1] === 'trigger handled')).toBe(false);
    expect(hotkeyLog.error).toHaveBeenCalledWith(
      'hotkey',
      'handler error for toggleTimer',
      expect.objectContaining({ error: 'unconfirmed' }),
    );
  });
  beforeEach(() => {
    blockedAccelerators = new Set();
    registeredCallbacks = new Map();
    registerCalls = [];
    unregisterCalls = [];
  });

  it('moves the active toggle shortcut when changing to Ctrl+A', async () => {
    const hotkeys = await loadHotkeys();
    const settings = settingsWithHotkeys({
      toggleTimer: 'CommandOrControl+Alt+Space',
    });

    hotkeys.registerAllHotkeys(settings);
    const result = hotkeys.registerSingle('toggleTimer', 'CommandOrControl+A');

    expect(result.success).toBe(true);
    expect(hotkeys.getRegistrationStatus().registered.toggleTimer?.accelerator).toBe(
      'CommandOrControl+A',
    );
    expect(registeredCallbacks.has('CommandOrControl+A')).toBe(true);
    expect(registeredCallbacks.has('CommandOrControl+Alt+Space')).toBe(false);
  });

  it('restores the old shortcut when the new accelerator cannot be registered', async () => {
    const hotkeys = await loadHotkeys();
    const settings = settingsWithHotkeys({
      toggleTimer: 'CommandOrControl+Alt+Space',
    });

    hotkeys.registerAllHotkeys(settings);
    blockedAccelerators.add('CommandOrControl+A');
    const result = hotkeys.registerSingle('toggleTimer', 'CommandOrControl+A');

    expect(result.success).toBe(false);
    expect(hotkeys.getRegistrationStatus().registered.toggleTimer?.accelerator).toBe(
      'CommandOrControl+Alt+Space',
    );
    expect(registeredCallbacks.has('CommandOrControl+Alt+Space')).toBe(true);
    expect(registeredCallbacks.has('CommandOrControl+A')).toBe(false);
  });

  it('does not unregister a currently active FocusLink shortcut while testing it', async () => {
    const hotkeys = await loadHotkeys();
    const settings = settingsWithHotkeys({
      toggleTimer: 'CommandOrControl+A',
    });

    hotkeys.registerAllHotkeys(settings);
    unregisterCalls = [];
    const ok = hotkeys.testAccelerator('CommandOrControl+A');

    expect(ok).toBe(true);
    expect(unregisterCalls).not.toContain('CommandOrControl+A');
    expect(registeredCallbacks.has('CommandOrControl+A')).toBe(true);
    expect(hotkeys.getRegistrationStatus().registered.toggleTimer?.accelerator).toBe(
      'CommandOrControl+A',
    );
  });

  it('rejects duplicate assignment without moving either existing shortcut', async () => {
    const hotkeys = await loadHotkeys();
    const settings = settingsWithHotkeys({
      toggleTimer: 'CommandOrControl+A',
      stopTimer: 'CommandOrControl+Alt+Enter',
    });

    hotkeys.registerAllHotkeys(settings);
    const result = hotkeys.registerSingle('stopTimer', 'CommandOrControl+A');

    expect(result.success).toBe(false);
    expect(hotkeys.getRegistrationStatus().registered.toggleTimer?.accelerator).toBe(
      'CommandOrControl+A',
    );
    expect(hotkeys.getRegistrationStatus().registered.stopTimer?.accelerator).toBe(
      'CommandOrControl+Alt+Enter',
    );
  });

  it('isolates a persisted modifiers-only shortcut instead of aborting all registration', async () => {
    const hotkeys = await loadHotkeys();
    const results = hotkeys.registerAllHotkeys(
      settingsWithHotkeys({ stopTimer: 'CommandOrControl+Alt' }),
    );

    expect(results.find((result) => result.key === 'stopTimer')).toMatchObject({
      success: false,
      error: '快捷键格式无效，请至少包含一个修饰键和一个按键',
    });
    expect(hotkeys.getRegistrationStatus().registered.toggleTimer).toBeDefined();
    expect(hotkeys.getRegistrationStatus().registered.toggleWindow).toBeDefined();
  });
});
