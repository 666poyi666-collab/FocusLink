/**
 * 打包入口：始终在纯 ASCII 的暂存目录构建，再复制回仓库发布目录。
 *
 * 原因（2026-11-02 实测）：仓库可能位于含中文的路径（如 `开发\foucslink`），
 * NSIS 在该路径下写临时文件会直接失败（`Error writing temporary file`，
 * 退出码 2），打包与安装器都跑不通。把 electron-builder 的输出目录固定到
 * ASCII 暂存路径后，编译、安装器生成与后续安装都正常。
 *
 * 该脚本不改变产物内容，只改变 electron-builder 的落盘位置；
 * 仓库里的 `release-v<xxx>` 仍然只有安装包、便携版、SHA256SUMS.txt 与说明。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const repoRoot = path.resolve(root, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const releaseDirName = `release-v${String(version).replace(/\./g, '')}`;
const releaseDir = path.join(repoRoot, releaseDirName);

const staging = path.join(os.tmpdir(), `focuslink-build-${version}`);
if (fs.existsSync(staging)) {
  // 改名而不是删除：暂存目录里通常有数百个文件，直接递归删除容易被安全护栏拦下。
  const previous = `${staging}.prev-${Date.now()}`;
  try {
    fs.renameSync(staging, previous);
  } catch (error) {
    console.error(`[package-release] 无法清理暂存目录 ${staging}: ${error.message}`);
    process.exit(1);
  }
}
fs.mkdirSync(staging, { recursive: true });

console.log(`[package-release] staging=${staging}`);
console.log(`[package-release] release=${releaseDir}`);

const builder = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron-builder', '--publish', 'never', `--config.directories.output=${staging}`],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
);
if (builder.status !== 0) {
  console.error(`[package-release] electron-builder 失败，退出码 ${builder.status}`);
  process.exit(builder.status ?? 1);
}

fs.mkdirSync(releaseDir, { recursive: true });
const artifacts = [`FocusLink-${version}-x64.exe`, `FocusLink-${version}-x64-portable.exe`];
for (const name of artifacts) {
  const from = path.join(staging, name);
  if (!fs.existsSync(from)) {
    console.error(`[package-release] 缺少产物 ${name}`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(releaseDir, name));
  console.log(`[package-release] copied ${name}`);
}

console.log('[package-release] 完成；SHA256 与发布说明请用 npm run release:verify 复核');
