# FocusLink v1.10.0

> 发布日期：2026-11-02
>
> 对应提交：`07cf5a7`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 构建说明：包内 `APP_COMMIT` 为 `07cf5a7`，不含 `-dirty`；安装版 `app.asar` 与便携版启动回读一致。
>
> 验证状态：源码门禁、打包启动自检、Windows 静默覆盖安装与可见性回读、小米同版安装回读、Android 单测均已实测；华为平板本轮不在线

## 主要变化

- **功能与 v1.9.9 一致**：记录被人工保存、AI 补录/修正或云端导入后，展开的历史详情与番茄控件会重新拉取；番茄标题输入框的未提交内容按会话暂存，外部更新不会清掉草稿，保存或 Esc 才清除。
- **本版是构建来源修正**：v1.9.9 的产物内嵌 `0768633-dirty`（打包发生在提交之前），不满足「干净提交构建、包内元数据不得含 `-dirty`」的门禁。本版从干净提交 `07cf5a7` 重建，包内提交与发布记录一致。
- **版本进入下一个 minor**：1.9.x 的补丁号到 9 为止，按仓库规则改为 1.10.0；Android `versionCode` 同步为 1376。

## 验证

- 源码：`format:check`、`typecheck`、`lint` 退出码均为 0；`npm test` 177 个文件 / 1548 个用例全部通过；`npm run dist` 在本干净提交上产出安装版与便携版。
- 打包自检：`npm run verify:packaged` 退出 0，便携版回读 `version=1.10.0`、`commit=07cf5a7`。
- 包内元数据：安装版 `app.asar` 的 `dist-electron/main-WezFA_U8.js:987` 为 `07cf5a7`，该文件 `-dirty` 出现 0 次。
- Windows：`installer /S` 退出 0；注册表 `DisplayVersion=1.10.0`，已装 `FocusLink.exe` 文件版本 `1.10.0`；`smoke:window-visible:launch` 通过（pid 46708 / handle 468540），重启后 `smoke:window-visible` 通过（pid 78224 / handle 403076）。
- 小米 22041216C（`192.168.1.5:5555`）：`adb install -r` 退出 0，回读 `versionName=1.10.0` / `versionCode=1376`，`lastUpdateTime=2026-11-02 09:56:38`，`firstInstallTime` 保留 `2026-09-10 16:56:24`。
- Android 单测：`:app:testDebugUnitTest` 41 个用例 / 0 失败（含 `FocusLinkConfigTest` 断言 `1.10.0`）；APK 备份 `33,901,016` 字节，SHA256 `b7fe26057a2257e6d0f7020debe5805251f9d4ae7009ebf3673d433022c6f10a`。
- 华为平板：`adb devices -l` 中未出现；按 2026-10-29 用户指令本轮只要求 Windows + 小米同版，平板未安装，不声称已安装。

## 升级提示

- Windows 直接覆盖安装；安装后需回读卸载注册表与已安装 EXE 版本，再重启应用。
- 从 v1.9.9 升级只修正构建来源，账本数据、界面行为与本机自动化接口均不变。
- 小米使用同一 APK `adb install -r` 原位升级，配对与账号数据保留。

## 已知限制

- **运维脚本运行仍未能验证**：本机 `electron.exe <script>` 不执行，需在真实终端复核。
- 安装器仍要求 ASCII 路径运行；打包侧已自动化，安装侧未修。
- 华为平板本轮未参与同版门禁；恢复华为门禁前需要用户明确要求。
- `focuslinkCloudState` 仍返回 `unknown`（未接 V2 Outbox 投影）。
- 仓库路径含中文时，Android 单测需要进程级 `JAVA_TOOL_OPTIONS=-Dfile.encoding=GBK`，否则测试 argfile 解码失败报 `ClassNotFoundException`；这是环境绕行，不是产品缺陷。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.10.0-x64.exe` | `1a89adc6c6a349d53b379c5c27dd734c8c423c626e5fd7097ed93012aef06b23` |
| `FocusLink-1.10.0-x64-portable.exe` | `a12770fa3082d1b03f3407e9af25864ca66aebb5269dce98a195cfc9eda4afdf` |

同时提供 `SHA256SUMS.txt`。
