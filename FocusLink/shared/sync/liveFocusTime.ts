/**
 * Live focus time helpers.
 *
 * The live protocol's own pause/resume commands close the running segment at the pause
 * boundary, so a live-created session never has a pause nested inside a segment. A desktop
 * session adopted from local SQLite uses a different but equivalent shape: one segment can
 * span several pauses, and its recorded active time excludes those pauses. Both shapes must
 * produce the same focus total, so segment span is always reduced by the pause overlap.
 */

export interface LiveTimeSegment {
  startedAt: number;
  endedAt: number | null;
}

export interface LiveTimePause {
  startedAt: number;
  endedAt: number | null;
}

/** Pause milliseconds that fall inside one segment's [startedAt, endedAt] interval. */
export function livePauseOverlapMs(
  segment: LiveTimeSegment,
  pauses: readonly LiveTimePause[],
  now: number,
): number {
  const segmentStart = segment.startedAt;
  const segmentEnd = segment.endedAt ?? now;
  if (segmentEnd <= segmentStart) return 0;
  let overlap = 0;
  for (const pause of pauses) {
    const pauseStart = pause.startedAt;
    const pauseEnd = pause.endedAt ?? now;
    if (pauseEnd <= pauseStart) continue;
    const from = Math.max(segmentStart, pauseStart);
    const to = Math.min(segmentEnd, pauseEnd);
    if (to > from) overlap += to - from;
  }
  return Math.min(overlap, segmentEnd - segmentStart);
}

/** Active focus time for one segment, excluding any pause that overlaps it. */
export function liveSegmentActiveElapsedMs(
  segment: LiveTimeSegment,
  pauses: readonly LiveTimePause[],
  now: number,
): number {
  const span = (segment.endedAt ?? now) - segment.startedAt;
  if (span <= 0) return 0;
  return Math.max(0, span - livePauseOverlapMs(segment, pauses, now));
}

/** Active focus time for a whole live session. */
export function liveActiveElapsedMs(
  segments: readonly LiveTimeSegment[],
  pauses: readonly LiveTimePause[],
  now: number,
): number {
  return segments.reduce(
    (total, segment) => total + liveSegmentActiveElapsedMs(segment, pauses, now),
    0,
  );
}
