import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  presentMobileLedgerNotice,
  presentMobileSyncActivity,
  type MobileSyncActivity,
} from '../src/mobile/syncFeedback';

const projectRoot = path.join(__dirname, '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

describe('mobile sync chip activity', () => {
  const idle: MobileSyncActivity = { label: null, detail: null };

  it('keeps the connection wording when nothing is running', () => {
    for (const pullState of ['idle', 'confirmed', 'partial', 'error'] as const) {
      expect(presentMobileSyncActivity({ configured: true, pullState })).toEqual(idle);
    }
  });

  it('answers a manual refresh while the pull runs', () => {
    expect(presentMobileSyncActivity({ configured: true, pullState: 'pulling' })).toEqual({
      label: '检查中',
      detail: '正在核对云端账本…',
    });
  });

  it('never claims a check on an unpaired device', () => {
    for (const pullState of ['idle', 'pulling', 'confirmed', 'partial', 'error'] as const) {
      expect(presentMobileSyncActivity({ configured: false, pullState })).toEqual(idle);
    }
  });
});

describe('mobile ledger pull notice', () => {
  it('hides a blank notice instead of reserving space for it', () => {
    expect(presentMobileLedgerNotice({ notice: null, pullState: 'idle' })).toBeNull();
    expect(presentMobileLedgerNotice({ notice: undefined, pullState: 'pulling' })).toBeNull();
    expect(presentMobileLedgerNotice({ notice: '   ', pullState: 'error' })).toBeNull();
  });

  it('trims the sentence the pull layer produced', () => {
    expect(
      presentMobileLedgerNotice({ notice: '  正在拉取已结束会话账本…  ', pullState: 'pulling' }),
    ).toEqual({ text: '正在拉取已结束会话账本…', tone: 'active' });
  });

  it('follows the pull state rather than the text', () => {
    const notice = '云端账本响应异常；已结束账本继续显示本机缓存';
    expect(presentMobileLedgerNotice({ notice, pullState: 'error' })).toEqual({
      text: notice,
      tone: 'error',
    });
    expect(presentMobileLedgerNotice({ notice, pullState: 'pulling' })).toEqual({
      text: notice,
      tone: 'active',
    });
    for (const pullState of ['idle', 'confirmed', 'partial'] as const) {
      expect(presentMobileLedgerNotice({ notice, pullState })?.tone).toBe('neutral');
    }
  });
});

describe('mobile sync feedback wiring', () => {
  it('drives the chip from the pure projection', () => {
    const mobileApp = readSource(path.join('src', 'mobile', 'MobileApp.tsx'));
    expect(mobileApp).toContain('presentMobileSyncActivity({ configured, pullState })');
    expect(mobileApp).toContain('syncActivity.label ?? connectionTitle(liveConnection)');
    expect(mobileApp).toContain(
      '多端同步：${syncActivity.detail ?? connectionTitle(liveConnection)}',
    );
    expect(mobileApp).toContain('ledgerNotice={ledgerNotice}');
  });

  it('renders the pull sentence in the settings card', () => {
    const settingsView = readSource(path.join('src', 'mobile', 'SettingsView.tsx'));
    expect(settingsView).toContain(
      'presentMobileLedgerNotice({ notice: ledgerNotice, pullState })',
    );
    expect(settingsView).toContain('className={`settings-ledger-notice tone-');
    expect(settingsView).toContain('role="status"');
  });

  it('styles the three notice tones', () => {
    const css = readSource(path.join('src', 'mobile', 'mobile-2-0.css'));
    expect(css).toContain('.settings-ledger-notice {');
    expect(css).toContain('.settings-ledger-notice.tone-active {');
    expect(css).toContain('.settings-ledger-notice.tone-error {');
    expect(css).toContain('border-left-color: var(--danger);');
  });
});
