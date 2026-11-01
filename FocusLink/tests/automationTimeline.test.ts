import { describe, expect, it } from 'vitest';

import {
  buildTimelineLedger,
  canonicalTomatodoPlanPayload,
  continuousTimeline,
  formatControlVersion,
  readControlSessionId,
  spansOverlap,
  timelinePauseId,
  timelineSegmentId,
  tomatodoProjectedEndAt,
} from '@shared/automation/timeline';

const START = Date.parse('2026-11-02T09:00:00+08:00');
const MINUTE = 60_000;

describe('automation timeline', () => {
  it('builds a continuous record whose three times conserve', () => {
    const result = buildTimelineLedger({
      sessionId: 'session-a',
      startedAt: START,
      endedAt: START + 45 * MINUTE,
      items: continuousTimeline(START, START + 45 * MINUTE, null, '数学'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.activeElapsedMs).toBe(45 * MINUTE);
    expect(result.ledger.pauseElapsedMs).toBe(0);
    expect(result.ledger.wallElapsedMs).toBe(45 * MINUTE);
    expect(result.ledger.segments).toHaveLength(1);
    expect(result.ledger.segments[0]!.segmentId).toBe('session-a-s0');
  });

  it('sums interleaved focus and pause intervals', () => {
    const result = buildTimelineLedger({
      sessionId: 'session-b',
      startedAt: START,
      endedAt: START + 95 * MINUTE,
      items: [
        { kind: 'focus', startedAt: START, endedAt: START + 45 * MINUTE, title: null },
        {
          kind: 'pause',
          startedAt: START + 45 * MINUTE,
          endedAt: START + 50 * MINUTE,
          reason: '接水',
        },
        {
          kind: 'focus',
          startedAt: START + 50 * MINUTE,
          endedAt: START + 95 * MINUTE,
          title: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.activeElapsedMs).toBe(90 * MINUTE);
    expect(result.ledger.pauseElapsedMs).toBe(5 * MINUTE);
    expect(result.ledger.wallElapsedMs).toBe(95 * MINUTE);
    expect(result.ledger.segments.map((segment) => segment.segmentId)).toEqual([
      'session-b-s0',
      'session-b-s1',
    ]);
    expect(result.ledger.pauses[0]!.pauseId).toBe('session-b-p0');
    expect(result.ledger.pauses[0]!.reason).toBe('接水');
  });

  it('rejects a timeline that leaves a gap', () => {
    const result = buildTimelineLedger({
      sessionId: 'session-c',
      startedAt: START,
      endedAt: START + 60 * MINUTE,
      items: [
        { kind: 'focus', startedAt: START, endedAt: START + 20 * MINUTE, title: null },
        {
          kind: 'focus',
          startedAt: START + 30 * MINUTE,
          endedAt: START + 60 * MINUTE,
          title: null,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TIMELINE_GAP');
    expect(result.index).toBe(1);
  });

  it('rejects overlapping intervals instead of silently merging them', () => {
    const result = buildTimelineLedger({
      sessionId: 'session-d',
      startedAt: START,
      endedAt: START + 60 * MINUTE,
      items: [
        { kind: 'focus', startedAt: START, endedAt: START + 40 * MINUTE, title: null },
        {
          kind: 'pause',
          startedAt: START + 30 * MINUTE,
          endedAt: START + 60 * MINUTE,
          reason: null,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TIMELINE_OVERLAP');
  });

  it('rejects intervals outside the declared span', () => {
    const result = buildTimelineLedger({
      sessionId: 'session-e',
      startedAt: START,
      endedAt: START + 30 * MINUTE,
      items: [{ kind: 'focus', startedAt: START, endedAt: START + 40 * MINUTE, title: null }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TIMELINE_OUT_OF_BOUNDS');
  });

  it('rejects a zero-length interval', () => {
    const result = buildTimelineLedger({
      sessionId: 'session-f',
      startedAt: START,
      endedAt: START + 30 * MINUTE,
      items: [
        { kind: 'focus', startedAt: START, endedAt: START, title: null },
        { kind: 'focus', startedAt: START, endedAt: START + 30 * MINUTE, title: null },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TIMELINE_INVALID');
  });

  it('rejects a record with pause time only', () => {
    const result = buildTimelineLedger({
      sessionId: 'session-g',
      startedAt: START,
      endedAt: START + 10 * MINUTE,
      items: [{ kind: 'pause', startedAt: START, endedAt: START + 10 * MINUTE, reason: '走开' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TIMELINE_INVALID');
  });

  it('rejects an inverted span', () => {
    const result = buildTimelineLedger({
      sessionId: 'session-h',
      startedAt: START + 10,
      endedAt: START,
      items: continuousTimeline(START, START + 10, null, null),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TIMELINE_INVALID');
  });

  it('rejects a span longer than seven days', () => {
    const result = buildTimelineLedger({
      sessionId: 'session-i',
      startedAt: START,
      endedAt: START + 8 * 24 * 60 * MINUTE,
      items: continuousTimeline(START, START + 8 * 24 * 60 * MINUTE, null, null),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TIMELINE_INVALID');
  });

  it('derives stable ids so a retried operation cannot create duplicates', () => {
    expect(timelineSegmentId('session-x', 2)).toBe('session-x-s2');
    expect(timelinePauseId('session-x', 1)).toBe('session-x-p1');
  });
});

describe('automation versions and plan payloads', () => {
  it('encodes session identity, revision and generation into controlVersion', () => {
    const version = formatControlVersion({ sessionId: 'abc', revision: 7, generation: 2 });
    expect(version).toBe('abc:7:2');
    expect(readControlSessionId(version)).toBe('abc');
  });

  it('reports idle sessions without inventing a session id', () => {
    const version = formatControlVersion({ sessionId: null, revision: 0, generation: 0 });
    expect(version).toBe('idle:0:0');
    expect(readControlSessionId(version)).toBeNull();
  });

  it('changes controlVersion when generation changes', () => {
    const before = formatControlVersion({ sessionId: 'abc', revision: 1, generation: 0 });
    const after = formatControlVersion({ sessionId: 'abc', revision: 1, generation: 1 });
    expect(before).not.toBe(after);
  });

  it('keeps the tomatodo plan payload canonical and order stable', () => {
    const payload = {
      sessionId: 'abc',
      recordVersion: 3,
      subject: '数学',
      recordName: '数学',
      minutes: 45,
      startedAt: START,
    };
    expect(canonicalTomatodoPlanPayload(payload)).toBe(
      `abc\u001f3\u001f数学\u001f数学\u001f45\u001f${START}`,
    );
  });

  it('projects the tomatodo end time from rounded minutes, not wall time', () => {
    expect(tomatodoProjectedEndAt(START, 45)).toBe(START + 45 * MINUTE);
    expect(tomatodoProjectedEndAt(START, 0)).toBe(START + MINUTE);
  });

  it('treats touching spans as non-overlapping', () => {
    expect(
      spansOverlap(
        { startedAt: START, endedAt: START + MINUTE },
        { startedAt: START + MINUTE, endedAt: START + 2 * MINUTE },
      ),
    ).toBe(false);
    expect(
      spansOverlap(
        { startedAt: START, endedAt: START + MINUTE },
        { startedAt: START + 30_000, endedAt: START + 2 * MINUTE },
      ),
    ).toBe(true);
  });
});
