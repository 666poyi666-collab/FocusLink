import { describe, expect, it } from 'vitest';
import {
  presentMobileLedgerFreshness,
  presentMobileSettingsConnection,
} from '../src/mobile/settingsStatusPresentation';
import { SETTINGS_LEDGER_FRESH_AFTER_MS } from '../src/features/settings/deviceSyncStatusPresentation';

describe('mobile settings sync status presentation', () => {
  it('separates system offline, realtime connectivity and pairing state', () => {
    expect(
      presentMobileSettingsConnection({
        authenticated: true,
        online: false,
        connection: 'live',
        accountLabel: 'FocusLink',
      }),
    ).toMatchObject({ value: '未连接', tone: 'warning' });
    expect(
      presentMobileSettingsConnection({
        authenticated: true,
        online: true,
        connection: 'offline',
        accountLabel: 'FocusLink',
      }),
    ).toMatchObject({ value: '未连接', tone: 'warning' });
    expect(
      presentMobileSettingsConnection({
        authenticated: true,
        online: true,
        connection: 'live',
        accountLabel: '个人同步空间',
      }),
    ).toEqual({
      value: '实时连接',
      detail: '个人同步空间 · 实时状态已由云端确认',
      tone: 'ok',
    });
    expect(
      presentMobileSettingsConnection({
        authenticated: false,
        online: true,
        connection: 'unconfigured',
      }),
    ).toMatchObject({ value: '尚未配对', tone: 'neutral' });
  });

  it('keeps ledger freshness and last success when the current refresh fails', () => {
    const lastSyncAt = 1_700_000_000_000;
    expect(
      presentMobileLedgerFreshness({
        authenticated: true,
        lastSyncAt,
        pullState: 'confirmed',
        now: lastSyncAt + 60_000,
      }),
    ).toMatchObject({ value: '新鲜', tone: 'ok' });
    expect(
      presentMobileLedgerFreshness({
        authenticated: true,
        lastSyncAt,
        pullState: 'error',
        now: lastSyncAt + SETTINGS_LEDGER_FRESH_AFTER_MS + 1,
      }),
    ).toMatchObject({ value: '缓存待刷新', tone: 'warning' });
    expect(
      presentMobileLedgerFreshness({
        authenticated: true,
        lastSyncAt,
        pullState: 'partial',
        now: lastSyncAt + 60_000,
      }),
    ).toMatchObject({ value: '有记录待处理', tone: 'warning' });
  });

  it('does not invent a successful ledger checkpoint', () => {
    expect(
      presentMobileLedgerFreshness({
        authenticated: true,
        lastSyncAt: null,
        pullState: 'idle',
        now: 1_700_000_000_000,
      }),
    ).toEqual({
      value: '尚未确认',
      detail: '已有本机记录不会因此丢失',
      tone: 'warning',
    });
  });

  it('shows first-sync conflicts and failures even without a previous successful checkpoint', () => {
    expect(
      presentMobileLedgerFreshness({ authenticated: true, lastSyncAt: null, pullState: 'partial' }),
    ).toMatchObject({ value: '有记录待处理', tone: 'warning' });
    expect(
      presentMobileLedgerFreshness({ authenticated: true, lastSyncAt: null, pullState: 'error' }),
    ).toMatchObject({ value: '首次同步未完成', tone: 'warning' });
    expect(
      presentMobileLedgerFreshness({
        authenticated: false,
        lastSyncAt: null,
        pullState: 'partial',
      }),
    ).toMatchObject({ value: '未启用', tone: 'neutral' });
  });

  it('says when a failed refresh retries itself instead of looking stalled', () => {
    const lastSyncAt = 1_700_000_000_000;
    expect(
      presentMobileLedgerFreshness({
        authenticated: true,
        lastSyncAt,
        pullState: 'error',
        now: lastSyncAt + 60_000,
        retryNotice: '约 15 秒后自动重试',
      }).detail,
    ).toBe('最后成功 1 分钟前 · 最近刷新失败 · 约 15 秒后自动重试');
    expect(
      presentMobileLedgerFreshness({
        authenticated: true,
        lastSyncAt: null,
        pullState: 'error',
        retryNotice: '约 1 分钟后自动重试',
      }).detail,
    ).toBe('最近一次账本请求失败；本机记录已保留，可重新检查 · 约 1 分钟后自动重试');
    // A terminal failure carries no retry notice, so the row keeps its old copy.
    expect(
      presentMobileLedgerFreshness({
        authenticated: true,
        lastSyncAt,
        pullState: 'error',
        now: lastSyncAt + 60_000,
        retryNotice: null,
      }).detail,
    ).toBe('最后成功 1 分钟前 · 最近刷新失败');
  });
});
