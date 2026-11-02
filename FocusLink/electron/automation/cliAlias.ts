/**
 * 安装版 CLI 的免配置别名。
 *
 * 目标：装完就能在任意目录敲 `focuslink`，且不碰用户 PATH。
 * 做法：把一层薄 .cmd 写进 `%LOCALAPPDATA%\Microsoft\WindowsApps`——
 * 这是当前用户默认已在 PATH 上的目录，改动只影响本用户、可由卸载器直接删除。
 * 别名只做转发，真正的逻辑在安装目录的 `focuslink.cjs`。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { logger } from '../logger.js';

export interface CliAliasResult {
  installed: boolean;
  aliasPath: string | null;
  reason: string;
}

function aliasDirectory(): string {
  const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'Microsoft', 'WindowsApps');
}

/** cmd.exe 只认 CRLF；纯 LF 会把注释行当成命令执行（v1.9.5 实测）。 */
const toCrlf = (value: string): string => value.split('\n').join('\r\n');

function shimBody(installDir: string): string {
  return toCrlf(`@echo off
rem FocusLink command shim: run the bundled CLI on the app's Electron binary.
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"${installDir}\\FocusLink.exe" "${installDir}\\focuslink.cjs" %*
exit /b %ERRORLEVEL%
`);
}

/**
 * 幂等：内容一致就不重写。失败只记一条告警，不影响应用启动。
 * @param installDir 安装目录（打包后为 FocusLink.exe 所在目录）
 */
export function ensureCliAlias(installDir: string): CliAliasResult {
  const bundle = path.join(installDir, 'focuslink.cjs');
  if (!fs.existsSync(bundle)) {
    return { installed: false, aliasPath: null, reason: 'cli-bundle-missing' };
  }
  const directory = aliasDirectory();
  const aliasPath = path.join(directory, 'focuslink.cmd');
  const body = shimBody(installDir);
  try {
    fs.mkdirSync(directory, { recursive: true });
    const existing = fs.existsSync(aliasPath) ? fs.readFileSync(aliasPath, 'utf8') : null;
    if (existing !== body) {
      fs.writeFileSync(aliasPath, body, { encoding: 'utf8' });
      logger.info('main', 'focuslink command alias written', { aliasPath });
    }
    return { installed: true, aliasPath, reason: existing === body ? 'unchanged' : 'written' };
  } catch (error) {
    logger.warn('main', 'focuslink command alias could not be written', {
      aliasPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return { installed: false, aliasPath: null, reason: 'write-failed' };
  }
}
