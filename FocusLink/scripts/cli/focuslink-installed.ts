/**
 * 安装包内置 CLI 的入口。
 *
 * 由 `scripts/build/bundle-cli.mjs` 打成 `focuslink.cjs`，
 * 在 `ELECTRON_RUN_AS_NODE=1` 的 FocusLink.exe 里运行。
 * 只依赖 `focuslink-cli` 的纯逻辑，不引入 electron。
 */
import { runFocusLinkCli } from './focuslink-cli.ts';

void runFocusLinkCli(process.argv.slice(2), process.env, {
  stdout: (value) => process.stdout.write(`${value}\n`),
  stderr: (value) => process.stderr.write(`${value}\n`),
}).then((exitCode) => {
  process.exitCode = exitCode;
});
