import { describe, expect, it } from 'vitest';

import type { TimerSnapshot } from '@shared/types';
import { projectLiveSession } from '../electron/sessions/liveSessionProjection';

/* ────────────────────────────────────────────────────────────────────────────
   进行中的实时（多端）会话投影（用户 2026-10-06 反馈「专注还没结束，你也应该
   显示我已有的数据」）

   打开 deviceSync.liveControlEnabled 后，进行中的会话事实来源在云端 Durable
   Object，主进程不往本地 SQLite 写 focus_sessions / focus_segments；统计页与
   第三栏只读 SQLite，于是正在进行的这次专注整段消失。这里把 timer 快照投影成
   本地记录形状，由 sessions:list / sessions:get / sessions:analytics 注入。

   本文件锁住投影的边界：只投影真正属于云端的进行中会话，本地会话不得重复计数。
   ──────────────────────────────────────────────────────────────────────────── */

const START = new Date(2026, 9, 6, 9, 27, 0, 0).getTime();
const SEGMENT_ONE_END = START + 27 * 60_000;
const PAUSE_END = SEGMENT_ONE_END + 2 * 60_000;

function snapshot(overrides: Partial<TimerSnapshot> = {}): TimerSnapshot {
  return {
    state: 'running',
    sessionId: 'live-session-1',
    currentSegmentId: 'live-segment-2',
    currentTaskId: 'math-1',
    currentTaskTitle: '第二章第二节',
    currentTaskSource: 'local',
    sessionDefaultTaskId: 'math-1',
    sessionDefaultTaskTitle: '第二章第二节',
    activeElapsedMs: 55 * 60_000,
    pauseElapsedMs: 2 * 60_000,
    wallElapsedMs: 57 * 60_000,
    currentPauseStartedAt: null,
    segments: [
      {
        id: 'live-segment-1',
        taskId: 'math-1',
        taskTitle: '第二章第二节',
        taskSource: 'local',
        title: '第二章第二节',
        startedAt: START,
        endedAt: SEGMENT_ONE_END,
        activeElapsedMs: 27 * 60_000,
      },
      {
        id: 'live-segment-2',
        taskId: 'math-1',
        taskTitle: '第二章第二节',
        taskSource: 'local',
        title: '第二章第二节',
        startedAt: PAUSE_END,
        endedAt: null,
        activeElapsedMs: 28 * 60_000,
      },
    ],
    pauseEvents: [
      {
        id: 'live-pause-1',
        segmentId: 'live-segment-1',
        pauseStartedAt: SEGMENT_ONE_END,
        pauseEndedAt: PAUSE_END,
        durationMs: 2 * 60_000,
        isCurrent: false,
      },
    ],
    lastTick: PAUSE_END,
    ...overrides,
  };
}

const noLocalSession = () => false;

describe('进行中的实时会话投影', () => {
  it('把云端会话映射成本地记录形状，统计页与账本都能读', () => {
    const projection = projectLiveSession(snapshot(), noLocalSession);
    expect(projection).not.toBeNull();
    const { session, segments, pauses } = projection!;

    expect(session).toMatchObject({
      id: 'live-session-1',
      status: 'active',
      endedAt: null,
      title: '第二章第二节',
      startedAt: START,
      createdAt: START,
      defaultTaskId: 'math-1',
      defaultTaskSource: 'local',
      defaultTaskTitle: '第二章第二节',
      segmentCount: 2,
      linkedSegmentCount: 2,
      ticktickLinkedSegmentCount: 0,
    });
    expect(session.wallElapsedMs).toBe(57 * 60_000);

    expect(segments.map((segment) => segment.id)).toEqual(['live-segment-1', 'live-segment-2']);
    expect(segments[0]).toMatchObject({
      sessionId: 'live-session-1',
      taskId: 'math-1',
      title: '第二章第二节',
      endedAt: SEGMENT_ONE_END,
      note: null,
      cloudFocusId: null,
      tomatodoSubject: null,
      createdAt: START,
      updatedAt: SEGMENT_ONE_END,
    });
    expect(segments[1]).toMatchObject({ endedAt: null, updatedAt: PAUSE_END });

    expect(pauses).toHaveLength(1);
    expect(pauses[0]).toMatchObject({
      id: 'live-pause-1',
      sessionId: 'live-session-1',
      segmentId: 'live-segment-1',
      durationMs: 2 * 60_000,
      reason: null,
    });
  });

  it('暂停中的会话同样投影，默认任务来源从片段反查', () => {
    const projection = projectLiveSession(
      snapshot({
        state: 'paused',
        currentPauseStartedAt: PAUSE_END,
        segments: [
          {
            id: 'live-segment-1',
            taskId: 'chemistry-1',
            taskTitle: '复习化学',
            taskSource: 'ticktick',
            title: '复习化学',
            startedAt: START,
            endedAt: SEGMENT_ONE_END,
            activeElapsedMs: 27 * 60_000,
          },
        ],
        sessionDefaultTaskId: 'chemistry-1',
        sessionDefaultTaskTitle: '复习化学',
      }),
      noLocalSession,
    );
    expect(projection?.session.defaultTaskSource).toBe('ticktick');
    expect(projection?.session.ticktickLinkedSegmentCount).toBe(1);
  });

  it('默认任务在片段里查不到来源时留空，不猜', () => {
    const projection = projectLiveSession(
      snapshot({ sessionDefaultTaskId: 'gone-1', sessionDefaultTaskTitle: '已删除的任务' }),
      noLocalSession,
    );
    expect(projection?.session.defaultTaskId).toBe('gone-1');
    expect(projection?.session.defaultTaskTitle).toBe('已删除的任务');
    expect(projection?.session.defaultTaskSource).toBeNull();
  });

  it('本地库已有该会话时不投影，避免同一场专注被算两次', () => {
    expect(projectLiveSession(snapshot(), (id) => id === 'live-session-1')).toBeNull();
    expect(projectLiveSession(snapshot(), () => true)).toBeNull();
  });

  it('空闲、无会话、无片段都不投影', () => {
    expect(
      projectLiveSession(snapshot({ state: 'idle', sessionId: null }), noLocalSession),
    ).toBeNull();
    expect(projectLiveSession(snapshot({ state: 'idle' }), noLocalSession)).toBeNull();
    expect(projectLiveSession(snapshot({ segments: [] }), noLocalSession)).toBeNull();
  });
});
