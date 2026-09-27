import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TASK_WORKSPACE_APPEARANCE,
  TASK_WORKSPACE_DENSITIES,
  TASK_WORKSPACE_FONTS,
  TASK_WORKSPACE_PALETTES,
  resolveTaskWorkspaceAppearance,
} from '../shared/types';
import type { AppSettings } from '../shared/types';
import { detectSettingsChangedDomains, mergeSettings } from '../shared/settingsPolicy';
describe('任务页外观设置：默认值 / 兼容归一 / 非法值回落', () => {
  it('默认值与旧设置缺字段时补齐默认', () => {
    expect(DEFAULT_SETTINGS.taskWorkspaceAppearance).toEqual({
      palette: 'linear',
      font: 'sans',
      density: 'default',
    });

    const legacy = { ...DEFAULT_SETTINGS } as Partial<AppSettings>;
    delete legacy.taskWorkspaceAppearance;
    const migrated = mergeSettings(DEFAULT_SETTINGS, legacy);
    expect(migrated.taskWorkspaceAppearance).toEqual(DEFAULT_TASK_WORKSPACE_APPEARANCE);
  });
  it('嵌套字段缺失时逐项补默认，不丢已选字段', () => {
    const partial = mergeSettings(DEFAULT_SETTINGS, {
      taskWorkspaceAppearance: { palette: 'rose' },
    });
    expect(partial.taskWorkspaceAppearance).toEqual({
      palette: 'rose',
      font: 'sans',
      density: 'default',
    });
    const chosen = mergeSettings(partial, { taskWorkspaceAppearance: { density: 'compact' } });
    expect(chosen.taskWorkspaceAppearance).toEqual({
      palette: 'rose',
      font: 'sans',
      density: 'compact',
    });
  });
  it('非法值全部回落默认，非对象输入也安全', () => {
    expect(
      resolveTaskWorkspaceAppearance({ palette: 'neon', font: 'comic', density: 'huge' }),
    ).toEqual(DEFAULT_TASK_WORKSPACE_APPEARANCE);
    expect(resolveTaskWorkspaceAppearance(undefined)).toEqual(DEFAULT_TASK_WORKSPACE_APPEARANCE);
    expect(resolveTaskWorkspaceAppearance(null)).toEqual(DEFAULT_TASK_WORKSPACE_APPEARANCE);
    expect(resolveTaskWorkspaceAppearance('rose')).toEqual(DEFAULT_TASK_WORKSPACE_APPEARANCE);
    expect(resolveTaskWorkspaceAppearance({ palette: 'rose' })).toEqual({
      palette: 'rose',
      font: 'sans',
      density: 'default',
    });
  });
  it('三档调色板 / 两档字体 / 三档密度全部可往返', () => {
    for (const palette of TASK_WORKSPACE_PALETTES) {
      const saved = mergeSettings(DEFAULT_SETTINGS, { taskWorkspaceAppearance: { palette } });
      expect(saved.taskWorkspaceAppearance.palette).toBe(palette);
    }
    for (const font of TASK_WORKSPACE_FONTS) {
      expect(resolveTaskWorkspaceAppearance({ font }).font).toBe(font);
    }
    for (const density of TASK_WORKSPACE_DENSITIES) {
      expect(resolveTaskWorkspaceAppearance({ density }).density).toBe(density);
    }
  });
  it('跨无关更新后任务页外观保持，且不污染全局主题与全局字体', () => {
    const saved = mergeSettings(DEFAULT_SETTINGS, {
      taskWorkspaceAppearance: { palette: 'contrast', font: 'serif', density: 'relaxed' },
    });
    const restored = mergeSettings(saved, { taskSource: 'local' });
    expect(restored.taskWorkspaceAppearance).toEqual({
      palette: 'contrast',
      font: 'serif',
      density: 'relaxed',
    });
    expect(restored.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(restored.themeFamily).toBe(DEFAULT_SETTINGS.themeFamily);
    expect(restored.fontProfile).toBe(DEFAULT_SETTINGS.fontProfile);
  });
  it('任务页外观变更归入 theme 域，不触发 general 副作用', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, {
      taskWorkspaceAppearance: { palette: 'rose' },
    });
    expect(detectSettingsChangedDomains(DEFAULT_SETTINGS, next)).toEqual(['theme']);
  });
});
