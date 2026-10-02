import { describe, expect, it } from 'vitest';
import type { Task } from '../shared/types';
import { sortTasks } from '../src/features/tasks/taskSort';
import { nextReleaseVersion } from '../shared/releaseVersionPolicy';
const tasks = [
  { id: '10', title: '循环10', sortOrder: 1, dueDate: null, priority: 0 },
  { id: '2', title: '循环2', sortOrder: 2, dueDate: 200, priority: 3 },
  { id: '1', title: '循环1', sortOrder: 3, dueDate: 100, priority: 1 },
] as Task[];
describe('task sorting keeps identity and sibling membership', () => {
  it('sorts Chinese names with natural number order and leaves the source unchanged', () => {
    expect(sortTasks(tasks, 'name').map((task) => task.id)).toEqual(['1', '2', '10']);
    expect(tasks.map((task) => task.id)).toEqual(['10', '2', '1']);
  });
  it('keeps undated tasks last in both date directions', () => {
    expect(sortTasks(tasks, 'date').map((task) => task.id)).toEqual(['1', '2', '10']);
    expect(sortTasks(tasks, 'date-desc').map((task) => task.id)).toEqual(['2', '1', '10']);
  });
  it('supports priority and durable manual ordering', () => {
    expect(sortTasks(tasks, 'priority').map((task) => task.id)).toEqual(['2', '1', '10']);
    expect(sortTasks(tasks, 'manual').map((task) => task.id)).toEqual(['10', '2', '1']);
  });
});
describe('ten-patch release cadence', () => {
  it('advances only 0–9 patches before the next minor', () => {
    expect(nextReleaseVersion('1.5.0')).toBe('1.5.1');
    expect(nextReleaseVersion('1.5.8')).toBe('1.5.9');
    expect(nextReleaseVersion('1.5.9')).toBe('1.6.0');
    expect(nextReleaseVersion('1.9.9')).toBe('1.10.0');
    expect(() => nextReleaseVersion('1.5.10')).toThrow();
  });
});
