import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => fixture.userData } }));
vi.mock('../electron/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import { initDatabase, closeDatabase } from '../electron/db/index';
import { LocalTaskProvider } from '../electron/tasks/localProvider';
describe('local workspace mutations persist without implicit dates', () => {
  beforeAll(() => {
    fixture.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-task-mutations-'));
    initDatabase();
  });
  afterAll(() => {
    closeDatabase();
    if (!fixture.userData.startsWith(path.join(os.tmpdir(), 'focuslink-task-mutations-')))
      throw new Error('Unexpected fixture path');
    fs.rmSync(fixture.userData, { recursive: true, force: true });
  });
  it('creates a real local project and undated root/child, and keeps manual order after reopening SQLite', () => {
    const project = LocalTaskProvider.createProject(' 新清单 ', '#2563eb', 'folder');
    expect(LocalTaskProvider.listProjects().find((item) => item.id === project.id)?.name).toBe(
      '新清单',
    );
    const first = LocalTaskProvider.create('任务1', project.id);
    const second = LocalTaskProvider.create('任务2', project.id, { dueDate: 1800000000000 });
    const child = LocalTaskProvider.create('子任务', project.id, { parentId: first.id });
    expect(first.dueDate).toBeNull();
    expect(first.startDate).toBeNull();
    expect(child.dueDate).toBeNull();
    LocalTaskProvider.reorder([second.id, first.id]);
    closeDatabase();
    initDatabase();
    expect(LocalTaskProvider.getById(second.id)?.sortOrder).toBeLessThan(
      LocalTaskProvider.getById(first.id)?.sortOrder ?? 0,
    );
    expect(LocalTaskProvider.getById(second.id)?.dueDate).toBe(1800000000000);
    expect(LocalTaskProvider.getById(first.id)?.dueDate).toBeNull();
    expect(LocalTaskProvider.getById(child.id)?.parentId).toBe(first.id);
    expect(LocalTaskProvider.getById(child.id)?.dueDate).toBeNull();
  });
});
