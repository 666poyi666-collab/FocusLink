import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskWorkspaceRefreshData } from '../shared/ipc/api';

const workspace = (id?: string): TaskWorkspaceRefreshData => ({
  provider: 'focuslink-local',
  projects: [],
  tasks: id ? [{ id, title: id } as never] : [],
  refreshedAt: Date.now(),
});

describe('shared desktop task reads', () => {
  it('receives local mutation events while an old local read is still pending', async () => {
    let resolveLocal!: (value: unknown) => void;
    const refresh = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLocal = resolve;
        }),
    );
    vi.stubGlobal('window', { focuslink: { tasks: { refresh } } });
    const { readTaskWorkspace, acceptTaskWorkspace } =
      await import('../src/features/tasks/taskWorkspaceData');
    const pending = readTaskWorkspace();
    acceptTaskWorkspace(workspace('newly-created'));
    resolveLocal({ ok: true, data: workspace('older-snapshot') });
    await expect(pending).resolves.toMatchObject({ tasks: [{ id: 'newly-created' }] });
    await expect(readTaskWorkspace()).resolves.toMatchObject({ tasks: [{ id: 'newly-created' }] });
  });

  it('keeps a failed background refresh visible and avoids a retry storm on repeated opens', async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: workspace('local') })
      .mockResolvedValueOnce({ ok: false, error: 'network unavailable' })
      .mockResolvedValueOnce({ ok: true, data: workspace('recovered') });
    vi.stubGlobal('window', { focuslink: { tasks: { refresh } } });
    const { readTaskWorkspace, refreshTaskWorkspace } =
      await import('../src/features/tasks/taskWorkspaceData');
    const { useStore } = await import('../src/app/store');
    await readTaskWorkspace();
    await expect(refreshTaskWorkspace()).rejects.toThrow('network unavailable');
    await refreshTaskWorkspace();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(useStore.getState()).toMatchObject({
      taskWorkspaceRefreshError: 'network unavailable',
      taskWorkspaceRefreshing: false,
    });
    await refreshTaskWorkspace(true);
    expect(useStore.getState()).toMatchObject({
      taskWorkspaceRefreshError: null,
      ticktickTasks: [{ id: 'recovered' }],
    });
  });
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('shares the initial local read and remembers a successfully loaded empty list', async () => {
    const refresh = vi.fn().mockResolvedValue({ ok: true, data: workspace() });
    vi.stubGlobal('window', { focuslink: { tasks: { refresh } } });
    const { readTaskWorkspace } = await import('../src/features/tasks/taskWorkspaceData');
    await Promise.all([readTaskWorkspace(), readTaskWorkspace()]);
    await readTaskWorkspace();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ localOnly: true });
  });

  it('keeps local tasks usable during a hanging background request and coalesces refreshes', async () => {
    let resolveRemote!: (value: unknown) => void;
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: workspace('cached') })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRemote = resolve;
          }),
      );
    vi.stubGlobal('window', { focuslink: { tasks: { refresh } } });
    const { readTaskWorkspace, refreshTaskWorkspace } =
      await import('../src/features/tasks/taskWorkspaceData');
    await readTaskWorkspace();
    const background = refreshTaskWorkspace();
    expect(refreshTaskWorkspace()).toBe(background);
    await expect(readTaskWorkspace()).resolves.toMatchObject({ tasks: [{ id: 'cached' }] });
    resolveRemote({ ok: true, data: workspace('new') });
    await background;
    await refreshTaskWorkspace();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not replace a more recent local edit with an older background response', async () => {
    let resolveRemote!: (value: unknown) => void;
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: workspace('before') })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRemote = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true, data: workspace('edited') });
    vi.stubGlobal('window', { focuslink: { tasks: { refresh } } });
    const { readTaskWorkspace, refreshTaskWorkspace } =
      await import('../src/features/tasks/taskWorkspaceData');
    await readTaskWorkspace();
    const background = refreshTaskWorkspace();
    await readTaskWorkspace(true);
    resolveRemote({ ok: true, data: workspace('stale') });
    await background;
    await expect(readTaskWorkspace()).resolves.toMatchObject({ tasks: [{ id: 'edited' }] });
  });

  it('retries a failed local read instead of caching the failure as an empty workspace', async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'database unavailable' })
      .mockResolvedValueOnce({ ok: true, data: workspace('recovered') });
    vi.stubGlobal('window', { focuslink: { tasks: { refresh } } });
    const { readTaskWorkspace } = await import('../src/features/tasks/taskWorkspaceData');
    await expect(readTaskWorkspace()).rejects.toThrow('database unavailable');
    await expect(readTaskWorkspace()).resolves.toMatchObject({ tasks: [{ id: 'recovered' }] });
  });
});
