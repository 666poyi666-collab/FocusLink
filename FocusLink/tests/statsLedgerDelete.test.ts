import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* ────────────────────────────────────────────────────────────────────────────
   统计页「第三栏删除记录」契约（FL-STATS-LEDGER-DELETE）

   为什么有这道测试（2026-10-04 用户报告「统计界面的第三栏为什么不能删除记录」）：
     主进程的 sessions:delete 一直存在（撤同步队列、写 delete 墓碑、清理番茄/滴答
     外部记录），preload 与共享 IPC 类型也在，但**渲染层零调用** —— 删除入口在
     e67767f（v1.3.15「彻底剔除旧版残留」）重写 HistoryPanel 时被整段删掉，
     c1ee0c1（v1.3.21）把这一栏拆成 SessionLedger.tsx 时也没有补回来。

     这类「后端还在、UI 静默消失」的缺陷当时没有任何测试能抓住：统计页契约测试
     只比对结构/文案/CSS，原生对话框守卫只列了任务页与设置页。于是它跨了 20 多个
     版本没被发现，直到用户直接问出来。

   本文件锁住四件事：
     ① 第三栏必须存在「删除记录」入口；
     ② 确认必须走应用内 ConfirmDialog（危险态），不得退回原生 confirm；
     ③ 确认后必须真的调用 sessions.delete —— 只弹窗不删除同样算缺陷；
     ④ 共享 IPC / preload / 主进程三段必须仍在，避免「UI 指向空气」。
   ──────────────────────────────────────────────────────────────────────────── */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8');

/** 去掉块注释与行注释：注释里允许保留历史证据，但不算实现。 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('统计页第三栏删除记录（FL-STATS-LEDGER-DELETE）', () => {
  const ledger = read('src', 'features', 'history', 'SessionLedger.tsx');
  const ledgerCode = codeOnly(ledger);

  it('第三栏提供删除记录入口，并标出它的作用对象', () => {
    expect(ledgerCode, '统计页账本必须提供删除记录按钮').toContain('删除记录');
    expect(ledgerCode, '删除按钮必须带 title 供用户与冒烟脚本定位').toContain('title=');
    expect(ledgerCode).toContain('aria-label="删除记录"');
  });

  it('删除确认走应用内危险弹窗，不使用原生 confirm', () => {
    expect(ledger).toContain("from '../../ui/ConfirmDialog'");
    expect(ledgerCode).toContain('<ConfirmDialog');
    expect(ledgerCode).toMatch(/danger\b/);
    expect(ledgerCode, '原生 confirm/alert/prompt 会阻塞打包后的 renderer').not.toMatch(
      /\b(confirm|alert|prompt)\s*\(/,
    );
  });

  it('确认后真的调用 sessions.delete，而不是只弹一个窗', () => {
    expect(ledgerCode, '确认删除必须调用主进程删除接口').toContain(
      'window.focuslink.sessions.delete(',
    );
    expect(ledgerCode, '删除成功后必须让页面重新取数').toContain('onDeleted');
  });

  it('确认正文说明两类后果，不夸大清远端能力', () => {
    expect(ledgerCode).toContain('本地记录永久删除');
    expect(ledgerCode).toContain('番茄 To-do');
    expect(ledgerCode, '当前客户端没有 PCRecord 远端删除 API，不能声称远端已删除').toContain(
      '不代表远端记录已验证删除',
    );
  });

  it('三栏之间的 IPC 三段仍在：类型、preload 桥、主进程 handler', () => {
    expect(read('shared', 'ipc', 'api.ts')).toMatch(/delete\(id: string\): Promise<TimerSnapshot>/);
    expect(read('electron', 'preload.ts')).toContain("ipcRenderer.invoke('sessions:delete'");
    const ipc = read('electron', 'ipc.ts');
    expect(ipc).toContain("ipcMain.handle('sessions:delete'");
    expect(ipc, '进行中的会话必须由主进程拒绝删除').toContain('当前专注仍在进行中');
  });
});
