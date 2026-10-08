import { describe, expect, it } from 'vitest';
import { scopeAnalyticsSource, segmentTaskKey } from '@shared/analyticsScope';
import { buildSessionAnalytics } from '@shared/sessionAnalytics';
import type { FocusSegment, FocusSession, PauseEvent } from '@shared/types';

const MINUTE = 60_000;
const day = new Date(2026, 6, 18, 0, 0, 0, 0).getTime();
const at = (hours: number, minutes = 0) => day + hours * 60 * MINUTE + minutes * MINUTE;

function session(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'session-1',
    title: null,
    status: 'finished',
    startedAt: at(9),
    endedAt: at(10),
    activeElapsedMs: 45 * MINUTE,
    pauseElapsedMs: 15 * MINUTE,
    wallElapsedMs: 60 * MINUTE,
    defaultTaskId: null,
    defaultTaskSource: null,
    defaultTaskTitle: null,
    note: null,
    createdAt: at(9),
    updatedAt: at(10),
    ...overrides,
  };
}

function segment(overrides: Partial<FocusSegment> = {}): FocusSegment {
  return {
    id: 'segment-1',
    sessionId: 'session-1',
    taskId: 'task-1',
    taskSource: 'ticktick',
    title: '有机化学',
    startedAt: at(9),
    endedAt: at(9, 30),
    activeElapsedMs: 30 * MINUTE,
    note: null,
    cloudFocusId: null,
    tomatodoSubject: null,
    createdAt: at(9),
    updatedAt: at(9, 30),
    ...overrides,
  };
}

function pause(overrides: Partial<PauseEvent> = {}): PauseEvent {
  return {
    id: 'pause-1',
    sessionId: 'session-1',
    segmentId: 'segment-1',
    pauseStartedAt: at(9, 30),
    pauseEndedAt: at(9, 45),
    durationMs: 15 * MINUTE,
    reason: null,
    createdAt: at(9, 30),
    updatedAt: at(9, 45),
    ...overrides,
  };
}

describe('segmentTaskKey', () => {
  it('已关联片段用 taskSource:taskId 作为分类 key', () => {
    expect(segmentTaskKey(segment({ taskId: 't1', taskSource: 'local' }))).toBe('local:t1');
    expect(segmentTaskKey(segment({ taskId: 't1', taskSource: 'ticktick' }))).toBe('ticktick:t1');
  });

  it('taskSource 为空时回退到 unknown 前缀', () => {
    expect(segmentTaskKey(segment({ taskId: 't1', taskSource: null }))).toBe('unknown:t1');
  });

  it('未关联片段用标题作为 key，空 / 纯空白标题回退到未关联任务', () => {
    expect(segmentTaskKey(segment({ taskId: null, taskSource: null, title: '数学' }))).toBe(
      'unlinked:数学',
    );
    expect(segmentTaskKey(segment({ taskId: null, taskSource: null, title: null }))).toBe(
      'unlinked:未关联任务',
    );
    expect(segmentTaskKey(segment({ taskId: null, taskSource: null, title: '   ' }))).toBe(
      'unlinked:未关联任务',
    );
  });

  it('未关联片段的标题前后空格会被 trim', () => {
    expect(segmentTaskKey(segment({ taskId: null, taskSource: null, title: '  数学  ' }))).toBe(
      'unlinked:数学',
    );
  });
});

describe('scopeAnalyticsSource', () => {
  it('taskKey 为 null 时原样返回同一引用', () => {
    const source = { sessions: [session()], segments: [segment()], pauses: [pause()] };
    expect(scopeAnalyticsSource(source, null)).toBe(source);
  });

  it('只保留命中片段与其所在会话，没有任何片段的旧会话被丢弃', () => {
    const segA = segment({ id: 'seg-a', sessionId: 's1', taskId: 'a', taskSource: 'local' });
    const segB = segment({ id: 'seg-b', sessionId: 's1', taskId: 'b', taskSource: 'ticktick' });
    const source = {
      sessions: [session({ id: 's1' }), session({ id: 'legacy' })],
      segments: [segA, segB],
      pauses: [],
    };

    const scoped = scopeAnalyticsSource(source, 'local:a');

    expect(scoped.segments).toEqual([segA]);
    expect(scoped.sessions.map((item) => item.id)).toEqual(['s1']);
  });

  it('保持原数组内的相对顺序', () => {
    const first = segment({ id: 'seg-1', sessionId: 's1', taskId: 'a', taskSource: 'local' });
    const middle = segment({ id: 'seg-2', sessionId: 's1', taskId: 'b', taskSource: 'ticktick' });
    const last = segment({ id: 'seg-3', sessionId: 's1', taskId: 'a', taskSource: 'local' });
    const source = {
      sessions: [session({ id: 's1' })],
      segments: [first, middle, last],
      pauses: [],
    };

    expect(scopeAnalyticsSource(source, 'local:a').segments.map((item) => item.id)).toEqual([
      'seg-1',
      'seg-3',
    ]);
  });

  it('暂停按 segmentId 归属：命中保留，指向被丢弃片段则丢弃', () => {
    const segA = segment({ id: 'seg-a', sessionId: 's1', taskId: 'a', taskSource: 'local' });
    const segB = segment({ id: 'seg-b', sessionId: 's1', taskId: 'b', taskSource: 'ticktick' });
    const pauseA = pause({ id: 'p-a', sessionId: 's1', segmentId: 'seg-a' });
    const pauseB = pause({ id: 'p-b', sessionId: 's1', segmentId: 'seg-b' });
    const source = {
      sessions: [session({ id: 's1' })],
      segments: [segA, segB],
      pauses: [pauseA, pauseB],
    };

    expect(scopeAnalyticsSource(source, 'local:a').pauses.map((item) => item.id)).toEqual(['p-a']);
  });

  it('空 segmentId 的暂停归给同会话中在它之前最后一条被保留片段', () => {
    const segA = segment({
      id: 'seg-a',
      sessionId: 's1',
      taskId: 'a',
      taskSource: 'local',
      startedAt: at(9),
    });
    const segB = segment({
      id: 'seg-b',
      sessionId: 's1',
      taskId: 'b',
      taskSource: 'ticktick',
      startedAt: at(10),
    });
    const orphan = pause({
      id: 'p-null',
      sessionId: 's1',
      segmentId: null,
      pauseStartedAt: at(9, 30),
    });
    const source = {
      sessions: [session({ id: 's1' })],
      segments: [segA, segB],
      pauses: [orphan],
    };

    // 09:30 之前最后一条被保留片段是 segA（09:00）→ 归入 A。
    expect(scopeAnalyticsSource(source, 'local:a').pauses.map((item) => item.id)).toEqual([
      'p-null',
    ]);
    // B 分类下 segB 从 10:00 才开始，晚于 09:30 → 找不到归属片段，丢弃。
    expect(scopeAnalyticsSource(source, 'ticktick:b').pauses).toEqual([]);
  });

  it('空 segmentId 的暂停前面没有被保留片段则丢弃', () => {
    const segA = segment({
      id: 'seg-a',
      sessionId: 's1',
      taskId: 'a',
      taskSource: 'local',
      startedAt: at(10),
    });
    const early = pause({ id: 'p-early', sessionId: 's1', segmentId: null, pauseStartedAt: at(9) });
    const source = { sessions: [session({ id: 's1' })], segments: [segA], pauses: [early] };

    expect(scopeAnalyticsSource(source, 'local:a').pauses).toEqual([]);
  });

  it('暂停所属会话没有命中片段时同样丢弃', () => {
    const segA = segment({ id: 'seg-a', sessionId: 's1', taskId: 'a', taskSource: 'local' });
    const orphan = pause({ id: 'p-orphan', sessionId: 's2', segmentId: null });
    const source = { sessions: [session({ id: 's1' })], segments: [segA], pauses: [orphan] };

    expect(scopeAnalyticsSource(source, 'local:a').pauses).toEqual([]);
  });
});

describe('分类筛选端到端', () => {
  const range = {
    start: day,
    end: day + 24 * 60 * MINUTE - 1,
    timelineStart: day,
    timelineEnd: day + 24 * 60 * MINUTE - 1,
  };

  // 两个分类共处一个会话，另有一条没有任何片段的旧记录会话，暂停包含显式归属与空 segmentId 两种。
  function buildSource() {
    const segA = segment({
      id: 'seg-a',
      sessionId: 's1',
      taskId: 'task-a',
      taskSource: 'local',
      title: '数学',
      startedAt: at(9),
      endedAt: at(9, 30),
      activeElapsedMs: 30 * MINUTE,
    });
    const segB = segment({
      id: 'seg-b',
      sessionId: 's1',
      taskId: 'task-b',
      taskSource: 'ticktick',
      title: '英语',
      startedAt: at(10),
      endedAt: at(10, 30),
      activeElapsedMs: 30 * MINUTE,
    });
    const pauseA = pause({
      id: 'p-a',
      sessionId: 's1',
      segmentId: 'seg-a',
      pauseStartedAt: at(9, 30),
      pauseEndedAt: at(9, 45),
      durationMs: 15 * MINUTE,
    });
    const pauseNull = pause({
      id: 'p-null',
      sessionId: 's1',
      segmentId: null,
      pauseStartedAt: at(9, 40),
      pauseEndedAt: at(9, 50),
      durationMs: 10 * MINUTE,
    });
    const pauseB = pause({
      id: 'p-b',
      sessionId: 's1',
      segmentId: 'seg-b',
      pauseStartedAt: at(10, 30),
      pauseEndedAt: at(10, 45),
      durationMs: 15 * MINUTE,
    });
    return {
      sessions: [
        session({
          id: 's1',
          startedAt: at(9),
          endedAt: at(10, 45),
          wallElapsedMs: 105 * MINUTE,
          activeElapsedMs: 60 * MINUTE,
          pauseElapsedMs: 40 * MINUTE,
        }),
        session({
          id: 'legacy',
          startedAt: at(14),
          endedAt: at(14, 5),
          wallElapsedMs: 5 * MINUTE,
          activeElapsedMs: 0,
          pauseElapsedMs: 0,
        }),
      ],
      segments: [segA, segB],
      pauses: [pauseA, pauseNull, pauseB],
    };
  }

  it('只属于 A 的 totals / daily / hourly / tasks 与暂停都收窄正确', () => {
    const source = buildSource();
    const result = buildSessionAnalytics(range, scopeAnalyticsSource(source, 'local:task-a'));

    expect(result.totals.activeMs).toBe(30 * MINUTE);
    expect(result.totals.pauseMs).toBe(25 * MINUTE);
    expect(result.daily[0].activeMs).toBe(30 * MINUTE);
    expect(result.daily.reduce((sum, item) => sum + item.activeMs, 0)).toBe(30 * MINUTE);
    expect(result.hourly.reduce((sum, item) => sum + item.activeMs, 0)).toBe(30 * MINUTE);
    expect(result.hourly.reduce((sum, item) => sum + item.pauseMs, 0)).toBe(25 * MINUTE);
    expect(result.tasks.map((task) => task.key)).toEqual(['local:task-a']);
    expect(result.tasks[0].title).toBe('数学');
    expect(result.tasks[0].activeMs).toBe(30 * MINUTE);
  });

  it('各分类 focus / pause 之和等于全量（无片段旧会话不贡献时长）', () => {
    const source = buildSource();
    const full = buildSessionAnalytics(range, source);
    const a = buildSessionAnalytics(range, scopeAnalyticsSource(source, 'local:task-a'));
    const b = buildSessionAnalytics(range, scopeAnalyticsSource(source, 'ticktick:task-b'));

    expect(full.totals.activeMs).toBe(60 * MINUTE);
    expect(full.totals.pauseMs).toBe(40 * MINUTE);
    expect(a.totals.activeMs + b.totals.activeMs).toBe(full.totals.activeMs);
    expect(a.totals.pauseMs + b.totals.pauseMs).toBe(full.totals.pauseMs);
    // 空 segmentId 的暂停只应被算进一次（A），B 分类不含它。
    expect(a.totals.pauseMs).toBe(25 * MINUTE);
    expect(b.totals.pauseMs).toBe(15 * MINUTE);
  });

  it('无片段旧会话不属于任何分类', () => {
    const source = buildSource();
    const result = buildSessionAnalytics(range, scopeAnalyticsSource(source, 'local:task-a'));
    expect(result.sessions.map((item) => item.id)).toEqual(['s1']);
  });
});
