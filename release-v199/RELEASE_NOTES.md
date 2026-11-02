# FocusLink v1.9.9

> 发布日期：2026-11-02
>
> 对应提交：`8800a4d`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 构建说明：产物内嵌 commit 为 `0768633-dirty`（构建时工作区内容即 `8800a4d`），源码提交以「对应提交」为准。
>
> 验证状态：源码门禁、Windows 安装回读、真实窗口 DOM 验收（详情刷新 + 草稿保留）与小米同版均已实测

## 主要变化

- **展开的详情跟着刷新**：记录被人工保存、AI 补录/修正或云端导入后，历史账本用独立的记录变更令牌重新拉取当前会话详情。此前只重取统计，展开的详情会停在旧值。
- **草稿不被外部更新清掉**：番茄标题输入框的未提交内容按会话暂存在模块级缓存里；控件被重挂载、记录被外部修改都不会丢，只有保存成功或按 Esc 才清除。
- **刷新不再置空同会话状态**：避免输入框被卸载导致的草稿消失。

## 验证

- 源码：`format:check` / `typecheck` / `lint` 通过；`npm test` 177 文件 / 1548 用例全绿；`npm run build` 成功。
- Windows：`installer /S` 退出 0，回读 `DisplayVersion=1.9.9`、已装 EXE 文件版本 `1.9.9`；`smoke:window-visible` 通过（主窗口 handle 2691284）。
- **真实窗口 DOM 验收**（CDP + `focuslink` CLI，同一进程内）：
  1. 打开统计页，在「番茄 Todo 记录标题」输入框真实输入 `草稿-验收-勿删`（不提交）；
  2. 由 API 把当前会话标题改为 `AI改-<时间戳>`；
  3. 结果：`bodyHasTitle=true`（详情已显示新标题）、`input="草稿-验收-勿删"`（草稿未被覆盖）。
- 小米：`adb install -r` 成功，回读 `versionName=1.9.9` / `versionCode=1375`。
- 验收后已把测试改写的标题恢复为 `null`。

## 升级提示

- Windows 直接覆盖安装；从源码目录仍可用 `npm run focuslink -- …`。
- 历史页现在会随外部修改自动更新；正在输入的内容不会被刷新冲掉，保存或 Esc 后才会跟随外部值。

## 已知限制

- **运维脚本运行仍未能验证**：本机 `electron.exe <script>` 连最小探针都不执行（环境限制），需在真实终端跑 `npm run tomatodo:check -- --json-out check.json` 复核。
- 安装器仍要求 ASCII 路径运行；打包侧已自动化，安装侧未修。
- `focuslinkCloudState` 仍返回 `unknown`（未接 V2 Outbox 投影）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.9.9-x64.exe` | `15efedc56d0fe22df6d1d747ce1b01fc60b829b3ab6cc732a920507357f827b0` |
| `FocusLink-1.9.9-x64-portable.exe` | `4e8a9de08442ebd8770c9c41d46dbaa0cf2faa05740a25bb33e12b963d9a42e7` |

同时提供 `SHA256SUMS.txt`。
