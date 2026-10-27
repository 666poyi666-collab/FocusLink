import { describe, expect, it } from 'vitest';
import { resolveMobileDisplaySnapshot } from '../src/mobile/localFocusPresentation';
import { startOfflineFocus, pauseOfflineFocus } from '../src/mobile/offlineFocusRuntime';
import { idleLiveFocusSnapshot, runtimeControlAvailability } from '../src/mobile/runtimeModel';

describe('durable local focus presentation', () => {
  const local = startOfflineFocus({
    id: 'local-focus',
    segmentId: 'segment-local',
    title: '本机专注',
    task: null,
    now: 1_000,
  });

  it('restores usable local controls even when native credential restore cleared the live cache', () => {
    const snapshot = resolveMobileDisplaySnapshot(local, null, 'phone', 61_000)!;
    expect(snapshot).toMatchObject({
      state: 'running',
      sessionId: local.id,
      activeElapsedMs: 60_000,
    });
    expect(
      runtimeControlAvailability({
        snapshot,
        connection: 'connecting',
        pending: false,
        localSession: true,
      }),
    ).toEqual({ start: false, pause: true, resume: false, finish: true });
  });

  it('keeps a paused local session ahead of a remote idle snapshot without changing its identity', () => {
    const paused = pauseOfflineFocus(local, 'pause-local', 31_000);
    const remote = idleLiveFocusSnapshot(900, 40_000);
    expect(resolveMobileDisplaySnapshot(paused, remote, 'phone', 41_000)).toMatchObject({
      state: 'paused',
      sessionId: 'local-focus',
      activeElapsedMs: 30_000,
      pauseElapsedMs: 10_000,
    });
    expect(remote.state).toBe('idle');
  });

  it('uses cloud state only when there is no local runtime', () => {
    const remote = idleLiveFocusSnapshot();
    expect(resolveMobileDisplaySnapshot(null, remote, 'phone')).toBe(remote);
    expect(resolveMobileDisplaySnapshot(null, null, 'phone')).toBeNull();
  });
});
