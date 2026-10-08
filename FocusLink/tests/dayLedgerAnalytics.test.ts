import { describe, expect, it } from 'vitest';
import { buildCalendarDayLedger, buildDayLedger } from '@shared/dayLedgerAnalytics';
import type { FocusSegment, FocusSession, PauseEvent } from '@shared/types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const day = new Date(2026, 6, 30, 0, 0, 0, 0).getTime();
const at = (hours: number, minutes = 0) => day + hours * HOUR + minutes * MINUTE;

function session(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'session-1',
    title: null,
    status: 'finished',
    startedAt: at(9),
    endedAt: at(10),
    activeElapsedMs: 50 * MINUTE,
    pauseElapsedMs: 10 * MINUTE,
    wallElapsedMs: HOUR,
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
    taskId: null,
    taskSource: null,
    title: null,
    startedAt: at(9),
    endedAt: at(10),
    activeElapsedMs: 50 * MINUTE,
    note: null,
    cloudFocusId: null,
    tomatodoSubject: null,
    createdAt: at(9),
    updatedAt: at(10),
    ...overrides,
  };
}

function pause(overrides: Partial<PauseEvent> = {}): PauseEvent {
  return {
    id: 'pause-1',
    sessionId: 'session-1',
    segmentId: 'segment-1',
    pauseStartedAt: at(9, 20),
    pauseEndedAt: at(9, 30),
    durationMs: 10 * MINUTE,
    reason: null,
    createdAt: at(9, 20),
    updatedAt: at(9, 30),
    ...overrides,
  };
}

describe('buildDayLedger effective-day contract', () => {
  it('counts all 02:55:16 of a night-time record in calendar-day statistics', () => {
    const elapsed = 10_516_000;
    const source = {
      sessions: [
        session({
          startedAt: at(0),
          endedAt: at(0) + elapsed,
          activeElapsedMs: elapsed,
          pauseElapsedMs: 0,
          wallElapsedMs: elapsed,
        }),
      ],
      segments: [segment({ startedAt: at(0), endedAt: at(0) + elapsed, activeElapsedMs: elapsed })],
      pauses: [],
    };
    const result = buildCalendarDayLedger({ day, now: at(6) }, source);
    expect(result.totals.focusMs).toBe(elapsed);
    expect(result.totals.estimatedFocusMs).toBe(0);
    expect(result.status).toBe('observed');
    expect(result.tasks[0].activeMs).toBe(elapsed);
  });

  it('splits a midnight-crossing record without losing or duplicating time', () => {
    const source = {
      sessions: [
        session({
          startedAt: at(23),
          endedAt: at(25),
          activeElapsedMs: 2 * HOUR,
          pauseElapsedMs: 0,
          wallElapsedMs: 2 * HOUR,
        }),
      ],
      segments: [segment({ startedAt: at(23), endedAt: at(25), activeElapsedMs: 2 * HOUR })],
      pauses: [],
    };
    const first = buildCalendarDayLedger({ day, now: at(36) }, source);
    const second = buildCalendarDayLedger({ day: at(24), now: at(36) }, source);
    expect(first.totals.focusMs).toBe(HOUR);
    expect(second.totals.focusMs).toBe(HOUR);
    expect(first.totals.estimatedFocusMs + second.totals.estimatedFocusMs).toBe(0);
  });

  it('does not turn a no-focus day into fifteen hours of fake gap', () => {
    const result = buildDayLedger({ day, now: at(12) }, { sessions: [], segments: [], pauses: [] });

    expect(result.status).toBe('not-started');
    expect(result.observationStartedAt).toBeNull();
    expect(result.intervals).toEqual([]);
    expect(result.sessionFocus).toEqual([]);
    expect(result.totals).toMatchObject({ focusMs: 0, pauseMs: 0, gapMs: 0, observationMs: 0 });
  });

  it('keeps the literal today endpoint before 07:00 without creating a negative window', () => {
    const result = buildDayLedger({ day, now: at(6) }, { sessions: [], segments: [], pauses: [] });

    expect(result.effectiveStartedAt).toBe(at(7));
    expect(result.effectiveEndedAt).toBe(at(6));
    expect(result.observationEndedAt).toBe(at(6));
    expect(result.status).toBe('not-started');
    expect(result.intervals).toEqual([]);
  });

  it('starts at the first real focus and ends at now today, including trailing gap', () => {
    const result = buildDayLedger(
      { day, now: at(12) },
      { sessions: [session()], segments: [segment()], pauses: [pause()] },
    );

    expect(result.observationStartedAt).toBe(at(9));
    expect(result.observationEndedAt).toBe(at(12));
    expect(result.intervals.map((item) => [item.kind, item.durationMs])).toEqual([
      ['focus', 20 * MINUTE],
      ['pause', 10 * MINUTE],
      ['focus', 30 * MINUTE],
      ['gap', 2 * HOUR],
    ]);
    expect(result.gaps).toHaveLength(1);
    expect(result.tasks).toEqual([
      {
        key: 'unlinked:未关联任务',
        taskId: null,
        title: '未关联任务',
        activeMs: 50 * MINUTE,
        segmentCount: 1,
        estimated: false,
      },
    ]);
    expect(result.sessionFocus).toEqual([
      { sessionId: 'session-1', focusMs: 50 * MINUTE, estimated: false },
    ]);
    expect(result.totals).toEqual({
      focusMs: 50 * MINUTE,
      pauseMs: 10 * MINUTE,
      gapMs: 2 * HOUR,
      observationMs: 3 * HOUR,
      estimatedFocusMs: 0,
      estimatedPauseMs: 0,
    });
  });

  it('uses 22:00 as the historical observation end and keeps the categories conservative', () => {
    const result = buildDayLedger(
      { day, now: day + 3 * 24 * HOUR },
      { sessions: [session()], segments: [segment()], pauses: [pause()] },
    );

    expect(result.isToday).toBe(false);
    expect(result.observationEndedAt).toBe(at(22));
    expect(result.totals.gapMs).toBe(12 * HOUR);
    expect(result.totals.focusMs + result.totals.pauseMs + result.totals.gapMs).toBe(
      result.totals.observationMs,
    );
  });

  it('clips 00:00–07:00 and 22:00–24:00 as non-statistical background', () => {
    const early = session({
      id: 'early',
      startedAt: at(6, 30),
      endedAt: at(7, 30),
      activeElapsedMs: HOUR,
      pauseElapsedMs: 0,
      wallElapsedMs: HOUR,
    });
    const late = session({
      id: 'late',
      startedAt: at(21, 30),
      endedAt: at(22, 30),
      activeElapsedMs: HOUR,
      pauseElapsedMs: 0,
      wallElapsedMs: HOUR,
    });
    const result = buildDayLedger(
      { day, now: day + 24 * HOUR },
      {
        sessions: [early, late],
        segments: [
          segment({
            id: 'early-segment',
            sessionId: early.id,
            startedAt: early.startedAt,
            endedAt: early.endedAt,
            activeElapsedMs: HOUR,
          }),
          segment({
            id: 'late-segment',
            sessionId: late.id,
            startedAt: late.startedAt,
            endedAt: late.endedAt,
            activeElapsedMs: HOUR,
          }),
        ],
        pauses: [],
      },
    );

    expect(result.observationStartedAt).toBe(at(7));
    expect(result.totals.focusMs).toBe(HOUR);
    expect(result.tasks.reduce((total, task) => total + task.activeMs, 0)).toBe(HOUR);
    expect(result.sessionFocus).toEqual([
      { sessionId: 'early', focusMs: 30 * MINUTE, estimated: false },
      { sessionId: 'late', focusMs: 30 * MINUTE, estimated: false },
    ]);
    expect(result.intervals.at(-1)).toMatchObject({ kind: 'focus', endedAt: at(22) });
  });

  it('treats exact 07:00 and 22:00 as hard inclusion and exclusion boundaries', () => {
    const sessions = [
      session({
        id: 'before',
        startedAt: at(6, 30),
        endedAt: at(7),
        activeElapsedMs: 30 * MINUTE,
        pauseElapsedMs: 0,
        wallElapsedMs: 30 * MINUTE,
      }),
      session({
        id: 'opening',
        startedAt: at(7),
        endedAt: at(7, 30),
        activeElapsedMs: 30 * MINUTE,
        pauseElapsedMs: 0,
        wallElapsedMs: 30 * MINUTE,
      }),
      session({
        id: 'closing',
        startedAt: at(21, 30),
        endedAt: at(22),
        activeElapsedMs: 30 * MINUTE,
        pauseElapsedMs: 0,
        wallElapsedMs: 30 * MINUTE,
      }),
      session({
        id: 'after',
        startedAt: at(22),
        endedAt: at(22, 30),
        activeElapsedMs: 30 * MINUTE,
        pauseElapsedMs: 0,
        wallElapsedMs: 30 * MINUTE,
      }),
    ];
    const result = buildDayLedger(
      { day, now: day + 24 * HOUR },
      {
        sessions,
        segments: sessions.map((item) =>
          segment({
            id: `${item.id}-segment`,
            sessionId: item.id,
            startedAt: item.startedAt,
            endedAt: item.endedAt,
            activeElapsedMs: 30 * MINUTE,
          }),
        ),
        pauses: [],
      },
    );

    expect(result.observationStartedAt).toBe(at(7));
    expect(result.observationEndedAt).toBe(at(22));
    expect(result.totals).toMatchObject({
      focusMs: HOUR,
      pauseMs: 0,
      gapMs: 14 * HOUR,
      observationMs: 15 * HOUR,
    });
    expect(result.sessionFocus.map((item) => item.sessionId)).toEqual(['closing', 'opening']);
    expect(result.tasks.reduce((total, task) => total + task.activeMs, 0)).toBe(HOUR);
  });
});

describe('buildDayLedger interval normalization', () => {
  it('unions overlapping segments and gives real pause events classification precedence', () => {
    const result = buildDayLedger(
      { day, now: at(11) },
      {
        sessions: [session()],
        segments: [
          segment({ id: 'a', startedAt: at(9), endedAt: at(10), activeElapsedMs: HOUR }),
          segment({ id: 'b', startedAt: at(9, 30), endedAt: at(10, 30), activeElapsedMs: HOUR }),
        ],
        pauses: [
          pause({ pauseStartedAt: at(9, 45), pauseEndedAt: at(10, 15), durationMs: 30 * MINUTE }),
        ],
      },
    );

    expect(result.totals).toMatchObject({
      focusMs: HOUR,
      pauseMs: 30 * MINUTE,
      gapMs: 30 * MINUTE,
      observationMs: 2 * HOUR,
    });
    expect(result.totals.focusMs + result.totals.pauseMs + result.totals.gapMs).toBe(
      result.totals.observationMs,
    );
  });

  it('clips a cross-midnight segment independently on each local day', () => {
    const previousDay = new Date(2026, 6, 29, 0, 0, 0, 0).getTime();
    const cross = session({
      id: 'cross',
      startedAt: previousDay + 21.5 * HOUR,
      endedAt: at(7, 30),
      activeElapsedMs: 10 * HOUR,
      pauseElapsedMs: 0,
      wallElapsedMs: 10 * HOUR,
    });
    const result = buildDayLedger(
      { day, now: day + 24 * HOUR },
      {
        sessions: [cross],
        segments: [
          segment({
            id: 'cross-segment',
            sessionId: cross.id,
            startedAt: cross.startedAt,
            endedAt: cross.endedAt,
            activeElapsedMs: cross.activeElapsedMs,
          }),
        ],
        pauses: [],
      },
    );

    expect(result.observationStartedAt).toBe(at(7));
    expect(result.totals.focusMs).toBe(30 * MINUTE);
    expect(result.totals.gapMs).toBe(14.5 * HOUR);
    expect(result.tasks[0].activeMs).toBe(30 * MINUTE);
  });

  it('extends a real running segment to now and an open pause to now when paused', () => {
    const runningSession = session({ status: 'active', endedAt: null, wallElapsedMs: 45 * MINUTE });
    const running = buildDayLedger(
      { day, now: at(9, 45) },
      {
        sessions: [runningSession],
        segments: [segment({ endedAt: null, activeElapsedMs: 45 * MINUTE })],
        pauses: [],
      },
    );
    expect(running.totals).toMatchObject({ focusMs: 45 * MINUTE, pauseMs: 0, gapMs: 0 });

    const pausedSession = session({ status: 'active', endedAt: null, wallElapsedMs: 45 * MINUTE });
    const paused = buildDayLedger(
      { day, now: at(9, 45) },
      {
        sessions: [pausedSession],
        segments: [segment({ endedAt: null, activeElapsedMs: 30 * MINUTE })],
        pauses: [pause({ pauseStartedAt: at(9, 30), pauseEndedAt: null, durationMs: 15 * MINUTE })],
      },
    );
    expect(paused.totals).toMatchObject({
      focusMs: 30 * MINUTE,
      pauseMs: 15 * MINUTE,
      gapMs: 0,
    });
  });

  it('marks duration-only legacy rows as estimated without inventing timeline intervals', () => {
    const legacy = session({ activeElapsedMs: 40 * MINUTE, pauseElapsedMs: 20 * MINUTE });
    const result = buildDayLedger(
      { day, now: day + 24 * HOUR },
      { sessions: [legacy], segments: [], pauses: [] },
    );

    expect(result.status).toBe('estimated-only');
    expect(result.estimated).toBe(true);
    expect(result.observationStartedAt).toBeNull();
    expect(result.intervals).toEqual([]);
    expect(result.tasks).toEqual([]);
    expect(result.sessionFocus).toEqual([
      { sessionId: 'session-1', focusMs: 40 * MINUTE, estimated: true },
    ]);
    expect(result.totals).toMatchObject({
      focusMs: 0,
      pauseMs: 0,
      gapMs: 0,
      estimatedFocusMs: 40 * MINUTE,
      estimatedPauseMs: 20 * MINUTE,
    });
  });

  it('does not spread yesterday focus into today when only the pause crosses midnight', () => {
    const crossNight = session({
      id: 'cross-night',
      startedAt: at(-2), // 前一天 22:00
      endedAt: at(8), // 今天 08:00
      activeElapsedMs: 40 * MINUTE,
      pauseElapsedMs: 9 * HOUR + 20 * MINUTE,
      wallElapsedMs: 10 * HOUR,
    });
    const source = {
      sessions: [crossNight],
      segments: [
        segment({
          id: 'segment-cross',
          sessionId: 'cross-night',
          startedAt: at(-2),
          endedAt: at(-2) + 40 * MINUTE,
          activeElapsedMs: 40 * MINUTE,
        }),
      ],
      pauses: [
        pause({
          id: 'pause-cross',
          sessionId: 'cross-night',
          segmentId: 'segment-cross',
          pauseStartedAt: at(-2) + 40 * MINUTE,
          pauseEndedAt: at(8),
          durationMs: 9 * HOUR + 20 * MINUTE,
        }),
      ],
    };

    /* 今天只有那条跨夜暂停，专注全是昨天的：不得再按墙钟比例摊一份「估算专注」到今天。
       v1.6.0：暂停也按自然日 0 点切分，所以今天「有观察记录」（00:00–08:00 的暂停），
       状态从 not-started 变成 observed —— 但专注仍然是 0、且不得变成估算值。 */
    const today = buildCalendarDayLedger({ day, now: at(10) }, source);
    expect(today.status).toBe('observed');
    expect(today.estimated).toBe(false);
    expect(today.sessionFocus).toEqual([]);
    expect(today.totals).toMatchObject({
      focusMs: 0,
      pauseMs: 8 * HOUR,
      estimatedFocusMs: 0,
      estimatedPauseMs: 0,
    });

    // 昨天仍然是精确记录：40 分钟专注 + 80 分钟（22:40–24:00）暂停，不是估算值。
    const yesterday = buildCalendarDayLedger({ day: day - 24 * HOUR, now: at(10) }, source);
    expect(yesterday.totals).toMatchObject({
      focusMs: 40 * MINUTE,
      pauseMs: 80 * MINUTE,
      estimatedFocusMs: 0,
      estimatedPauseMs: 0,
    });
    expect(yesterday.sessionFocus).toEqual([
      { sessionId: 'cross-night', focusMs: 40 * MINUTE, estimated: false },
    ]);
  });
});

describe('buildCalendarDayLedger record-bounded observation (1.3.1 side-effect fix)', () => {
  it('does not count night-time sleep as gap for an early-morning record (02:55:16 sample)', () => {
    const start = at(2) + 55 * 60_000 + 16_000; // 02:55:16
    const elapsed = 44_000; // ends 02:56:00
    const source = {
      sessions: [
        session({
          startedAt: start,
          endedAt: start + elapsed,
          activeElapsedMs: elapsed,
          pauseElapsedMs: 0,
          wallElapsedMs: elapsed,
        }),
      ],
      segments: [segment({ startedAt: start, endedAt: start + elapsed, activeElapsedMs: elapsed })],
      pauses: [],
    };
    const result = buildCalendarDayLedger({ day, now: at(36) }, source);

    expect(result.status).toBe('observed');
    expect(result.totals.focusMs).toBe(elapsed);
    expect(result.observationStartedAt).toBe(start);
    expect(result.observationEndedAt).toBe(start + elapsed);
    expect(result.totals.gapMs).toBe(0);
    expect(result.totals.observationMs).toBe(elapsed);
    expect(result.intervals.every((interval) => interval.kind === 'focus')).toBe(true);
  });

  it('keeps focus + pause + gap = observation after record-bounded capping', () => {
    const source = {
      sessions: [session()],
      segments: [segment()],
      pauses: [pause()],
    };
    const result = buildCalendarDayLedger({ day, now: at(36) }, source);

    expect(result.totals.focusMs + result.totals.pauseMs + result.totals.gapMs).toBe(
      result.totals.observationMs,
    );
    expect(result.observationStartedAt).toBe(at(9));
    expect(result.observationEndedAt).toBe(at(10)); // last real record (pause) ends at 10:00
    expect(result.totals.gapMs).toBe(0); // no gap inside 09:00–10:00
  });

  it('does not fabricate a full-day gap on an empty calendar day', () => {
    const result = buildCalendarDayLedger(
      { day, now: at(36) },
      { sessions: [], segments: [], pauses: [] },
    );

    expect(result.status).toBe('not-started');
    expect(result.observationStartedAt).toBeNull();
    expect(result.intervals).toEqual([]);
    expect(result.totals.gapMs).toBe(0);
  });

  it('splits a session longer than a day without wrapping the per-day total', () => {
    const long = 30 * HOUR;
    const source = {
      sessions: [
        session({
          startedAt: at(0),
          endedAt: at(0) + long,
          activeElapsedMs: long,
          pauseElapsedMs: 0,
          wallElapsedMs: long,
        }),
      ],
      segments: [segment({ startedAt: at(0), endedAt: at(0) + long, activeElapsedMs: long })],
      pauses: [],
    };
    const first = buildCalendarDayLedger({ day, now: at(36) }, source);
    const second = buildCalendarDayLedger({ day: at(24), now: at(36) }, source);

    expect(first.totals.focusMs).toBe(24 * HOUR); // capped at day end, never wraps
    expect(second.totals.focusMs).toBe(6 * HOUR);
    expect(first.totals.focusMs + second.totals.focusMs).toBe(30 * HOUR);
  });
});
