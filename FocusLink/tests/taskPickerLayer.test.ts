import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* ────────────────────────────────────────────────────────────────────────────
   任务选择弹层的层级契约（FL-UI-PICKER-ABOVE-TOAST）

   为什么有这道测试（2026-10-06 打包产物实测）：

     通知条（`src/ui/Toast.tsx`）是 `fixed bottom-5 right-5 z-[100]` 的右下角浮层，
     每一条 `toast-item` 都是 `pointer-events-auto` 且整条可点关闭。
     任务选择弹层原来根层级是 `z-50`，于是通知条压在弹层之上：弹层页脚
     「清除关联 / 清除这一段的关联」正好落在右下角通知条的位置，
     真实鼠标点击全部落在通知条上（`elementFromPoint` 返回 `.toast-message`，
     点击事件目标也是 `.toast-message`），表现为「点了清除毫无反应、弹层不关」。

     这条不能用 DOM 几何或 `elementFromPoint` 单独证明：必须真实点击并读事件目标。
     2026-10-06 实测记录见 `backend-design/IMPLEMENTATION_LOG.md` 的 v1.5.7 验收小节。

   约束：弹层根 z 必须 **大于** 通知层、**小于** 窗口控制区（`.window-controls` 的
   z-index），窗口右上角三个按钮在弹层打开时仍然可点。
   ──────────────────────────────────────────────────────────────────────────── */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8');

function zOf(source: string, pattern: RegExp, label: string): number {
  const match = pattern.exec(source);
  expect(match, `找不到 ${label} 的层级值`).not.toBeNull();
  return Number(match![1]);
}

describe('任务选择弹层级层（FL-UI-PICKER-ABOVE-TOAST）', () => {
  const picker = read('src', 'features', 'tasks', 'TaskPicker.tsx');
  const toast = read('src', 'ui', 'Toast.tsx');
  const linearCss = read('src', 'styles', 'linear-workbench.css');

  it('弹层根高于通知层，低于窗口控制区', () => {
    const pickerZ = zOf(picker, /fixed inset-0 z-\[(\d+)\]/, 'TaskPicker 弹层根');
    const toastZ = zOf(toast, /pointer-events-none fixed[^"]*z-\[(\d+)\]/, 'Toast 栈');
    const controlsZ = zOf(
      linearCss,
      /\.window-controls \{[^}]*z-index:\s*(\d+)/,
      '.window-controls',
    );
    expect(
      pickerZ,
      '通知条整条可点（pointer-events-auto），压在弹层页脚上会吞掉「清除关联」的真实点击',
    ).toBeGreaterThan(toastZ);
    expect(pickerZ, '弹层不得盖住窗口控制区：右上角三个按钮必须始终可点').toBeLessThan(controlsZ);
  });

  it('通知条仍然整条可点（这是上述危险成立的前提）', () => {
    expect(toast).toContain('pointer-events-auto');
  });
});
