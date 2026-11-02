/**
 * 把 `focuslink` CLI 打成安装包可直接运行的单文件。
 *
 * 约束：产物运行在 `ELECTRON_RUN_AS_NODE=1` 的 FocusLink.exe 里，
 * 因此只能是 CommonJS，且必须完全不引用 electron。
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const outDir = path.join(root, 'dist-cli');

/** cmd.exe 只认 CRLF；纯 LF 会把注释行当成命令执行（v1.9.5 实测）。 */
const toCrlf = (value) => value.split('\n').join('\r\n');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, 'scripts/cli/focuslink-installed.ts')],
  outfile: path.join(outDir, 'focuslink.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  legalComments: 'none',
  logLevel: 'warning',
});

const shim = `@echo off
rem FocusLink command shim: run the bundled CLI on the app's Electron binary.
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0FocusLink.exe" "%~dp0focuslink.cjs" %*
exit /b %ERRORLEVEL%
`;

const ps1 = `# FocusLink command shim (PowerShell)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:ELECTRON_RUN_AS_NODE = '1'
& (Join-Path $here 'FocusLink.exe') (Join-Path $here 'focuslink.cjs') @args
exit $LASTEXITCODE
`;

fs.writeFileSync(path.join(outDir, 'focuslink.cmd'), toCrlf(shim), 'utf8');
fs.writeFileSync(path.join(outDir, 'focuslink.ps1'), toCrlf(ps1), 'utf8');

const size = fs.statSync(path.join(outDir, 'focuslink.cjs')).size;
console.log(`[bundle-cli] focuslink.cjs ${(size / 1024).toFixed(1)} kB + shim`);
