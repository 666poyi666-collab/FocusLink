// 用 esbuild 把 selftest.ts / crash-recovery.ts bundle 成 .cjs，处理 @shared 别名
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

const alias = {
  '@shared': path.join(root, 'shared'),
  '@': path.join(root, 'src'),
};
const external = ['better-sqlite3', 'electron'];

// [目录, 入口文件]：目录用于区分 regression 与 maintenance 两类入口。
for (const [dir, entry] of [
  ['regression', 'selftest.ts'],
  ['regression', 'crash-recovery.ts'],
  ['regression', 'task-test.ts'],
  ['regression', 'device-sync-db.ts'],
  ['regression', 'dida-task-state-smoke.ts'],
  ['regression', 'tomatodo-cloud-real-smoke.ts'],
  ['maintenance', 'tomatodo-approval-sync.ts'],
]) {
  await esbuild.build({
    entryPoints: [path.join(root, 'scripts', dir, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(root, 'dist-selftest', entry.replace(/\.ts$/, '.cjs')),
    external,
    alias,
    logLevel: 'info',
  });
}

console.log('all scripts bundled to dist-selftest/');
