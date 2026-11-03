import { describe, expect, it } from 'vitest';
import { SessionWriteError } from '../electron/mcp/sessionWritePayload';
import { parseProjectCreate, parseTaskCreate } from '../electron/mcp/taskWritePayload';

function expectWriteError(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
  } catch (error) {
    const failure = error as SessionWriteError;
    expect(failure).toBeInstanceOf(SessionWriteError);
    expect(failure.status).toBe(status);
    expect(failure.code).toBe(code);
    return;
  }
  throw new Error('expected a SessionWriteError');
}

describe('/v1 project and task create payloads', () => {
  it('accepts a project with an optional color and icon', () => {
    expect(parseProjectCreate({ name: ' 数心一轮 ', color: '#2f6fed' })).toEqual({
      name: '数心一轮',
      color: '#2f6fed',
      icon: null,
    });
  });

  it('rejects a project without a name', () => {
    expectWriteError(() => parseProjectCreate({ color: '#2f6fed' }), 400, 'INVALID_ARGUMENT');
  });

  it('accepts a task under a project', () => {
    expect(
      parseTaskCreate({ projectId: 'project-1', title: '第三节 函数值域', priority: 2 }),
    ).toEqual({
      title: '第三节 函数值域',
      projectId: 'project-1',
      parentId: null,
      dueDate: null,
      priority: 2,
    });
  });

  it('defaults the project to null so the provider lands in the inbox', () => {
    expect(parseTaskCreate({ title: '第三节 函数值域' }).projectId).toBeNull();
  });

  it('rejects a task without a title', () => {
    expectWriteError(() => parseTaskCreate({ projectId: 'project-1' }), 400, 'INVALID_ARGUMENT');
  });

  it('rejects non-integer priority and negative due dates are dropped', () => {
    expectWriteError(
      () => parseTaskCreate({ title: '任务', priority: 1.5 }),
      400,
      'INVALID_ARGUMENT',
    );
    expect(parseTaskCreate({ title: '任务', dueDate: -5 }).dueDate).toBeNull();
  });
});
