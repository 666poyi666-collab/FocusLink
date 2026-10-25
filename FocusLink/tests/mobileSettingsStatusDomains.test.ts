import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  MOBILE_SETTINGS_TASK_FRESH_AFTER_MS,
  presentMobileSettingsLedgerQueue,
  presentMobileTaskSync,
  presentMobileThirdPartyDelivery,
} from '../src/mobile/settingsStatusPresentation';
import {
  readCachedTaskSnapshot,
  readCachedTaskSnapshotConfirmedAt,
  writeCachedTaskSnapshot,
} from '../src/mobile/cache';
import type { TaskSnapshotResponse } from '../shared/sync/taskSnapshotProtocol';

const TASK_RESPONSE: TaskSnapshotResponse = {
  protocolVersion: 1,
  revision: 7,
  sourceDeviceId: null,
  snapshot: { publishedAt: 1, projects: [], tasks: [] },
  serverTime: 2,
};

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('focuslink-mobile-preview');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

describe('mobile settings status domains', () => {
  describe('task sync domain', () => {
    it('never claims a confirmed task list while the device is unpaired', () => {
      const fact = presentMobileTaskSync({
        authenticated: false,
        taskCount: 0,
        revision: 0,
        confirmedAt: null,
      });
      expect(fact.value).toBe('未启用');
      expect(fact.tone).toBe('neutral');
      expect(fact.detail).toContain('配对设备后才会确认任务清单');
    });

    it('separates "held locally" from "confirmed by the cloud"', () => {
      const fact = presentMobileTaskSync({
        authenticated: true,
        taskCount: 4,
        revision: 0,
        confirmedAt: null,
      });
      expect(fact.value).toBe('4 项（本机）');
      expect(fact.detail).toContain('还没有从云端确认任务清单');
      expect(fact.tone).toBe('warning');
      expect(fact.detail).not.toContain('最后确认');
    });

    it('reports the confirmation time and revision once the cloud confirmed the list', () => {
      const now = 1_700_000_000_000;
      const fact = presentMobileTaskSync({
        authenticated: true,
        taskCount: 4,
        revision: 7,
        confirmedAt: now - 30_000,
        now,
      });
      expect(fact.value).toBe('4 项已确认');
      expect(fact.detail).toBe('最后确认 刚刚 · revision 7');
      expect(fact.tone).toBe('ok');
    });

    it('turns stale exactly at its own threshold, not the ledger window', () => {
      const now = 1_700_000_000_000;
      const inside = presentMobileTaskSync({
        authenticated: true,
        taskCount: 1,
        revision: 2,
        confirmedAt: now - MOBILE_SETTINGS_TASK_FRESH_AFTER_MS,
        now,
      });
      const outside = presentMobileTaskSync({
        authenticated: true,
        taskCount: 1,
        revision: 2,
        confirmedAt: now - MOBILE_SETTINGS_TASK_FRESH_AFTER_MS - 1,
        now,
      });
      expect(MOBILE_SETTINGS_TASK_FRESH_AFTER_MS).toBe(60_000);
      expect(inside.tone).toBe('ok');
      expect(outside.tone).toBe('warning');
      expect(outside.value).toBe('1 项已确认');
    });

    it('keeps a future stamp readable instead of crashing on clock drift', () => {
      const fact = presentMobileTaskSync({
        authenticated: true,
        taskCount: 2,
        revision: 3,
        confirmedAt: 1_700_000_000_000,
        now: 1_700_000_000_000 - 5 * 60_000,
      });
      expect(fact.detail).toContain('设备时间待校准');
      expect(fact.tone).toBe('ok');
    });
  });

  describe('ledger queue domain', () => {
    it('shows the empty queue as an explicit healthy state', () => {
      const fact = presentMobileSettingsLedgerQueue({ pending: 0, conflicts: 0, rejected: 0 });
      expect(fact.value).toBe('无待处理');
      expect(fact.detail).toBe('没有排队上传、冲突或被拒绝的账本记录');
      expect(fact.tone).toBe('ok');
    });

    it('keeps queued uploads separate from conflicts and rejections', () => {
      const fact = presentMobileSettingsLedgerQueue({ pending: 2, conflicts: 0, rejected: 0 });
      expect(fact.value).toBe('2 条待处理');
      expect(fact.detail).toBe('待上传 2 · 冲突 0 · 被拒绝 0');
      expect(fact.tone).toBe('warning');
    });

    it('raises the tone only when a decision or a fix is required', () => {
      const conflicts = presentMobileSettingsLedgerQueue({ pending: 1, conflicts: 1, rejected: 0 });
      const rejected = presentMobileSettingsLedgerQueue({ pending: 0, conflicts: 0, rejected: 3 });
      expect(conflicts.tone).toBe('danger');
      expect(rejected.value).toBe('3 条待处理');
      expect(rejected.tone).toBe('danger');
      expect(rejected.detail).toBe('待上传 0 · 冲突 0 · 被拒绝 3');
    });
  });

  describe('third-party delivery domain', () => {
    it('states the desktop boundary instead of implying a mobile sync', () => {
      const fact = presentMobileThirdPartyDelivery();
      expect(fact.value).toBe('仅桌面端');
      expect(fact.detail).toContain('手机不发起投递');
      expect(fact.tone).toBe('neutral');
    });
  });

  describe('domain separation', () => {
    it('does not let one domain borrow another domain words or numbers', () => {
      const task = presentMobileTaskSync({
        authenticated: true,
        taskCount: 1,
        revision: 9,
        confirmedAt: 1_000,
        now: 2_000,
      });
      const queue = presentMobileSettingsLedgerQueue({ pending: 0, conflicts: 0, rejected: 0 });
      expect(task.detail).not.toContain('账本');
      expect(task.detail).not.toContain('新鲜');
      expect(queue.detail).not.toContain('任务');
      expect(queue.detail).not.toContain('revision');
    });
  });

  describe('task confirmation stamp persistence', () => {
    beforeEach(async () => {
      await deleteDatabase();
    });

    it('records the local receipt time with the cached snapshot', async () => {
      const before = Date.now();
      await writeCachedTaskSnapshot(TASK_RESPONSE, 'account-a');
      const stamp = await readCachedTaskSnapshotConfirmedAt('account-a');
      expect(stamp).not.toBeNull();
      expect(stamp).toBeGreaterThanOrEqual(before);
      expect(await readCachedTaskSnapshot('account-a')).toEqual(TASK_RESPONSE);
    });

    it('never hands one account the other account stamp', async () => {
      await writeCachedTaskSnapshot(TASK_RESPONSE, 'account-a');
      expect(await readCachedTaskSnapshotConfirmedAt('account-b')).toBeNull();
      expect(await readCachedTaskSnapshotConfirmedAt(null)).toBeNull();
    });
  });
});

describe('mobile settings domain wiring', () => {
  const root = process.cwd();
  const settingsSource = fs.readFileSync(
    path.join(root, 'src', 'mobile', 'SettingsView.tsx'),
    'utf8',
  );
  const appSource = fs.readFileSync(path.join(root, 'src', 'mobile', 'MobileApp.tsx'), 'utf8');

  it('renders each domain as its own row instead of faking confirmation with a revision', () => {
    expect(settingsSource).toContain('label="账本待处理"');
    expect(settingsSource).toContain('label="第三方投递"');
    expect(settingsSource).toContain('presentMobileTaskSync({');
    expect(settingsSource).toContain('presentMobileSettingsLedgerQueue({');
    expect(settingsSource).toContain('这几格互不代偿');
    expect(settingsSource).not.toContain('detail={`revision ${taskRevision}`}');
  });

  it('feeds the rows from real timestamps and counts', () => {
    expect(appSource).toContain('taskConfirmedAt={taskConfirmedAt}');
    expect(appSource).toContain('ledgerPendingCount={pendingUploadCount}');
    expect(appSource).toContain('ledgerRejectedCount={ledgerRejectedCount}');
    expect(appSource).toContain('readCachedTaskSnapshotConfirmedAt(cacheAccountId)');
    expect(appSource).toContain('setTaskConfirmedAt(Date.now())');
  });

  it('no longer ships the orphaned sync management component', () => {
    expect(fs.existsSync(path.join(root, 'src', 'mobile', 'SyncV2Management.tsx'))).toBe(false);
    const files = fs
      .readdirSync(path.join(root, 'src', 'mobile'))
      .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'));
    const importers = files.filter((name) =>
      fs
        .readFileSync(path.join(root, 'src', 'mobile', name), 'utf8')
        .includes("from './SyncV2Management'"),
    );
    expect(importers).toEqual([]);
  });
});
