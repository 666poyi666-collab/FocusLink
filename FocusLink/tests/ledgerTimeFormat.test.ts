import { describe, expect, it } from 'vitest';

import {
  formatLedgerClock,
  formatLedgerDay,
  formatLedgerSpan,
  isSameLedgerDay,
} from '../src/features/history/ledgerTimeFormat';

/* ────────────────────────────────────────────────────────────────────────────
   统计页会话账本的时间跨度格式（用户 2026-10-06 反馈）

   用户原话：统计界面今天是 10 月 6 号，它给我显示个 10 月 5 号干什么？
   实际情况：那条会话 10/5 11:12 开始、10/6 08:49 结束（跨午夜），卡片只写了
   「10/5 · 11:12 – 08:49」——起始日看着像错的，结束时间看着像比开始还早。
   规则：起始端总是带日期，结束端只在跨日时补日期，同一天保持短写法。
   ──────────────────────────────────────────────────────────────────────────── */

/** 用本地时间构造时间戳，避免测试随运行环境时区漂移。 */
const at = (month: number, day: number, hour: number, minute: number) =>
  new Date(2026, month - 1, day, hour, minute, 0, 0).getTime();

describe('会话账本时间跨度格式', () => {
  it('同一天的会话保持短写法', () => {
    expect(formatLedgerClock(at(10, 6, 9, 27), at(10, 6, 10, 54))).toBe('10/6 · 09:27 – 10:54');
  });

  it('跨午夜的会话两端都带日期，用户看到的 10/5 会明确落在起始端', () => {
    const text = formatLedgerClock(at(10, 5, 11, 12), at(10, 6, 8, 49));
    expect(text).toBe('10/5 · 11:12 – 10/6 08:49');
    expect(text).toContain('10/6');
  });

  it('进行中的会话没有结束端', () => {
    expect(formatLedgerClock(at(10, 6, 9, 27), null)).toBe('10/6 · 09:27 – 进行中');
  });

  it('片段行与所属会话同一天时沿用短写法', () => {
    expect(formatLedgerSpan(at(10, 5, 11, 12), at(10, 5, 11, 17), at(10, 5, 11, 12))).toBe(
      '11:12 – 11:17',
    );
  });

  it('片段行跨日时补出远端日期，起始端离会话起始日不同天也补日期', () => {
    expect(formatLedgerSpan(at(10, 5, 23, 40), at(10, 6, 0, 10), at(10, 5, 23, 40))).toBe(
      '23:40 – 10/6 00:10',
    );
    expect(formatLedgerSpan(at(10, 5, 23, 40), null, at(10, 6, 1, 0))).toBe('10/5 23:40 – 进行中');
  });

  it('日期不补零，自然日判定按本地日历', () => {
    expect(formatLedgerDay(at(10, 5, 0, 0))).toBe('10/5');
    expect(formatLedgerDay(at(12, 31, 23, 59))).toBe('12/31');
    expect(isSameLedgerDay(at(10, 5, 0, 0), at(10, 5, 23, 59))).toBe(true);
    expect(isSameLedgerDay(at(10, 5, 23, 59), at(10, 6, 0, 0))).toBe(false);
  });
});
