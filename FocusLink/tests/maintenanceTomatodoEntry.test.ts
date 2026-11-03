import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

describe('tomatodo approval-sync maintenance entry', () => {
  // 2026-11-03 实测：本机 GPU 进程起不来（error_code=18）时该入口直接 FATAL 退出，
  // 业务代码一行都跑不到；主应用不受影响，只有这两个脚本需要自己关硬件加速。
  it('disables hardware acceleration and keeps the GPU in-process before app ready', () => {
    const source = fs.readFileSync(
      path.join(root, 'scripts/maintenance/tomatodo-approval-sync.ts'),
      'utf8',
    );
    const disableAt = source.indexOf('app.disableHardwareAcceleration()');
    const switchAt = source.indexOf("app.commandLine.appendSwitch('in-process-gpu')");
    const readyAt = source.indexOf('app.whenReady()');
    expect(disableAt).toBeGreaterThan(-1);
    expect(switchAt).toBeGreaterThan(disableAt);
    expect(readyAt).toBeGreaterThan(switchAt);
  });

  it('ignores Chromium switches instead of rejecting them as unknown arguments', () => {
    const source = fs.readFileSync(
      path.join(root, 'scripts/maintenance/tomatodo-approval-sync.ts'),
      'utf8',
    );
    expect(source).toContain("arg.startsWith('--disable-')");
    expect(source).toContain("arg.startsWith('--no-')");
  });
});
