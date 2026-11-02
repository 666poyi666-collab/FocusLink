# FocusLink v1.9.6

> 发布日期：2026-11-02
>
> 对应提交：`PENDING`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 验证状态：源码门禁、Windows 安装回读、任意目录调用 `focuslink` 与小米同版均已实测

## 主要变化

- **安装包自带 `focuslink` 命令**：安装目录里有 `focuslink.cjs` 与 `focuslink.cmd`；应用首次启动把转发别名写进当前用户的 `WindowsApps`（默认已在 PATH 上），任意目录直接可用，卸载会删除别名，绝不改用户 PATH。
- **中文路径不再阻断打包**：`npm run dist` 改为在纯 ASCII 暂存目录构建，再把安装包复制回 `release-v<xxx>`；仓库放在 `开发\foucslink` 这类路径下也能一次打包成功。
- **运维脚本输出可落盘**：`tomatodo:check` 新增 `--json-out <file>`，GUI 子系统 stdout 不可靠时直接读文件。
- **修复 v1.9.5 的 shim 换行**：`.cmd` 必须 CRLF，否则 cmd.exe 把注释行当命令执行（实测会先报一行「不是内部或外部命令」，然后仍能跑）。

## 验证

- 源码：`format:check` / `typecheck` / `lint` 通过；`npm test` 177 文件 / 1548 用例全绿；`npm run build` 成功并产出 `focuslink.cjs`。
- 打包：`node scripts/build/package-release.mjs` 在 `%TEMP%\focuslink-build-1.9.6` 构建，自动复制两个安装包到 `release-v196`。
- Windows：`installer /S` 退出 0，回读 `DisplayVersion=1.9.6`、已装 EXE 文件版本 `1.9.6`；重启后 `smoke:window-visible` 通过（主窗口 handle 664988）。
- 任意目录调用：在 `C:\Windows\Temp` 执行 `focuslink doctor --json` 退出 0，返回 `version=1.9.6`、`ok=true`；`focuslink status --json` 正常返回。
- 小米：`adb install -r` 成功，回读 `versionName=1.9.6` / `versionCode=1372`。
- 华为按 2026-10-29 指令不在线，未安装。

## 升级提示

- Windows 直接覆盖安装即可；装完无需配置 PATH，新开的终端里就能用 `focuslink`。
- 从源码目录使用时仍可用 `npm run focuslink -- …`，两者共享同一份命令合同。

## 已知限制

- **运维脚本运行仍未能验证**：本机自动化环境里 `electron.exe <script>` 连最小探针都不执行（已用独立探针确认是环境限制），脚本改动只有代码与类型检查背书，需在真实终端跑一次 `npm run tomatodo:check -- --json-out check.json` 复核。
- **renderer 刷新仍未肉眼演练**：事件链路已接好并有单测覆盖契约层，但没有在真实窗口走「改学科 → 看统计是否即时刷新」。
- 安装器仍需从 ASCII 路径运行；中文路径下运行安装器会以退出码 2 结束的缺陷未在源码层修复（打包侧已自动化）。
- `focuslinkCloudState` 仍返回 `unknown`（未接 V2 Outbox 投影）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.9.6-x64.exe` | `7128644faf8d1e28a3391395f75df946d16ff5df23cee5ed6e20ee63303cd15d` |
| `FocusLink-1.9.6-x64-portable.exe` | `91c7495aebc43698294f97a9a452d09b93f07bf24adbf2f3f842386223432d76` |

同时提供 `SHA256SUMS.txt`。
