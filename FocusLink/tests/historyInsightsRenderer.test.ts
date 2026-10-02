import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildSessionAnalytics } from '@shared/sessionAnalytics';
import type { FocusSegment, FocusSession, PauseEvent } from '@shared/types';
import { HistoryInsights } from '../src/features/history/HistoryInsights';
import { summarizeAnalyticsRange } from '../src/features/history/historyStats';

describe('desktop history insights presentation', () => {
  it('renders empty real-data cards without arbitrary target scores', () => {
    const selectedStart = new Date(2026, 6, 21, 0, 0, 0, 0).getTime();
    const selectedEnd = new Date(2026, 6, 21, 23, 59, 59, 999).getTime();
    const analytics = buildSessionAnalytics(
      {
        start: selectedStart,
        end: selectedEnd,
        timelineStart: selectedStart,
        timelineEnd: selectedEnd,
      },
      { sessions: [], segments: [], pauses: [] },
    );
    const summary = summarizeAnalyticsRange(analytics.daily, 0);

    const markup = renderToStaticMarkup(
      createElement(HistoryInsights, {
        summary,
        range: { start: selectedStart, end: selectedEnd },
        analytics,
        slideDirection: 0,
        onSelectRange: () => undefined,
      }),
    );

    // 验证 5 大固定卡贴
    expect(markup).toContain('id="tileHero"');
    expect(markup).toContain('id="tileRhythm"');
    expect(markup).toContain('id="tileDonut"');
    expect(markup).toContain('id="tileRanking"');
    expect(markup).toContain('id="tileHeatmap"');

    // 验证 卡贴一：全景仪表与胶囊
    expect(markup).not.toContain('hero-dial-svg');
    expect(markup).not.toContain('参考目标');
    expect(markup).toContain('专注时长');
    expect(markup).toContain('关联任务');
    expect(markup).toContain('连续记录');

    // 验证 卡贴二：24h精力节律与5大时段胶囊
    expect(markup).toContain('按小时分布');
    expect(markup).toContain('bars-row');
    expect(markup).toContain('period-capsule-row');
    expect(markup).toContain('上午');
    expect(markup).toContain('下午');

    // 验证 卡贴三：分类占比
    expect(markup).toContain('清单分类投入占比');
    expect(markup).toContain('donut-svg-wrap');

    // 验证 卡贴四：重点任务排行榜
    expect(markup).toContain('重点任务专注排行');
    expect(markup).toContain('leaderboard-container');

    // 验证 卡贴五：心流热力矩阵
    expect(markup).toContain('每日记录');
    expect(markup).toContain('heatmap-strip-wrap');
  });

  it('keeps a cross-midnight session visible and computes clipped focus time', () => {
    const previousDay = new Date(2026, 6, 20, 23, 50, 0, 0).getTime();
    const selectedStart = new Date(2026, 6, 21, 0, 0, 0, 0).getTime();
    const selectedEnd = new Date(2026, 6, 21, 23, 59, 59, 999).getTime();
    const session: FocusSession = {
      id: 'cross-midnight',
      title: '跨午夜复习',
      status: 'finished',
      startedAt: previousDay,
      endedAt: previousDay + 30 * 60_000,
      activeElapsedMs: 30 * 60_000,
      pauseElapsedMs: 0,
      wallElapsedMs: 30 * 60_000,
      defaultTaskId: 'task-1',
      defaultTaskSource: 'ticktick',
      defaultTaskTitle: '跨午夜复习',
      note: null,
      createdAt: previousDay,
      updatedAt: previousDay + 30 * 60_000,
    };
    const segment: FocusSegment = {
      id: 'segment-1',
      sessionId: session.id,
      taskId: 'task-1',
      taskSource: 'ticktick',
      title: '跨午夜复习',
      startedAt: previousDay,
      endedAt: previousDay + 30 * 60_000,
      activeElapsedMs: 30 * 60_000,
      note: null,
      tomatodoSubject: null,
      cloudFocusId: null,
      createdAt: previousDay,
      updatedAt: previousDay + 30 * 60_000,
    };
    const analytics = buildSessionAnalytics(
      {
        start: selectedStart,
        end: selectedEnd,
        timelineStart: selectedStart,
        timelineEnd: selectedEnd,
      },
      { sessions: [session], segments: [segment], pauses: [] },
    );
    const summary = summarizeAnalyticsRange(analytics.daily, analytics.sessions.length);

    expect(analytics.sessions.map((item) => item.id)).toEqual(['cross-midnight']);
    expect(summary).toMatchObject({ count: 1, active: 20 * 60_000, wall: 20 * 60_000 });

    const markup = renderToStaticMarkup(
      createElement(HistoryInsights, {
        summary,
        range: { start: selectedStart, end: selectedEnd },
        analytics,
        slideDirection: 0,
        onSelectRange: () => undefined,
      }),
    );
    expect(markup).toContain('跨午夜复习');
    expect(markup).toContain('专注时长');
    expect(markup).toContain('00:00–00:20');
    expect(markup).toContain('清单分类投入占比');
    expect(markup).toContain('按小时分布');
  });

  it('renders single-day focus session data with tasks and spectrum', () => {
    const selectedStart = new Date(2026, 6, 22, 0, 0, 0, 0).getTime();
    const selectedEnd = new Date(2026, 6, 22, 23, 59, 59, 999).getTime();
    const startedAt = selectedStart + 9 * 60 * 60_000;
    const endedAt = selectedStart + 10 * 60 * 60_000;
    const focusSession: FocusSession = {
      id: 'focus-session',
      title: '结构化复习',
      status: 'finished',
      startedAt,
      endedAt,
      activeElapsedMs: 50 * 60_000,
      pauseElapsedMs: 10 * 60_000,
      wallElapsedMs: 60 * 60_000,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
      note: null,
      createdAt: startedAt,
      updatedAt: endedAt,
    };
    const focusSegment: FocusSegment = {
      id: 'focus-segment',
      sessionId: focusSession.id,
      taskId: null,
      taskSource: null,
      title: '结构化复习',
      startedAt,
      endedAt,
      activeElapsedMs: 50 * 60_000,
      note: null,
      tomatodoSubject: null,
      cloudFocusId: null,
      createdAt: startedAt,
      updatedAt: endedAt,
    };
    const pause: PauseEvent = {
      id: 'pause-1',
      sessionId: focusSession.id,
      segmentId: focusSegment.id,
      pauseStartedAt: startedAt + 20 * 60_000,
      pauseEndedAt: startedAt + 30 * 60_000,
      durationMs: 10 * 60_000,
      reason: null,
      createdAt: startedAt,
      updatedAt: endedAt,
    };
    const analytics = buildSessionAnalytics(
      {
        start: selectedStart,
        end: selectedEnd,
        timelineStart: selectedStart,
        timelineEnd: selectedEnd,
      },
      { sessions: [focusSession], segments: [focusSegment], pauses: [pause] },
      selectedEnd + 1,
    );
    const summary = summarizeAnalyticsRange(analytics.daily, analytics.sessions.length);
    const markup = renderToStaticMarkup(
      createElement(HistoryInsights, {
        summary,
        range: { start: selectedStart, end: selectedEnd },
        analytics,
        slideDirection: 1,
        onSelectRange: () => undefined,
      }),
    );

    expect(markup).toContain('结构化复习');
    expect(markup).toContain('spectrum-bar-wrap');
    expect(markup).toContain('focus-summary');
    const spectrum = markup.match(/id="spectrumBar"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    expect(spectrum).toContain('aria-label="专注');
    expect(spectrum).not.toMatch(/>\d+ 分钟</);
  });

  it('renders clean dashboard when no sessions exist', () => {
    const now = Date.now();
    const selectedStart = new Date(now).setHours(0, 0, 0, 0);
    const selectedEnd = new Date(now).setHours(23, 59, 59, 999);
    const analytics = buildSessionAnalytics(
      { start: selectedStart, end: selectedEnd },
      { sessions: [], segments: [], pauses: [] },
      now,
    );
    const markup = renderToStaticMarkup(
      createElement(HistoryInsights, {
        summary: summarizeAnalyticsRange(analytics.daily, 0),
        range: { start: selectedStart, end: selectedEnd },
        analytics,
        slideDirection: 0,
        onSelectRange: () => undefined,
      }),
    );

    expect(markup).toContain('id="tileHero"');
    expect(markup).toContain('id="tileRhythm"');
    expect(analytics.dayLedgers[0].totals.gapMs).toBe(0);
  });

  it('renders multi-day mode with daily columns in the rhythm instrument', () => {
    const selectedStart = new Date(2026, 6, 24, 0, 0, 0, 0).getTime();
    const nextDay = new Date(2026, 6, 25, 0, 0, 0, 0).getTime();
    const selectedEnd = new Date(2026, 6, 25, 23, 59, 59, 999).getTime();
    const sessions: FocusSession[] = [
      {
        id: 'day-one',
        title: '第一天',
        status: 'finished',
        startedAt: selectedStart + 9 * 60 * 60_000,
        endedAt: selectedStart + 10 * 60 * 60_000,
        activeElapsedMs: 60 * 60_000,
        pauseElapsedMs: 0,
        wallElapsedMs: 60 * 60_000,
        defaultTaskId: 'task-1',
        defaultTaskSource: 'local',
        defaultTaskTitle: '第一天',
        note: null,
        createdAt: selectedStart,
        updatedAt: selectedStart + 10 * 60 * 60_000,
      },
      {
        id: 'day-two',
        title: '第二天',
        status: 'finished',
        startedAt: nextDay + 10 * 60 * 60_000,
        endedAt: nextDay + 11 * 60 * 60_000,
        activeElapsedMs: 45 * 60_000,
        pauseElapsedMs: 15 * 60_000,
        wallElapsedMs: 60 * 60_000,
        defaultTaskId: 'task-2',
        defaultTaskSource: 'local',
        defaultTaskTitle: '第二天',
        note: null,
        createdAt: nextDay,
        updatedAt: nextDay + 11 * 60 * 60_000,
      },
    ];
    const segments: FocusSegment[] = [
      {
        id: 'day-one-segment',
        sessionId: 'day-one',
        taskId: 'task-1',
        taskSource: 'local',
        title: '第一天',
        startedAt: selectedStart + 9 * 60 * 60_000,
        endedAt: selectedStart + 10 * 60 * 60_000,
        activeElapsedMs: 60 * 60_000,
        note: null,
        tomatodoSubject: null,
        cloudFocusId: null,
        createdAt: selectedStart,
        updatedAt: selectedStart + 10 * 60 * 60_000,
      },
      {
        id: 'day-two-segment',
        sessionId: 'day-two',
        taskId: 'task-2',
        taskSource: 'local',
        title: '第二天',
        startedAt: nextDay + 10 * 60 * 60_000,
        endedAt: nextDay + 11 * 60 * 60_000,
        activeElapsedMs: 45 * 60_000,
        note: null,
        tomatodoSubject: null,
        cloudFocusId: null,
        createdAt: nextDay,
        updatedAt: nextDay + 11 * 60 * 60_000,
      },
    ];
    const pauses: PauseEvent[] = [
      {
        id: 'day-two-pause',
        sessionId: 'day-two',
        segmentId: 'day-two-segment',
        pauseStartedAt: nextDay + 10.5 * 60 * 60_000,
        pauseEndedAt: nextDay + 10.75 * 60 * 60_000,
        durationMs: 15 * 60_000,
        reason: null,
        createdAt: nextDay,
        updatedAt: nextDay + 11 * 60 * 60_000,
      },
    ];
    const analytics = buildSessionAnalytics(
      { start: selectedStart, end: selectedEnd },
      { sessions, segments, pauses },
      selectedEnd + 1,
    );
    const markup = renderToStaticMarkup(
      createElement(HistoryInsights, {
        summary: summarizeAnalyticsRange(analytics.daily, analytics.sessions.length),
        range: { start: selectedStart, end: selectedEnd },
        analytics,
        slideDirection: 1,
        onSelectRange: () => undefined,
        multiDayMode: true,
      }),
    );

    expect(markup).toContain('id="rhythmBarContainer"');
    expect(markup).toContain('bars-row');
  });
});
