/**
 * 记录变更的唯一入口。
 *
 * 三条写路径必须产生同一个后果（版本推进 + 提交事件 + 界面通知）：
 * - 人工：界面按钮 / 快捷键 / 托盘经 IPC 落到 db 层 setter；
 * - 云端：Sync v2 导入已结束会话；
 * - API：`/automation/v1` 的补录与修正。
 *
 * 本模块不依赖 electron，也不依赖 db/index（避免环形导入）：
 * 调用方把 `Database` 传进来，事务由调用方决定。
 */
import type Database from 'better-sqlite3';

import type {
  AutomationRecordChangeDomain,
  AutomationRecordChangeEvent,
} from '@shared/automation/contract';
import { AutomationStore } from './store.js';

export type RecordMutationDomain = AutomationRecordChangeDomain;
export type RecordMutationNotice = AutomationRecordChangeEvent;

export interface RecordVersionBump {
  recordVersion: number;
  changeSeq: number;
}

type Listener = (notice: RecordMutationNotice) => void;

const schemaReady = new WeakSet<object>();

/** 首次使用时建表；之后每次写命令不再重复执行 DDL。 */
function ensureSchemaOnce(database: Database.Database): void {
  if (schemaReady.has(database)) return;
  new AutomationStore(database).ensureSchema();
  schemaReady.add(database);
}

const listeners = new Set<Listener>();
let scopeResolver: () => string = () => 'local';

/** 主进程启动时注入连接 scope；未注入时按本机作用域计。 */
export function configureRecordVersioning(options: { scope?: () => string }): void {
  if (options.scope) scopeResolver = options.scope;
}

export function currentRecordScope(): string {
  try {
    return scopeResolver();
  } catch {
    return 'local';
  }
}

/** 订阅记录变更；返回取消订阅函数。 */
export function onRecordMutated(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 在调用方事务内推进版本并写提交事件。不做通知：
 * 事务回滚时通知不能已经发出去。
 */
export function bumpRecordVersion(
  database: Database.Database,
  input: {
    sessionId: string;
    domain: RecordMutationDomain;
    scope?: string;
    now?: number;
  },
): RecordVersionBump {
  ensureSchemaOnce(database);
  const store = new AutomationStore(database);
  const now = input.now ?? Date.now();
  const scope = input.scope ?? currentRecordScope();
  const recordVersion = store.bumpVersion(scope, 'session', input.sessionId, now);
  const changeSeq = store.appendChange({
    scope,
    domain: input.domain,
    entityType: 'session',
    entityId: input.sessionId,
    entityVersion: recordVersion,
    now,
  });
  store.pruneChanges(scope, store.changeRetention());
  return { recordVersion, changeSeq };
}

/** 事务提交后广播：先唤醒 API 事件等待者，再通知界面。 */
export function publishRecordMutation(notice: RecordMutationNotice, wake?: () => void): void {
  wake?.();
  for (const listener of [...listeners]) {
    try {
      listener(notice);
    } catch {
      // 单个订阅者失败不得影响其余订阅者或主流程。
    }
  }
}

/**
 * 便捷入口：自己开事务、推进版本、提交后广播。
 * 人工 setter 与云端导入用这个；需要与其它写合并成同一事务时用 `bumpRecordVersion`。
 */
export function noteRecordMutated(
  database: Database.Database,
  input: {
    sessionId: string;
    domain: RecordMutationDomain;
    sourceClient?: string;
    now?: number;
  },
  wake?: () => void,
): RecordMutationNotice {
  ensureSchemaOnce(database);
  const store = new AutomationStore(database);
  const now = input.now ?? Date.now();
  const bump = store.transaction(() =>
    bumpRecordVersion(database, {
      sessionId: input.sessionId,
      domain: input.domain,
      now,
    }),
  );
  const notice: RecordMutationNotice = {
    sessionId: input.sessionId,
    domain: input.domain,
    sourceClient: input.sourceClient ?? input.domain,
    recordVersion: bump.recordVersion,
    changeSeq: bump.changeSeq,
    observedAt: now,
  };
  publishRecordMutation(notice, wake);
  return notice;
}
