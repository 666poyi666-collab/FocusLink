# FocusLink v1.6.8

> 发布日期：2026-10-21
>
> 对应提交：`301041e`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 验证状态：Windows 门禁全部通过（自动化 + 打包启动 + 渲染预算 + 静默覆盖安装 + 主窗口可见性）

## 主要变化

- **一次切页从点击到完全可见 240ms 收到约 140ms**：页面过渡 `PAGE_ENTER` 0.2s + 0.04s 延迟 → 0.14s 无延迟、`PAGE_EXIT` 0.18 → 0.09s。只改时长。
- **设置页首访 481 → 202ms（最长任务 209 → 117ms）**：整仓订阅收到 3 个字段；9 台仪表预览收进 `memo`；挂载期状态查询挪到 `requestIdleCallback`；启动空闲期预热 7 族预览字体（约 17.1MB CJK 解码不再压在首次切页上）；预览区常驻合成层退回 `auto`。
- **统计页首访 128 → 72ms**：旧代码在首绘之后才写 `<html>` 的 `data-pal` / `data-font`，触发整轮全文档样式重算；改为首绘前同步写、值相同不写、卸载还原；`filteredSessions` 改单遍 `Map` 索引。
- **任务页首访 63 → 38ms、0 个 >50ms 长任务**：整页提交 4 次压到 2 次——树组装按引用记忆、去掉挂载期强制本地重读、骨架延迟 140ms 上屏、暖首访同步选中默认任务；冷启首进不再闪骨架。量宽改 `useLayoutEffect`，首访不再多一次重排。
- **逐页诊断与门禁**：`verify:budget` 新增 `--detail` / `--style` / `--probe`，新增 `scripts/verify/probe-settings-layout.js`；便携版冷启动不再计入预算（自解包约 120MB，量的是解包器）。
- **修掉上屏门禁的假失败**：`smoke:window-visible:launch` 原把多个日志文件拼成一条数组再取尾部，新行落在数组中间 → 「窗口已显示却报没有日志证据」。改为按文件比行数差 + 窗口出现后补 2s 只等日志行的短轮询（`FL-INSTALL-017`）。

## 验证

- 自动化门禁：`format:check`、`typecheck`（含 Worker）、`lint`、`npm test`（**150 文件 / 1271 项**）、`npm run build`、`npm run dist` 全部通过。
- 打包启动门禁：`npm run verify:packaged` PASS 2/2（`version=1.6.8`、`commit=301041e`、页面已回读、实例已回收）。
- 渲染预算门禁：`npm run verify:budget` PASS——安装包 119.87 MB、便携版 119.66 MB、`app.asar` 31.41 MB、运行时依赖 3 个；unpacked 冷启动 1392 ms、导航点击 p75 70 ms、最慢 186 ms、>50ms 长任务 2 个（最长 132 ms）、DOM 1015、JS 堆 7.2 MB。
- 逐页实测（`--detail` 三轮，点击→两帧 / 点击→主线程空闲）：任务 36/38 ms（0 长任务）、统计 70/72 ms、设置 165/202 ms（117 ms 长任务）、专注 31/33 ms；再访 12–47 ms。
- 安装门禁：静默覆盖安装退出码 0；卸载注册表回读 `DisplayName=FocusLink 1.6.8` / `DisplayVersion=1.6.8`；已安装 EXE 回读 `FileVersion=1.6.8` / `ProductVersion=1.6.8.0`；安装目录 345.00 MiB / 78 文件。
- 主窗口可见性：`npm run smoke:window-visible:launch` 退出码 0（pid 82932，主窗口 handle 6429752，实例已回收）。

## 升级提示

- Windows 使用安装器静默覆盖安装后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- 本轮只开发 PC（Windows）。Android 仅同步版本元数据（`1.6.8 / 1344`），未构建、未安装（本机全盘没有 `adb`），不得宣称 Android 端已验证。
- 既有本地数据库与设置原位保留；本轮不改数据库结构、IPC 语义与同步协议。
- 打包产物**从本仓库那条长中文路径直接拉起会崩溃**（`0x80000003`），这是拉起位置的环境效应、不是产物缺陷：手动双击验证请先把产物复制到短 ASCII 路径；安装器也从短路径复制后执行。详见 `FL-INSTALL-016`。

## 已知限制

- 本轮不动任何可见视觉。字号与间距刻度的单源化、任务/统计两套工作台样式合并仍属下一轮设计改版。
- 设置页首访仍有 117 ms 长任务（预览字体一次性栅格化）、统计页仍有 63 ms 长任务；冷启动 1.4–2.4 s 距 1.2 s 目标有差距。
- 任务页与账本仍无虚拟化；侧栏计数每次渲染重跑 `tasks.filter`、列表 `map` 内联闭包仍在，打字卡顿来源本轮未动。
- 试过并否掉：`.instrument-choice` 加 `content-visibility:auto`（无收益且首访 DOM 1566→1004 会让快滚跳空，已撤回）；页面保活 keep-alive（再访已 21–49 ms，且会改变 document 级监听与快捷键行为）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.6.8-x64.exe` | `D253B3FE138D08C946FAB505ED2219F7839F00C364808DC23BDBDDDDEB5384E5` |
| `FocusLink-1.6.8-x64-portable.exe` | `3A3D09DD49286AF134B8CD3DFAFF54D0EF0A0F539A498EB92E838F0E762678D4` |

同时提供 `SHA256SUMS.txt`。
