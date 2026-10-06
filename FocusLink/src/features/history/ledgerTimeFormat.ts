// 会话账本的时间跨度格式。
//
// 背景（用户 2026-10-06 反馈）：跨午夜的会话在卡片上只写了起始日的日期，
// 「10/5 · 11:12 – 08:49」会被读成 08:49 早于 11:12，也让人以为看的是 10/5 的账。
// 规则因此固定为：**起始端总是带日期；结束端只在跨日时补出日期**，同一天就保持短写法。
//
// 日期手工拼装而不是 toLocaleDateString：与 src/lib/time.ts 的 formatDateTime 一致，
// 避免 locale/ICU 版本漂移影响产品字段。

import { formatClock } from '../../lib/time';

/** epoch ms -> "M/D"（本地时区，不补零） */
export function formatLedgerDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 两个时间戳是否落在同一个本地自然日 */
export function isSameLedgerDay(a: number, b: number): boolean {
  const left = new Date(a);
  const right = new Date(b);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** 会话卡片时间药丸：起始端带日期，结束端跨日才带日期。 */
export function formatLedgerClock(startedAt: number, endedAt: number | null): string {
  const head = `${formatLedgerDay(startedAt)} · ${formatClock(startedAt)}`;
  if (!endedAt) return `${head} – 进行中`;
  const tail = isSameLedgerDay(startedAt, endedAt)
    ? formatClock(endedAt)
    : `${formatLedgerDay(endedAt)} ${formatClock(endedAt)}`;
  return `${head} – ${tail}`;
}

/** 片段/暂停行：与所属会话同一天时用短写法，跨日时补出该端日期。 */
export function formatLedgerSpan(start: number, end: number | null, anchor: number): string {
  const head = isSameLedgerDay(start, anchor)
    ? formatClock(start)
    : `${formatLedgerDay(start)} ${formatClock(start)}`;
  if (end === null) return `${head} – 进行中`;
  const tail = isSameLedgerDay(end, start)
    ? formatClock(end)
    : `${formatLedgerDay(end)} ${formatClock(end)}`;
  return `${head} – ${tail}`;
}
