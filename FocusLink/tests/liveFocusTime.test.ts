import { describe, expect, it } from 'vitest';

import {
  liveActiveElapsedMs,
  livePauseOverlapMs,
  liveSegmentActiveElapsedMs,
} from '../shared/sync/liveFocusTime';

describe('live focus time', () => {
  it('counts a live-created session whose pauses sit between segments', () => {
    const segments = [
      { startedAt: 0, endedAt: 1_000 },
      { startedAt: 3_000, endedAt: 5_000 },
      { startedAt: 6_000, endedAt: null },
    ];
    const pauses = [
      { startedAt: 1_000, endedAt: 3_000 },
      { startedAt: 5_000, endedAt: 6_000 },
    ];
    expect(liveActiveElapsedMs(segments, pauses, 8_000)).toBe(5_000);
    expect(liveSegmentActiveElapsedMs(segments[0], pauses, 8_000)).toBe(1_000);
    expect(liveSegmentActiveElapsedMs(segments[2], pauses, 8_000)).toBe(2_000);
  });

  it('subtracts a pause nested inside an adopted desktop segment', () => {
    const segments = [{ startedAt: 0, endedAt: 10_000 }];
    const pauses = [{ startedAt: 2_000, endedAt: 7_000 }];
    expect(livePauseOverlapMs(segments[0], pauses, 10_000)).toBe(5_000);
    expect(liveSegmentActiveElapsedMs(segments[0], pauses, 10_000)).toBe(5_000);
    expect(liveActiveElapsedMs(segments, pauses, 10_000)).toBe(5_000);
  });

  it('does not count an open pause that starts at the segment boundary', () => {
    const segments = [{ startedAt: 0, endedAt: 4_000 }];
    const pauses = [{ startedAt: 4_000, endedAt: null }];
    expect(liveActiveElapsedMs(segments, pauses, 6_000)).toBe(4_000);
  });

  it('keeps active time non-negative when a pause covers the segment', () => {
    const segments = [{ startedAt: 2_000, endedAt: 5_000 }];
    const pauses = [{ startedAt: 1_000, endedAt: 9_000 }];
    expect(liveSegmentActiveElapsedMs(segments[0], pauses, 10_000)).toBe(0);
  });
});
