import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* ────────────────────────────────────────────────────────────────────────────
   专注页账本「点片段改任务关联」（用户 2026-10-06 需求 1 与 3）

   用户原话：右边不是有一个专门显示记录的地方嘛，就在这个地方改。我点击一下「03」，
   应该弹出一个小窗口让我来修改；同理我也可以在那个界面修改我第三个任务的关联片段。
   默认逻辑：会话默认任务不变，暂停后继续的新片段仍继承默认任务，只有被点开的片段
   写显式 override（协议 LiveFocusTimelineSegment.task：undefined 继承、null 主动解除）。

   这条链路的四段必须同时在位，缺一段就是「点了没反应」：
     ① SegmentTimeline 专注行可点，暂停行不可点；
     ② TimerPanel 用选择器结果调用 timer.linkTask / clearSegmentTask；
     ③ 主进程对实时会话把改动发成 link-task 命令（不能落到本地库）；
     ④ 云端 DO 与仓库内镜像都实现 link-task，片段级任务写进完成后的账本 bundle。
   ──────────────────────────────────────────────────────────────────────────── */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8');

/** 去掉块注释与行注释：注释里允许保留历史证据，但不算实现。 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('专注页账本片段改任务关联', () => {
  const timeline = read('src', 'features', 'focus', 'SegmentTimeline.tsx');
  const timelineCode = codeOnly(timeline);
  const timerPanel = read('src', 'features', 'focus', 'TimerPanel.tsx');
  const timerCode = codeOnly(timerPanel);
  const controller = read('electron', 'timer', 'focusTimerController.ts');
  const controllerCode = codeOnly(controller);

  it('专注片段行是按钮，暂停行保持纯文本', () => {
    expect(timelineCode, '专注片段行必须可点').toContain('ledger-row-title ledger-row-edit');
    expect(timelineCode).toContain('aria-label={`修改片段');
    expect(timelineCode, '没有编辑回调时必须退回纯文本，不能出现点不动的按钮').toContain(
      'onEdit={isFocus && onEditSegment ? handleEdit : null}',
    );
    expect(timelineCode, '暂停行不得变成可点按钮').toContain('<span className="ledger-row-title"');
  });

  it('账本把点击事件交给页面层，且回调引用稳定', () => {
    expect(timelineCode).toContain('onEditSegment?: (segmentId: string, index: number) => void');
    expect(timelineCode).toContain('onEditSegment?.(segmentId, index)');
    expect(timelineCode, '每秒重建回调会让 memo 行整份重排').toContain('useCallback(');
  });

  it('页面层用弹窗结果调用关联与清除，并提示结果', () => {
    expect(timerCode).toContain('<SegmentTimeline onEditSegment={handleEditSegment} />');
    expect(timerCode).toContain(
      'window.focuslink.timer.linkTask(target.id, task.id, task.source, task.title)',
    );
    expect(timerCode).toContain('window.focuslink.timer.clearSegmentTask(target.id)');
    expect(timerCode).toContain('onClear={handleClearEditingSegment}');
    expect(timerCode).toContain('clearLabel="清除这一段的关联"');
  });

  it('任务选择器支持「清除这一段的关联」，旧调用点文案不变', () => {
    const picker = codeOnly(read('src', 'features', 'tasks', 'TaskPicker.tsx'));
    expect(picker).toContain('onClear?: () => void');
    expect(picker).toContain('clearLabel = ');
    expect(picker, '无清除能力的调用点必须保持原文案（冒烟脚本会等它）').toContain(
      '点击任务即可关联',
    );
  });

  it('主进程对实时会话发 link-task 命令，不再拒绝「进行中不能修改关联」', () => {
    // 只检查片段级关联这一段：会话默认任务（linkSessionTask）仍然是开始前才可改的。
    const region = controllerCode.slice(
      controllerCode.indexOf('linkSegmentTask('),
      controllerCode.indexOf('linkSessionTask('),
    );
    expect(region).toContain('relinkLiveSegment');
    expect(region).toContain("this.send('link-task', task, segmentId)");
    expect(region, '实时分支必须把 rejection 冒到渲染层').toContain('Promise<void>');
    expect(region, '实时会话的片段改动不得落本地库').not.toContain('ensureNotLiveSession');
  });

  it('IPC 三段与云端两处实现都在位', () => {
    expect(read('shared', 'types.ts')).toContain("'timer:link-task'");
    expect(read('electron', 'preload.ts')).toContain("ipcRenderer.invoke('timer:link-task'");
    expect(read('electron', 'ipc.ts')).toContain("'timer:link-task'");
    expect(read('cloudflare', 'accountDurableObject.ts')).toContain("case 'link-task'");
    expect(read('cloudflare', 'accountDurableObject.ts')).toContain('segment_not_found');
    expect(read('cloud', 'deviceSyncStore.ts')).toContain("case 'link-task'");
    expect(read('shared', 'sync', 'liveFocusProtocol.ts')).toContain('liveSegmentTask');
  });
});
