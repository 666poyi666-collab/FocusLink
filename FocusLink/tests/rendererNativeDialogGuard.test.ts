import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* ────────────────────────────────────────────────────────────────────────────
   Window 原生对话框守卫（FL-UI-NATIVE-DIALOG）

   为什么有这道测试（2026-10-03 实测）：
     任务页「删除任务」仍然调用 window.confirm()。在打包后的 Electron 里，
     原生 confirm/alert/prompt 会**阻塞整个 renderer 主线程**，而且窗口隐藏或
     失焦时对话框可能根本不在前台 —— 用户侧表现就是「点不动、整个应用假死」，
     并且 webContents.reload() 也救不回来（对话框属于浏览器侧）。

     2026-10-03 14:46 的冻结就是这条路径：日志连续
     `renderer became unresponsive`，CDP 里 `Runtime.evaluate` 与
     `Debugger.pause` 全部超时；同一时刻枚举到一个可见的 `#32770` 原生对话框窗口。

   规则：桌面 renderer（src/，不含 src/mobile 的 WebView 分支）**永远不能**
   调用原生 confirm/alert/prompt；确认类交互统一使用 ui/ConfirmDialog。
   ──────────────────────────────────────────────────────────────────────────── */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(root, 'src');
const NATIVE_CALL = /\b(confirm|alert|prompt)\s*\(/;

function collectSourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'mobile') continue; // 移动端跑在 WebView 里，不是本守卫的范围
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** 去掉块注释与行注释，避免注释里提到 confirm() 被误判。 */
function codeOnly(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.split('//')[0]);
}

describe('desktop renderer window dialog guard', () => {
  it('never calls native confirm/alert/prompt', () => {
    const violations: string[] = [];
    for (const file of collectSourceFiles(srcRoot)) {
      codeOnly(readFileSync(file, 'utf8')).forEach((line, index) => {
        if (NATIVE_CALL.test(line)) {
          violations.push(`${path.relative(root, file)}:${index + 1} ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('routes destructive task and device confirmations through ConfirmDialog', () => {
    const taskWorkspace = readFileSync(
      path.join(srcRoot, 'features', 'tasks', 'TaskWorkspace.tsx'),
      'utf8',
    );
    const settings = readFileSync(
      path.join(srcRoot, 'features', 'settings', 'SettingsPanel.tsx'),
      'utf8',
    );
    expect(taskWorkspace).toContain("from '../../ui/ConfirmDialog'");
    expect(taskWorkspace).toContain('<ConfirmDialog');
    expect(settings).toContain("from '../../ui/ConfirmDialog'");
    expect(settings).toContain('<ConfirmDialog');
  });
});
