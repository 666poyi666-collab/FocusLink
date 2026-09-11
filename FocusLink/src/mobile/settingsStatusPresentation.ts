import type { LiveConnectionState } from './runtimeModel';
import {
  presentObservedTime,
  SETTINGS_LEDGER_FRESH_AFTER_MS,
} from '../features/settings/deviceSyncStatusPresentation';

export type MobileSettingsFactTone = 'ok' | 'warning' | 'danger' | 'neutral';
export type MobileSettingsPullState = 'idle' | 'pulling' | 'confirmed' | 'partial' | 'error';

export interface MobileSettingsFact {
  value: string;
  detail: string;
  tone: MobileSettingsFactTone;
}

export function presentMobileSettingsConnection(input: {
  authenticated: boolean;
  online: boolean;
  connection: LiveConnectionState;
  accountLabel?: string | null;
}): MobileSettingsFact {
  if (!input.authenticated || input.connection === 'unconfigured') {
    return {
      value: '尚未配对',
      detail: '本机专注和任务仍可使用；输入另一台设备的 8 位码即可同步',
      tone: 'neutral',
    };
  }
  if (!input.online) {
    return {
      value: '未连接',
      detail: '系统网络当前不可用；本机专注与缓存仍可使用',
      tone: 'warning',
    };
  }
  if (input.connection === 'connecting') {
    return {
      value: '正在连接',
      detail: '正在重新确认实时状态，不影响本机计时',
      tone: 'warning',
    };
  }
  if (input.connection === 'live') {
    return {
      value: '实时连接',
      detail: `${input.accountLabel ?? 'FocusLink 同步空间'} · 实时状态已由云端确认`,
      tone: 'ok',
    };
  }
  if (input.connection === 'offline') {
    return {
      value: '未连接',
      detail: '系统网络可用，但实时状态尚未确认；本机专注仍可使用',
      tone: 'warning',
    };
  }
  return {
    value: '未连接',
    detail: '最近一次实时连接失败；账本最后成功时间单独保留',
    /* 三端契约：概览层的「未连接」一律 neutral，只有凭据失效/契约不符这类阻断性失败才用
       danger（见设置页的诊断栏）。之前这里用 danger，导致「未连接」与「首次同步未完成」
       两个高饱和色在 2×2 矩阵里并排，反而读不出轻重。 */
    tone: 'neutral',
  };
}

export function presentMobileLedgerFreshness(input: {
  authenticated: boolean;
  lastSyncAt: number | null;
  pullState: MobileSettingsPullState;
  now?: number;
}): MobileSettingsFact {
  if (!input.authenticated) {
    return {
      value: '未启用',
      detail: '配对设备后才会产生云端账本确认时间',
      tone: 'neutral',
    };
  }

  const now = input.now ?? Date.now();
  const observed = presentObservedTime(input.lastSyncAt, now);
  if (input.pullState === 'pulling') {
    return {
      value: '正在刷新',
      detail: input.lastSyncAt
        ? `上次成功 ${observed.relative} · ${observed.exact}`
        : '等待首次确认',
      tone: 'warning',
    };
  }
  if (input.pullState === 'partial') {
    return {
      value: '有记录待处理',
      detail: input.lastSyncAt
        ? `最后完整确认 ${observed.relative} · ${observed.exact}`
        : '首次同步尚未完整确认；请处理冲突或被拒绝的记录，本机数据已保留',
      tone: 'warning',
    };
  }
  if (!input.lastSyncAt) {
    return {
      value: input.pullState === 'error' ? '首次同步未完成' : '尚未确认',
      detail:
        input.pullState === 'error'
          ? '最近一次账本请求失败；本机记录已保留，可重新检查'
          : '已有本机记录不会因此丢失',
      tone: 'warning',
    };
  }

  const fresh = now - input.lastSyncAt <= SETTINGS_LEDGER_FRESH_AFTER_MS;
  if (input.pullState === 'error') {
    return {
      value: fresh ? '缓存仍新鲜' : '缓存待刷新',
      detail: `最后成功 ${observed.relative} · 最近刷新失败`,
      tone: 'warning',
    };
  }
  return {
    value: fresh ? '新鲜' : '待刷新',
    detail: `最后成功 ${observed.relative} · ${observed.exact}`,
    tone: fresh ? 'ok' : 'warning',
  };
}
