import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_FOCUS_PROTOCOL_VERSION } from '@shared/sync/liveFocusProtocol';

import type { TimerSnapshot } from '@shared/types';

const runtimeConnection = vi.hoisted(() => ({
  current: null as { endpoint: string; accessToken: string; deviceId: string } | null,
}));

vi.mock('../electron/sync/deviceSyncService.js', () => ({
  getDeviceSyncRuntimeConnection: () => runtimeConnection.current,
  runDeviceSync: vi.fn(),
  setDeviceSyncLiveTelemetry: vi.fn(),
}));

vi.mock('../electron/db/index.js', () => ({
  getSession: vi.fn(),
  deleteSession: vi.fn(),
}));

import { FocusTimerController } from '../electron/timer/focusTimerController';
import { runDeviceSync } from '../electron/sync/deviceSyncService';
import { deleteSession, getSession } from '../electron/db/index';

function snapshot(state: TimerSnapshot['state']): TimerSnapshot {
  return {
    state,
    sessionId: state === 'idle' ? null : 'local-active-session',
    currentSegmentId: state === 'idle' ? null : 'local-segment',
    currentTaskId: null,
    currentTaskTitle: null,
    currentTaskSource: null,
    sessionDefaultTaskId: null,
    sessionDefaultTaskTitle: null,
    activeElapsedMs: 1_000,
    pauseElapsedMs: 0,
    wallElapsedMs: 1_000,
    currentPauseStartedAt: null,
    segments: [],
    pauseEvents: [],
    lastTick: Date.now(),
  };
}

function liveResponse(state: 'idle' | 'running' | 'paused' = 'idle', revision = 0): Response {
  const now = Date.now();
  const session =
    state === 'idle'
      ? null
      : {
          id: 'remote-session',
          title: '远程任务',
          state,
          startedAt: now - 1_000,
          activeElapsedMs: 1_000,
          pauseElapsedMs: state === 'paused' ? 200 : 0,
          wallElapsedMs: 1_000,
          currentPauseStartedAt: state === 'paused' ? now - 200 : null,
          segments: [{ id: 'remote-segment', startedAt: now - 1_000, endedAt: null }],
          pauses:
            state === 'paused'
              ? [
                  {
                    id: 'remote-pause',
                    segmentId: 'remote-segment',
                    startedAt: now - 200,
                    endedAt: null,
                  },
                ]
              : [],
          task: { taskId: 'task-1', taskSource: 'local', taskTitle: '远程任务' },
          updatedAt: now,
          lastCommandDeviceId: 'desktop-test-device',
        };
  return new Response(
    JSON.stringify({
      protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
      serverTime: now,
      snapshot: { revision, state, session },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe('desktop live focus controller', () => {
  it('acknowledges finish and releases control even while ledger import never responds', async () => {
    const local = { getSnapshot: () => snapshot('idle'), onSnapshot: vi.fn(), dispose: vi.fn() };
    const controller = new FocusTimerController(local as never);
    const internal = controller as unknown as { liveMode: boolean; snapshot: TimerSnapshot };
    internal.liveMode = true;
    internal.snapshot = { ...snapshot('running'), sessionId: 'remote-session' };
    const value = await liveResponse('idle', 2).json();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ...value,
          ack: { status: 'applied', errorCode: null, completedEntityId: 'remote-session' },
        }),
      ),
    );
    vi.mocked(runDeviceSync).mockImplementation(() => new Promise(() => {}));
    try {
      await expect(controller.stop()).resolves.toMatchObject({
        state: 'idle',
        ledgerImportPending: true,
      });
      expect(runDeviceSync).toHaveBeenCalledOnce();
      const next = await liveResponse('running', 3).json();
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...next,
            ack: { status: 'applied', errorCode: null, completedEntityId: null },
          }),
        ),
      );
      await expect(controller.toggle()).resolves.toMatchObject({ state: 'running' });
    } finally {
      controller.dispose();
      fetchSpy.mockRestore();
    }
  });

  it('does not let a late ledger import overwrite a newer active session', async () => {
    const local = { getSnapshot: () => snapshot('idle'), onSnapshot: vi.fn(), dispose: vi.fn() };
    const controller = new FocusTimerController(local as never);
    const internal = controller as unknown as { liveMode: boolean; snapshot: TimerSnapshot };
    internal.liveMode = true;
    internal.snapshot = { ...snapshot('running'), sessionId: 'remote-session' };
    let finishImport!: () => void;
    vi.mocked(runDeviceSync).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishImport = () => resolve({} as never);
        }),
    );
    const value = await liveResponse('idle', 2).json();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...value,
          ack: { status: 'applied', errorCode: null, completedEntityId: 'remote-session' },
        }),
      ),
    );
    try {
      await controller.stop();
      const next = await liveResponse('running', 3).json();
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...next,
            ack: { status: 'applied', errorCode: null, completedEntityId: null },
          }),
        ),
      );
      await controller.toggle();
      vi.mocked(getSession).mockReturnValue({ id: 'remote-session', status: 'finished' } as never);
      finishImport();
      await flushMicrotasks();
      expect(controller.getSnapshot().state).toBe('running');
    } finally {
      controller.dispose();
      fetchSpy.mockRestore();
    }
  });
  it('coalesces repeated mouse and shortcut toggles while a command is awaiting confirmation', async () => {
    const local = { getSnapshot: () => snapshot('idle'), onSnapshot: vi.fn(), dispose: vi.fn() };
    const controller = new FocusTimerController(local as never);
    const internal = controller as unknown as { liveMode: boolean; snapshot: TimerSnapshot };
    internal.liveMode = true;
    internal.snapshot = { ...snapshot('paused'), sessionId: 'remote-session' };
    let resolveCommand!: (value: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCommand = resolve;
        }),
    );
    try {
      const mouse = controller.toggle();
      const shortcut = controller.toggle();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await expect(controller.stop()).rejects.toThrow('上一次操作正在确认');
      const value = await liveResponse('running', 2).json();
      resolveCommand(
        new Response(
          JSON.stringify({
            ...value,
            ack: { status: 'applied', errorCode: null, completedEntityId: null },
          }),
        ),
      );
      await expect(mouse).resolves.toMatchObject({ state: 'running' });
      await expect(shortcut).resolves.toMatchObject({ state: 'running' });
    } finally {
      controller.dispose();
      fetchSpy.mockRestore();
    }
  });

  it('bounds an unresponsive command and permits a later retry without changing confirmed state', async () => {
    vi.useFakeTimers();
    const timeouts = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const abort = new AbortController();
      setTimeout(() => abort.abort(new DOMException('Timed out', 'TimeoutError')), ms);
      return abort.signal;
    });
    const local = { getSnapshot: () => snapshot('idle'), onSnapshot: vi.fn(), dispose: vi.fn() };
    const controller = new FocusTimerController(local as never);
    const internal = controller as unknown as { liveMode: boolean; snapshot: TimerSnapshot };
    internal.liveMode = true;
    internal.snapshot = { ...snapshot('paused'), sessionId: 'remote-session' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    try {
      const rejected = expect(controller.toggle()).rejects.toThrow('实时同步请求超时');
      await vi.advanceTimersByTimeAsync(4_000);
      await rejected;
      expect(controller.getSnapshot().state).toBe('paused');
      const value = await liveResponse('running', 2).json();
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...value,
            ack: { status: 'applied', errorCode: null, completedEntityId: null },
          }),
        ),
      );
      await expect(controller.toggle()).resolves.toMatchObject({ state: 'running' });
    } finally {
      controller.dispose();
      fetchSpy.mockRestore();
      timeouts.mockRestore();
      vi.useRealTimers();
    }
  });
  beforeEach(() => {
    vi.mocked(runDeviceSync).mockReset();
    vi.mocked(getSession).mockReset();
    vi.mocked(deleteSession).mockReset();
    runtimeConnection.current = {
      endpoint: 'http://127.0.0.1:18787',
      accessToken: 'desktop-live-test-token',
      deviceId: 'desktop-test-device',
    };
  });

  it('keeps an acknowledged finish successful when local ledger import fails', async () => {
    const local = { getSnapshot: () => snapshot('idle'), onSnapshot: vi.fn(), dispose: vi.fn() };
    const controller = new FocusTimerController(local as never);
    const internal = controller as unknown as { liveMode: boolean; snapshot: TimerSnapshot };
    internal.liveMode = true;
    internal.snapshot = { ...snapshot('running'), sessionId: 'remote-session' };
    const response = await liveResponse('idle', 2).json();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ...response,
          ack: { status: 'applied', errorCode: null, completedEntityId: 'remote-session' },
        }),
        { status: 200 },
      ),
    );
    vi.mocked(runDeviceSync).mockRejectedValue(
      new Error('canonical Sync v2 failed (contract_error)'),
    );
    const result = await controller.stop();
    expect(result).toMatchObject({ state: 'idle', sessionId: null, ledgerImportPending: true });
    expect(controller.getSnapshot().state).toBe('idle');
    controller.dispose();
    fetchSpy.mockRestore();
  });

  it('hands an already-running local session to live authority when the cloud is idle', async () => {
    const startedAt = Date.now() - 600_000;
    const active: TimerSnapshot = {
      ...snapshot('running'),
      sessionId: 'local-active-session',
      currentSegmentId: 'local-segment',
      segments: [
        {
          id: 'local-segment',
          taskId: 'local-task',
          taskTitle: '本机任务',
          taskSource: 'local',
          title: '本机任务',
          startedAt,
          endedAt: null,
          activeElapsedMs: 600_000,
        },
      ],
      lastTick: Date.now(),
    };
    vi.mocked(getSession).mockReturnValue({
      id: 'local-active-session',
      title: '本机任务',
      startedAt,
      defaultTaskId: 'local-task',
      defaultTaskSource: 'local',
      defaultTaskTitle: '本机任务',
    } as never);
    const local = {
      getSnapshot: vi.fn(() => active),
      onSnapshot: vi.fn(),
      reset: vi.fn(() => snapshot('idle')),
      dispose: vi.fn(),
    };
    let adoptCommand: { action?: string; session?: { id?: string; segments?: unknown[] } } | null =
      null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/sync/v2/live')) return Promise.resolve(liveResponse('idle', 5));
      if (url.endsWith('/sync/v2/live/command')) {
        const body = JSON.parse(String(init?.body)) as {
          command: { action?: string; session?: { id?: string; segments?: unknown[] } };
        };
        adoptCommand = body.command;
        const observedAt = Date.now();
        return Promise.resolve(
          new Response(
            JSON.stringify({
              protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
              serverTime: observedAt,
              ack: { status: 'applied', errorCode: null, completedEntityId: null },
              snapshot: {
                revision: 6,
                state: 'running',
                session: {
                  id: 'local-active-session',
                  title: '本机任务',
                  state: 'running',
                  startedAt,
                  activeElapsedMs: 600_000,
                  pauseElapsedMs: 0,
                  wallElapsedMs: 600_000,
                  currentPauseStartedAt: null,
                  segments: [{ id: 'local-segment', startedAt, endedAt: null, task: null }],
                  pauses: [],
                  task: null,
                  updatedAt: observedAt,
                  lastCommandDeviceId: 'desktop-test-device',
                },
              },
            }),
            { status: 200 },
          ),
        );
      }
      return new Promise<Response>(() => {});
    });
    const controller = new FocusTimerController(local as never);

    controller.reloadConfiguration();
    await vi.waitFor(() => expect(deleteSession).toHaveBeenCalledWith('local-active-session'));

    expect(adoptCommand).toMatchObject({
      action: 'adopt',
      session: { id: 'local-active-session' },
    });
    expect(
      (adoptCommand as { session: { segments: unknown[] } } | null)?.session?.segments,
    ).toHaveLength(1);
    expect(local.reset).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      state: 'running',
      sessionId: 'local-active-session',
    });
    controller.dispose();
    fetchSpy.mockRestore();
  });

  it('closes the open local segment at the pause boundary when handing off a paused session', async () => {
    const startedAt = Date.now() - 900_000;
    const pauseStartedAt = Date.now() - 300_000;
    const active: TimerSnapshot = {
      ...snapshot('paused'),
      sessionId: 'local-paused-session',
      currentSegmentId: 'local-paused-segment',
      activeElapsedMs: 600_000,
      pauseElapsedMs: 0,
      wallElapsedMs: 900_000,
      currentPauseStartedAt: pauseStartedAt,
      segments: [
        {
          id: 'local-paused-segment',
          taskId: null,
          taskTitle: null,
          taskSource: null,
          title: null,
          startedAt,
          endedAt: null,
          activeElapsedMs: 600_000,
        },
      ],
      pauseEvents: [
        {
          id: 'local-paused-pause',
          segmentId: 'local-paused-segment',
          pauseStartedAt,
          pauseEndedAt: null,
          durationMs: 0,
          isCurrent: true,
        },
      ],
      lastTick: pauseStartedAt,
    };
    vi.mocked(getSession).mockReturnValue({
      id: 'local-paused-session',
      title: '暂停中的本机会话',
      startedAt,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
    } as never);
    const local = {
      getSnapshot: vi.fn(() => active),
      onSnapshot: vi.fn(),
      reset: vi.fn(() => snapshot('idle')),
      dispose: vi.fn(),
    };
    let adoptSegmentEnd: number | null | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/sync/v2/live')) return Promise.resolve(liveResponse('idle', 9));
      if (url.endsWith('/sync/v2/live/command')) {
        const body = JSON.parse(String(init?.body)) as {
          command?: { session?: { segments?: { endedAt?: number | null }[] } };
        };
        adoptSegmentEnd = body.command?.session?.segments?.[0]?.endedAt;
        const observedAt = Date.now();
        return Promise.resolve(
          new Response(
            JSON.stringify({
              protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
              serverTime: observedAt,
              ack: { status: 'applied', errorCode: null, completedEntityId: null },
              snapshot: {
                revision: 10,
                state: 'paused',
                session: {
                  id: 'local-paused-session',
                  title: '暂停中的本机会话',
                  state: 'paused',
                  startedAt,
                  activeElapsedMs: 600_000,
                  pauseElapsedMs: 0,
                  wallElapsedMs: 900_000,
                  currentPauseStartedAt: pauseStartedAt,
                  segments: [
                    {
                      id: 'local-paused-segment',
                      startedAt,
                      endedAt: pauseStartedAt,
                      task: null,
                    },
                  ],
                  pauses: [
                    {
                      id: 'local-paused-pause',
                      segmentId: 'local-paused-segment',
                      startedAt: pauseStartedAt,
                      endedAt: null,
                    },
                  ],
                  task: null,
                  updatedAt: observedAt,
                  lastCommandDeviceId: 'desktop-test-device',
                },
              },
            }),
            { status: 200 },
          ),
        );
      }
      return new Promise<Response>(() => {});
    });
    const controller = new FocusTimerController(local as never);

    controller.reloadConfiguration();
    await vi.waitFor(() => expect(deleteSession).toHaveBeenCalledWith('local-paused-session'));

    expect(adoptSegmentEnd).toBe(pauseStartedAt);
    expect(local.reset).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      state: 'paused',
      sessionId: 'local-paused-session',
    });
    controller.dispose();
    fetchSpy.mockRestore();
  });

  it('retries a transient live request failure before returning a snapshot', async () => {
    const local = {
      getSnapshot: vi.fn(() => snapshot('idle')),
      onSnapshot: vi.fn(),
      dispose: vi.fn(),
    };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller = new FocusTimerController(local as never);

    const request = (
      controller as unknown as {
        request: (
          path: string,
          connection: { endpoint: string; accessToken: string; deviceId: string },
        ) => Promise<Response>;
      }
    ).request.bind(controller);
    const response = await request('/sync/v2/live', runtimeConnection.current!);

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    controller.dispose();
    fetchSpy.mockRestore();
  });

  it('explains an unreachable live endpoint instead of exposing bare fetch failed', async () => {
    const local = {
      getSnapshot: vi.fn(() => snapshot('idle')),
      onSnapshot: vi.fn(),
      dispose: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const controller = new FocusTimerController(local as never);

    const request = (
      controller as unknown as {
        request: (
          path: string,
          connection: { endpoint: string; accessToken: string; deviceId: string },
        ) => Promise<Response>;
      }
    ).request.bind(controller);
    await expect(request('/sync/v2/live/command', runtimeConnection.current!)).rejects.toThrow(
      '无法连接实时同步服务（http://127.0.0.1:18787/sync/v2/live/command）',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    controller.dispose();
    fetchSpy.mockRestore();
  });

  it('keeps local start available until the first live handshake succeeds', async () => {
    vi.useFakeTimers();
    let current = snapshot('idle');
    const local = {
      getSnapshot: vi.fn(() => current),
      onSnapshot: vi.fn(),
      startWithTask: vi.fn(() => {
        current = snapshot('running');
        return current;
      }),
      dispose: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const controller = new FocusTimerController(local as never);

    controller.reloadConfiguration();
    await flushMicrotasks();
    const result = await controller.startWithTask('task-1', 'local', '数学');

    expect(result.state).toBe('running');
    expect(local.startWithTask).toHaveBeenCalledWith('task-1', 'local', '数学');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(false);

    controller.dispose();
    await vi.advanceTimersByTimeAsync(500);
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it('enters live mode only after a valid handshake and sends task starts to the cloud', async () => {
    let resolveInitial!: (response: Response) => void;
    const initial = new Promise<Response>((resolve) => {
      resolveInitial = resolve;
    });
    const local = {
      getSnapshot: vi.fn(() => snapshot('idle')),
      onSnapshot: vi.fn(),
      startWithTask: vi.fn(() => snapshot('running')),
      dispose: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/sync/v2/live')) return initial;
      if (url.includes('/sync/v2/live/wait')) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        });
      }
      if (url.includes('/sync/v2/live/command')) {
        const now = Date.now();
        return Promise.resolve(
          new Response(
            JSON.stringify({
              protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
              serverTime: now,
              snapshot: {
                revision: 1,
                state: 'running',
                session: {
                  id: 'remote-session',
                  title: '数学',
                  state: 'running',
                  startedAt: now - 1_000,
                  activeElapsedMs: 1_000,
                  pauseElapsedMs: 0,
                  wallElapsedMs: 1_000,
                  currentPauseStartedAt: null,
                  segments: [{ id: 'remote-segment', startedAt: now - 1_000, endedAt: null }],
                  pauses: [],
                  task: { taskId: 'task-1', taskSource: 'local', taskTitle: '数学' },
                  updatedAt: now,
                  lastCommandDeviceId: 'desktop-test-device',
                },
              },
              ack: {
                commandId: 'command-1',
                status: 'applied',
                revision: 1,
                errorCode: null,
                completedEntityId: null,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const controller = new FocusTimerController(local as never);

    controller.reloadConfiguration();
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(false);
    resolveInitial(liveResponse());
    await flushMicrotasks();
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(true);
    const result = await controller.startWithTask('task-1', 'local', '数学');

    expect(result.state).toBe('running');
    expect(local.startWithTask).not.toHaveBeenCalled();
    expect(
      fetchSpy.mock.calls.some(([input]) => String(input).includes('/sync/v2/live/command')),
    ).toBe(true);
    controller.dispose();
    fetchSpy.mockRestore();
  });

  it('keeps a confirmed live session authoritative when the wait connection drops', async () => {
    vi.useFakeTimers();
    let resolveInitial!: (response: Response) => void;
    const initial = new Promise<Response>((resolve) => {
      resolveInitial = resolve;
    });
    const local = {
      getSnapshot: vi.fn(() => snapshot('idle')),
      onSnapshot: vi.fn(),
      startWithTask: vi.fn(() => snapshot('running')),
      dispose: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/sync/v2/live')) return initial;
      if (url.includes('/sync/v2/live/wait')) {
        return Promise.reject(new TypeError('fetch failed'));
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const controller = new FocusTimerController(local as never);

    controller.reloadConfiguration();
    resolveInitial(liveResponse('running'));
    await flushMicrotasks();
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(true);
    expect(controller.getSnapshot().state).toBe('running');

    await vi.advanceTimersByTimeAsync(250);
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(true);
    expect(controller.getSnapshot().state).toBe('running');
    expect(local.startWithTask).not.toHaveBeenCalled();

    controller.dispose();
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it('excludes a pause nested inside an adopted segment from the live segment total', async () => {
    const now = Date.now();
    const response = new Response(
      JSON.stringify({
        protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
        serverTime: now,
        snapshot: {
          revision: 7,
          state: 'running',
          session: {
            id: 'remote-adopted-session',
            title: '远程采用',
            state: 'running',
            startedAt: now - 10_000,
            activeElapsedMs: 8_000,
            pauseElapsedMs: 2_000,
            wallElapsedMs: 10_000,
            currentPauseStartedAt: null,
            segments: [
              { id: 'adopted-segment-1', startedAt: now - 10_000, endedAt: now - 4_000 },
              { id: 'adopted-segment-2', startedAt: now - 4_000, endedAt: null },
            ],
            pauses: [
              {
                id: 'adopted-pause',
                segmentId: 'adopted-segment-1',
                startedAt: now - 8_000,
                endedAt: now - 6_000,
              },
            ],
            task: null,
            updatedAt: now,
            lastCommandDeviceId: 'desktop-test-device',
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/sync/v2/live')) return Promise.resolve(response);
      if (url.includes('/sync/v2/live/wait')) return Promise.reject(new TypeError('fetch failed'));
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const local = {
      getSnapshot: vi.fn(() => snapshot('idle')),
      onSnapshot: vi.fn(),
      dispose: vi.fn(),
    };
    const controller = new FocusTimerController(local as never);

    controller.reloadConfiguration();
    await flushMicrotasks();

    const mapped = controller.getSnapshot();
    expect(mapped.state).toBe('running');
    expect(mapped.segments[0]).toMatchObject({
      id: 'adopted-segment-1',
      activeElapsedMs: 4_000,
    });
    expect(mapped.segments[1]?.activeElapsedMs).toBeGreaterThanOrEqual(4_000);

    controller.dispose();
    fetchSpy.mockRestore();
  });

  it('backs off repeated handshake failures instead of retrying every two seconds forever', async () => {
    vi.useFakeTimers();
    const local = {
      getSnapshot: vi.fn(() => snapshot('idle')),
      onSnapshot: vi.fn(),
      dispose: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const controller = new FocusTimerController(local as never);

    controller.reloadConfiguration();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSpy).toHaveBeenCalledTimes(5);

    controller.dispose();
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });
});
