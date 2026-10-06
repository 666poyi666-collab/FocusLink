import { describe, expect, it } from 'vitest';

import {
  LIVE_FOCUS_COMMAND_PATH,
  LIVE_FOCUS_MAX_TITLE_LENGTH,
  LIVE_FOCUS_PROTOCOL_VERSION,
  LIVE_FOCUS_SNAPSHOT_PATH,
  LIVE_FOCUS_WAIT_PATH,
  liveSegmentTask,
  liveSegmentTitle,
  validateLiveFocusCommandRequest,
} from '@shared/sync/liveFocusProtocol';

function startRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
    deviceId: 'phone-a',
    command: {
      commandId: 'command-start-1',
      action: 'start',
      expectedRevision: 0,
      sessionId: 'session-live-1',
      title: '复习化学',
      task: { taskId: 'chemistry-1', taskSource: 'ticktick', taskTitle: '复习化学' },
    },
    ...overrides,
  };
}

describe('live focus protocol', () => {
  it('uses stable v1 routes and accepts strict start/transition commands', () => {
    expect(LIVE_FOCUS_SNAPSHOT_PATH).toBe('/sync/v2/live');
    expect(LIVE_FOCUS_WAIT_PATH).toBe('/sync/v2/live/wait');
    expect(LIVE_FOCUS_COMMAND_PATH).toBe('/sync/v2/live/command');

    const start = validateLiveFocusCommandRequest(startRequest());
    expect(start.ok).toBe(true);
    expect(start.request?.command.action).toBe('start');

    const pause = validateLiveFocusCommandRequest({
      protocolVersion: 1,
      deviceId: 'tablet-b',
      command: {
        commandId: 'command-pause-1',
        action: 'pause',
        expectedRevision: 1,
        sessionId: 'session-live-1',
      },
    });
    expect(pause.ok).toBe(true);
  });

  it('rejects client ownership fields, malformed ids, unsafe revisions, and extra payload', () => {
    expect(validateLiveFocusCommandRequest({ ...startRequest(), accountId: 'forged' }).ok).toBe(
      false,
    );
    expect(
      validateLiveFocusCommandRequest({
        ...startRequest(),
        command: { ...(startRequest().command as object), ownerDeviceId: 'forged' },
      }).ok,
    ).toBe(false);
    expect(
      validateLiveFocusCommandRequest({
        ...startRequest(),
        command: { ...(startRequest().command as object), commandId: '' },
      }).ok,
    ).toBe(false);
    expect(
      validateLiveFocusCommandRequest({
        ...startRequest(),
        command: {
          ...(startRequest().command as object),
          expectedRevision: Number.MAX_SAFE_INTEGER + 1,
        },
      }).ok,
    ).toBe(false);
  });

  it('bounds titles and does not permit title fields on transitions', () => {
    expect(
      validateLiveFocusCommandRequest({
        ...startRequest(),
        command: {
          ...(startRequest().command as object),
          title: 'x'.repeat(LIVE_FOCUS_MAX_TITLE_LENGTH),
        },
      }).ok,
    ).toBe(true);
    expect(
      validateLiveFocusCommandRequest({
        ...startRequest(),
        command: {
          ...(startRequest().command as object),
          title: 'x'.repeat(LIVE_FOCUS_MAX_TITLE_LENGTH + 1),
        },
      }).ok,
    ).toBe(false);
    expect(
      validateLiveFocusCommandRequest({
        protocolVersion: 1,
        deviceId: 'phone-a',
        command: {
          commandId: 'command-resume-1',
          action: 'resume',
          expectedRevision: 2,
          sessionId: 'session-live-1',
          title: 'not allowed',
        },
      }).ok,
    ).toBe(false);
  });

  it('accepts strict task context and rejects unsupported task ownership fields', () => {
    expect(validateLiveFocusCommandRequest(startRequest()).ok).toBe(true);
    expect(
      validateLiveFocusCommandRequest({
        ...startRequest(),
        command: {
          ...(startRequest().command as object),
          task: {
            taskId: 'chemistry-1',
            taskSource: 'ticktick',
            taskTitle: '复习化学',
            accountId: 'forged',
          },
        },
      }).ok,
    ).toBe(false);
  });

  /* 用户 2026-10-06：专注中途点账本里的片段改任务 —— 协议新增 link-task 动作。 */
  it('accepts strict link-task bodies and rejects missing segments or forged task fields', () => {
    const linkRequest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
      protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
      deviceId: 'phone-a',
      command: {
        commandId: 'command-link-1',
        action: 'link-task',
        expectedRevision: 3,
        sessionId: 'session-live-1',
        segmentId: 'live-segment-1',
        task: { taskId: 'poetry-1', taskSource: 'local', taskTitle: '古诗文' },
        ...overrides,
      },
    });

    const accepted = validateLiveFocusCommandRequest(linkRequest());
    expect(accepted.ok).toBe(true);
    expect(accepted.request?.command).toMatchObject({
      action: 'link-task',
      segmentId: 'live-segment-1',
      task: { taskId: 'poetry-1', taskSource: 'local', taskTitle: '古诗文' },
    });

    // 显式 null 表示「主动解除关联」，必须原样透传，不能归一化成继承。
    const cleared = validateLiveFocusCommandRequest(linkRequest({ task: null }));
    expect(cleared.ok).toBe(true);
    expect(cleared.request?.command).toMatchObject({ action: 'link-task', task: null });

    expect(validateLiveFocusCommandRequest(linkRequest({ segmentId: '' })).ok).toBe(false);
    expect(validateLiveFocusCommandRequest(linkRequest({ task: { taskId: 'poetry-1' } })).ok).toBe(
      false,
    );
    expect(
      validateLiveFocusCommandRequest(
        linkRequest({ task: { taskId: 'poetry-1', taskSource: 'dida', taskTitle: null } }),
      ).ok,
    ).toBe(false);
    expect(
      validateLiveFocusCommandRequest(
        linkRequest({
          task: {
            taskId: 'poetry-1',
            taskSource: 'local',
            taskTitle: null,
            accountId: 'forged',
          },
        }),
      ).ok,
    ).toBe(false);
    expect(validateLiveFocusCommandRequest(linkRequest({ title: 'not allowed' })).ok).toBe(false);
    expect(
      validateLiveFocusCommandRequest({
        protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
        deviceId: 'phone-a',
        command: {
          commandId: 'command-resume-1',
          action: 'resume',
          expectedRevision: 2,
          sessionId: 'session-live-1',
          segmentId: 'live-segment-1',
        },
      }).ok,
    ).toBe(false);
  });

  it('resolves a segment override: missing inherits the session task, null clears it', () => {
    const sessionTask = {
      taskId: 'math-1',
      taskSource: 'local' as const,
      taskTitle: '第二章第二节',
    };
    const inherited = { id: 'live-segment-1', startedAt: 1, endedAt: null };
    expect(liveSegmentTask(inherited, sessionTask)).toEqual(sessionTask);
    expect(liveSegmentTask({ ...inherited, task: null }, sessionTask)).toBeNull();
    expect(
      liveSegmentTask(
        { ...inherited, task: { taskId: 'poetry-1', taskSource: 'local', taskTitle: '古诗文' } },
        sessionTask,
      ),
    ).toMatchObject({ taskId: 'poetry-1' });

    expect(liveSegmentTitle(inherited, sessionTask, '会话标题')).toBe('第二章第二节');
    expect(liveSegmentTitle(inherited, null, '会话标题')).toBe('会话标题');
    expect(liveSegmentTitle({ ...inherited, task: null }, sessionTask, '会话标题')).toBeNull();
    expect(
      liveSegmentTitle(
        { ...inherited, task: { taskId: 'poetry-1', taskSource: 'local', taskTitle: null } },
        sessionTask,
        '会话标题',
      ),
    ).toBeNull();
  });
});
