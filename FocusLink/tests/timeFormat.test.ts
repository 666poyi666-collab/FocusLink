// 绝对时刻字段的格式契约。
// 背景：TimerPanel 与 TemporalRibbon 曾各自调用 toLocaleTimeString('zh-CN')，
// 而 zh-CN 的 h24 循环把午夜渲染成 24:00（时间之带还会带秒 → 24:00:00），
// 与同一组件里 wallClockTickLabel 的 00:00 刻度标签自相矛盾。
// 共享 formatClock / formatClockSeconds 用手工拼装替代 locale API，这里锁定该行为。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatClock, formatClockSeconds } from '../src/lib/time';

/** 用本地时间构造 epoch，避免测试受运行环境时区影响。 */
const at = (h: number, m: number, s: number) => new Date(2026, 8, 10, h, m, s, 0).getTime();

describe('formatClock（绝对时刻 HH:MM）', () => {
  it('午夜输出 00:00，而不是 zh-CN h24 的 24:00', () => {
    expect(formatClock(at(0, 0, 0))).toBe('00:00');
  });

  it('补零到两位小时与分钟', () => {
    expect(formatClock(at(9, 5, 0))).toBe('09:05');
    expect(formatClock(at(23, 59, 59))).toBe('23:59');
  });

  it('秒不影响 HH:MM', () => {
    expect(formatClock(at(14, 30, 0))).toBe(formatClock(at(14, 30, 59)));
  });
});

describe('formatClockSeconds（绝对时刻 HH:MM:SS）', () => {
  it('午夜输出 00:00:00（回归：旧 locale 实现给出 24:00:00）', () => {
    expect(formatClockSeconds(at(0, 0, 0))).toBe('00:00:00');
  });

  it('一天内的边界与常规值均补零', () => {
    expect(formatClockSeconds(at(0, 0, 1))).toBe('00:00:01');
    expect(formatClockSeconds(at(9, 5, 7))).toBe('09:05:07');
    expect(formatClockSeconds(at(23, 59, 59))).toBe('23:59:59');
  });

  it('永不输出 h24 的 24 时', () => {
    for (let h = 0; h < 24; h += 1) {
      expect(formatClockSeconds(at(h, 0, 0)).startsWith('24')).toBe(false);
    }
  });

  it('与 formatClock 的 HH:MM 部分一致（同一时刻两处字段必须对得上）', () => {
    for (const [h, m, s] of [
      [0, 0, 0],
      [7, 3, 9],
      [12, 0, 30],
      [23, 59, 59],
    ] as const) {
      expect(formatClockSeconds(at(h, m, s)).slice(0, 5)).toBe(formatClock(at(h, m, s)));
    }
  });
});

describe('时间字段不得各自分叉（源码契约）', () => {
  const focusDir = resolve('src/features/focus');
  const ribbon = readFileSync(resolve(focusDir, 'TemporalRibbon.tsx'), 'utf8');
  const panel = readFileSync(resolve(focusDir, 'TimerPanel.tsx'), 'utf8');

  it('时间之带的实时时钟走共享 formatClockSeconds，不用 locale API', () => {
    expect(ribbon).toContain('formatClockSeconds');
    // 允许在注释里提到历史实现，但不允许真的调用
    expect(ribbon).not.toMatch(/=\s*new Date\([^)]*\)\.toLocaleTimeString/);
  });

  it('时间之带不再自带时长格式化实现，统一用共享 formatDurationPadded', () => {
    expect(ribbon).toContain("from '../../lib/time'");
    expect(ribbon).not.toMatch(/function formatElapsedSeconds\(/);
    expect(ribbon).not.toMatch(
      /const minutes = Math\.floor\(totalSeconds \/ 60\);\s*\n\s*const seconds = totalSeconds % 60;/,
    );
  });

  it('工作台与时间之带引用同一组共享格式化函数', () => {
    // 只断言「真的调用了共享函数」，不锁死 import 语句的书写形式。
    // 分工：时长一律 formatDurationPadded；绝对时刻到分钟用 formatClock（工作台），
    // 到秒用 formatClockSeconds（时间之带的实时时钟）。
    for (const [name, source] of [
      ['TimerPanel', panel],
      ['TemporalRibbon', ribbon],
    ] as const) {
      expect(source, `${name} 未使用共享 formatDurationPadded`).toContain('formatDurationPadded(');
    }
    expect(panel, 'TimerPanel 的绝对时刻应走共享 formatClock').toContain('formatClock(');
    expect(ribbon, 'TemporalRibbon 的实时时钟应走共享 formatClockSeconds').toContain(
      'formatClockSeconds(',
    );
  });

  it('工作台的时长与时间之带同口径（都补零，不再出现 0:08 与 00:08 并存）', () => {
    // 曾经：工作台用 formatDuration（分钟不补零 → 0:08），时间之带/仪表用
    // formatDurationPadded（00:08），同一屏两种写法。
    expect(panel).not.toMatch(/[^d]formatDuration\(/);
    expect(ribbon).not.toMatch(/[^d]formatDuration\(/);
  });
});
