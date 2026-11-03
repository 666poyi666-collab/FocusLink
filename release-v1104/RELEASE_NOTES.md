# FocusLink v1.10.4

> 发布日期：2026-11-03
>
> 对应提交：`085c8f9`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 构建说明：包内 `APP_COMMIT` 为 `085c8f9`，不含 `-dirty`；安装版 `app.asar` 与便携版启动回读一致。
>
> 验证状态：源码门禁、打包启动自检、Windows 静默覆盖安装与可见性回读、小米同版安装回读、`tomatodo:check` 真实运行均已实测；华为平板本轮不在线

## 主要变化

- **`tomatodo:check` / `tomatodo:approve` 不再一启动就 FATAL**：这两个运维脚本在 app ready 之前关闭硬件加速，并把 GPU 放进浏览器进程（`in-process-gpu`）。在此之前，本机受限环境里 Chromium 报 `GPU process launch failed: error_code=18` 后直接 `GPU process isn't usable. Goodbye.`，业务代码一行都没执行。
- **命令行可自救**：脚本参数解析忽略 Chromium 的 `--disable-*` / `--no-*` 开关，不再当成未知业务参数拒绝。
- 只影响本机运维脚本；桌面应用、同步协议、番茄同步与移动端不变。

## 验证

- 源码：`format:check`、`typecheck`、`lint` 退出码均为 0；`npm test` 180 个文件 / 1574 个用例全部通过；`npm run dist` 在本干净提交上产出安装版与便携版。
- **`npm run tomatodo:check` 实测**：退出 0，输出「等你批准 0 场 / 已上传 4 场（46′、5′、79′、7′，记录 646/647/649/648）」。修复前同一命令以 `-2147483645`（0xC0000003）退出，stderr 只有 GPU FATAL。
- 打包自检：`npm run verify:packaged` 退出 0，便携版回读 `version=1.10.4`、`commit=085c8f9`。
- 包内元数据：安装版 `app.asar` 的 `dist-electron/main-B42USaT4.js:987` 为 `085c8f9`、版本 `1.10.4`，全部 `dist-electron` 文件 `-dirty` 出现 0 次。
- Windows：`installer /S` 退出 0；注册表 `DisplayVersion=1.10.4`，已装 `FocusLink.exe` 文件版本 `1.10.4`；可见性冒烟通过（pid 82512 / handle 3483802）。
- 小米 22041216C：目标 `192.168.1.5:5555` 初始不在线，`adb connect` 恢复后 `install -r` 退出 0，回读 `versionName=1.10.4` / `versionCode=1380`，`lastUpdateTime=2026-11-03 08:49:09`，`firstInstallTime` 保留 `2026-09-10 16:56:24`；同期出现的 `192.168.1.4:5555`（同型号、offline）未连接、未安装。
- Android 单测：`:app:testDebugUnitTest` 41 个用例 / 0 失败（含 `FocusLinkConfigTest` 断言 `1.10.4`）；APK 备份 `33,901,016` 字节，SHA256 `40f286a8b4f6299250fee9320f92ab6e674ec64537d7356a121d6fa1ba7c4f6e`。
- 华为平板：`adb devices -l` 中未出现；按 2026-10-29 用户指令本轮只要求 Windows + 小米同版，平板未安装，不声称已安装。

## 升级提示

- Windows 直接覆盖安装；安装后回读卸载注册表与已安装 EXE 版本，再重启应用。
- 从 v1.10.3 升级只修正番茄运维脚本的启动路径；账本数据、界面行为与移动端不变。
- 运维脚本仍从源码目录运行（`npm run tomatodo:check` / `tomatodo:approve`），不随安装包分发。

## 已知限制

- 运维脚本仍要求仓库路径与 Electron 可运行；仓库路径含中文时 Android 单测需进程级 `JAVA_TOOL_OPTIONS=-Dfile.encoding=GBK`。
- `tomatodo:check` 的实时专注读取依赖设备同步凭据与系统代理；读不到时只降级报告，不影响本机账本。
- 批量 `/v1/sessions/batch-update` 仍无全有全无：`atomic: true` 直接拒绝，逐条失败不回滚。
- 华为平板本轮未参与同版门禁；恢复华为门禁前需要用户明确要求。
- `focuslinkCloudState` 仍返回 `unknown`（未接 V2 Outbox 投影）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.10.4-x64.exe` | `e9ba276d03cebc8181d2cc0799d6c1476f1ccec251a9204e814728b8bc0d5995` |
| `FocusLink-1.10.4-x64-portable.exe` | `f177ae93477fea62c7c88ed5df2de220e93492aee26c92b30bbb9aa2db9f08d4` |

同时提供 `SHA256SUMS.txt`。
