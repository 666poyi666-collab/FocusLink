import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TASK_COMPLETION_UNDO_MS,
  newLocalTaskCompletion,
  planTaskCompletionIntent,
} from '../src/mobile/localTaskCompletions';

/**
 * 打勾闭环的契约：本机先保存、撤销窗口 6 秒、行内状态与收拢动画都由这一层锁定。
 * 这些断言直接读源码，防止「CSS 写了但组件从不应用」这类静默失效重演。
 */

const mobileRoot = path.join(process.cwd(), 'src', 'mobile');
const pageSource = fs.readFileSync(path.join(mobileRoot, 'TickTickTaskPage.tsx'), 'utf8');
const appSource = fs.readFileSync(path.join(mobileRoot, 'MobileApp.tsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(mobileRoot, 'mobile.css'), 'utf8');

function sliceSource(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `${start} 不存在`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from);
  expect(to, `${end} 不存在`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('task completion intent plan', () => {
  it('creates one intent with a 6 s undo window', () => {
    const plan = planTaskCompletionIntent({
      records: [],
      taskId: 'task-a',
      scope: 'account-1',
      completed: true,
      now: 1_000,
    });
    expect(plan.kind).toBe('create');
    if (plan.kind !== 'create') return;
    expect(plan.record.notBefore).toBe(1_000 + TASK_COMPLETION_UNDO_MS);
    expect(TASK_COMPLETION_UNDO_MS).toBe(6_000);
    expect(plan.record.completed).toBe(true);
  });

  it('drops the intent when the undo happens inside the window', () => {
    const record = newLocalTaskCompletion('task-a', 'account-1', true, 1_000);
    const plan = planTaskCompletionIntent({
      records: [record],
      taskId: 'task-a',
      scope: 'account-1',
      completed: false,
      now: 1_000 + TASK_COMPLETION_UNDO_MS - 1,
    });
    expect(plan.kind).toBe('drop');
  });

  it('replaces the intent after the window and ignores duplicate taps', () => {
    const record = newLocalTaskCompletion('task-a', 'account-1', true, 1_000);
    const after = planTaskCompletionIntent({
      records: [record],
      taskId: 'task-a',
      scope: 'account-1',
      completed: false,
      now: 1_000 + TASK_COMPLETION_UNDO_MS + 1,
    });
    expect(after.kind).toBe('replace');
    if (after.kind === 'replace') {
      expect(after.record.completed).toBe(false);
      expect(after.record.operationId).not.toBe(record.operationId);
    }
    const duplicate = planTaskCompletionIntent({
      records: [record],
      taskId: 'task-a',
      scope: 'account-1',
      completed: true,
      now: 2_000,
    });
    expect(duplicate.kind).toBe('noop');
  });
});

describe('mobile completion pipeline contract', () => {
  it('saves the completion locally before touching the network', () => {
    const handler = sliceSource(
      appSource,
      'const setCloudTaskCompleted = useCallback(',
      'const enqueueTaskEdit = useCallback(',
    );
    expect(handler).toMatch(/planTaskCompletionIntent\(/);
    expect(handler).toMatch(/writeLocalTaskCompletion\(/);
    // 旧实现先 await refreshTasks 再提交，点一下要等整份清单往返。
    expect(handler).not.toMatch(/refreshTasks\(/);
    expect(handler).not.toMatch(/mutateTaskSnapshot\(/);
  });

  it('submits the queued intent with a stable operation id and a fresh revision', () => {
    const flush = sliceSource(
      appSource,
      'const flushTaskCompletion = useCallback(',
      'const pullLedger = useCallback(',
    );
    expect(flush).toMatch(/kind: 'set_task_completed'/);
    expect(flush).toMatch(/operationId: record\.operationId/);
    expect(flush).toMatch(/expectedRevision: confirmed\.revision/);
    // 回执期间改了意图就保留记录，不能被旧回执清掉。
    expect(flush).toMatch(/after\.operationId === record\.operationId/);
  });

  it('holds the row in place for the undo window and then collapses it', () => {
    expect(pageSource).toMatch(
      /import \{ TASK_COMPLETION_UNDO_MS \} from '\.\/localTaskCompletions'/,
    );
    expect(pageSource).toMatch(/data-exit=\{heldCompletions\[node\.id\]\?\.phase === 'exiting'\}/);
    expect(pageSource).toMatch(/tt-row-status/);
    expect(pageSource).toMatch(/const undoBatch = \(\) => \{/);
    // 勾选不允许再被全局 busy 串行化：连续点第二个任务时必须立刻响应。
    expect(pageSource).not.toMatch(/if \(!onToggleComplete \|\| busy\) return;/);
    expect(pageSource).toMatch(/onToggle\(node, !completed\)/);
    // 原位停留靠的是「按未完成交给过滤器、单独渲染勾选态」；若把 isCompleted 改成 true
    // 交给过滤器，filterSyncedTaskForest 会把已完成叶子节点直接丢掉，行立刻消失。
    expect(pageSource).toMatch(/isCompleted: false \},\s*\);/);
  });

  it('does not replay the completion pop on a refresh or in the completed list', () => {
    expect(cssSource).toMatch(/\.tt-check\[data-just-checked='true'\]/);
    expect(cssSource).not.toMatch(/\.tt-check\[data-checked='true'\] \{\s*animation:/);
    expect(pageSource).toMatch(
      /justCompleted=\{!showCompleted && heldCompletions\[node\.id\] !== undefined\}/,
    );
    // 切走任务页必须清掉计时器，回来时不补播过期动画。
    expect(pageSource).toMatch(
      /for \(const timer of holds\.values\(\)\) window\.clearTimeout\(timer\);/,
    );
  });

  it('collapses row height through the grid-row trick only', () => {
    expect(cssSource).toMatch(
      /\.tt-node\[data-exit='true'\] \.tt-node-collapse \{\s*grid-template-rows: 0fr;/,
    );
    expect(cssSource).toMatch(/\.tt-node-collapse \{[\s\S]*?grid-template-rows: 1fr;/);
    expect(cssSource).toMatch(/\.tt-row-status\[data-state='failed'\]/);
    // 收拢动画只动布局盒子与透明度，不再用 width/height 关键帧拖慢每帧。
    expect(cssSource).not.toMatch(/@keyframes tt-row-collapse/);
  });
});
