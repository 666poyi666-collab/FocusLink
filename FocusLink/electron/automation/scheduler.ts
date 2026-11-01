/**
 * 共享业务调度：人工入口、HTTP、旧脚本与云端导入必须排进同一把锁。
 *
 * 三类冲突域：
 * - `timer`：计时控制（开始/暂停/继续/结束/中止）。计时状态机是单例事实，全序执行。
 * - `session:<id>`：单个会话实体的历史写入。不同会话互不阻塞。
 * - `provider:tomatodo`：番茄 ToDo 的写库/上传，串行且节流。
 *
 * 两条语义必须同时成立：
 * 1. 可重入 —— 同一异步上下文已持有某把锁时直接内联，否则
 *    「automation 拿 timer 锁 → 调控制器 → 控制器再拿 timer 锁」会自锁。
 * 2. 空闲时同步进入 —— 锁空闲时操作体在调用栈内立即开始（到第一个 await 为止），
 *    不能让一次按键凭空多出一拍微任务，否则「重复点击只发一条命令」的时序会变。
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const held = new AsyncLocalStorage<ReadonlySet<string>>();
const tails = new Map<string, Promise<unknown>>();

export const TIMER_DOMAIN = 'timer';
export const TOMATODO_DOMAIN = 'provider:tomatodo';

export function sessionDomain(sessionId: string): string {
  return `session:${sessionId}`;
}

export function isReentrant(key: string): boolean {
  return held.getStore()?.has(key) ?? false;
}

function register(key: string, run: Promise<unknown>): void {
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
}

function enter<T>(key: string, operation: () => Promise<T> | T): Promise<T> {
  const next = new Set(held.getStore() ?? []);
  next.add(key);
  try {
    return Promise.resolve(held.run(next, operation));
  } catch (error) {
    return Promise.reject(error);
  }
}

/** 域内独占执行。错误原样透传，不吞、不重试、不改变顺序。 */
export function runExclusive<T>(key: string, operation: () => Promise<T> | T): Promise<T> {
  if (isReentrant(key)) return enter(key, operation);
  const previous = tails.get(key);
  if (!previous) {
    const run = enter(key, operation);
    register(key, run);
    return run;
  }
  const run = previous.then(
    () => enter(key, operation),
    () => enter(key, operation),
  );
  register(key, run);
  return run;
}

/** 当前异步上下文已持有的域，供诊断与断言使用。 */
export function heldDomains(): string[] {
  return [...(held.getStore() ?? [])];
}

/** 仅供测试：清空等待队列，避免用例之间互相阻塞。 */
export function resetSchedulerForTests(): void {
  tails.clear();
}
