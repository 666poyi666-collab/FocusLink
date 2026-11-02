# FocusLink v1.10.1

> 发布日期：2026-11-02
>
> 对应提交：`cf1b68b`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 构建说明：包内 `APP_COMMIT` 为 `cf1b68b`，不含 `-dirty`；安装版 `app.asar` 与便携版启动回读一致。
>
> 验证状态：源码门禁、打包启动自检、Windows 静默覆盖安装与可见性回读、小米同版安装回读、Android 单测均已实测；华为平板本轮不在线

## 主要变化

- **批准会留痕**：界面「立即上传」、自动化 `tomatodo.sync` 与 `focuslink` 命令行写入成功后，FocusLink 会把学科与自定义标题写回这一场专注。此前的实现只在内存里算出名字去写番茄，会话字段仍是空，状态与待批准列表会把它重新算成「从未批准」，同一场可能被再同步一次。
- **拉番茄不再被环境变量打断**：从带 `ELECTRON_RUN_AS_NODE` 的开发/自动化终端启动番茄 To-do 时，FocusLink 会先清掉这个变量再拉起子进程；此前该变量让番茄以纯 Node 模式退出（`bad option`，退出码 9），同步桥永远连不上。
- 其余功能与 v1.10.0 一致；本版是 PC 端番茄同步修复。

## 验证

- 源码：`format:check`、`typecheck`、`lint` 退出码均为 0；`npm test` 177 个文件 / 1552 个用例全部通过；`npm run dist` 在本干净提交上产出安装版与便携版。
- 打包自检：`npm run verify:packaged` 退出 0，便携版回读 `version=1.10.1`、`commit=cf1b68b`。
- 包内元数据：安装版 `app.asar` 的 `dist-electron/main-pYTTyYrD.js:987` 为 `cf1b68b`、版本 `1.10.1`，全部 `dist-electron` 文件 `-dirty` 出现 0 次。
- Windows：`installer /S` 退出 0；注册表 `DisplayVersion=1.10.1`，已装 `FocusLink.exe` 文件版本 `1.10.1`；`smoke:window-visible:launch` 通过（pid 12752 / handle 599666），重启后 `smoke:window-visible` 通过（pid 41236 / handle 796258）。
- 小米 22041216C（`192.168.1.5:5555`）：`adb install -r` 退出 0，回读 `versionName=1.10.1` / `versionCode=1377`，`lastUpdateTime=2026-11-02 11:28:34`，`firstInstallTime` 保留 `2026-09-10 16:56:24`。
- Android 单测：`:app:testDebugUnitTest` 41 个用例 / 0 失败（含 `FocusLinkConfigTest` 断言 `1.10.1`）；APK 备份 `33,901,012` 字节，SHA256 `06a0dc193036816555c8b8bfbcceef2e86753e786177b8f79f83ba92b6cce817`。
- 华为平板：`adb devices -l` 中未出现；按 2026-10-29 用户指令本轮只要求 Windows + 小米同版，平板未安装，不声称已安装。

## 升级提示

- Windows 直接覆盖安装；安装后回读卸载注册表与已安装 EXE 版本，再重启应用。
- 从 v1.10.0 升级只修正番茄同步的批准留痕与启动环境，账本数据、界面行为与本机自动化接口均不变。
- 小米使用同一 APK `adb install -r` 原位升级，配对与账号数据保留。

## 已知限制

- **运维脚本运行仍未能验证**：本机 `electron.exe <script>` 不执行，需在真实终端复核。
- 安装器仍要求 ASCII 路径运行；打包侧已自动化，安装侧未修。
- 华为平板本轮未参与同版门禁；恢复华为门禁前需要用户明确要求。
- `focuslinkCloudState` 仍返回 `unknown`（未接 V2 Outbox 投影）。
- 番茄 To-do 只存整数分钟，含暂停的会话在番茄里的终点会早于真实结束时间（暂停不前推终点，FL-SYNC-020 既定口径）。
- 仓库路径含中文时，Android 单测需要进程级 `JAVA_TOOL_OPTIONS=-Dfile.encoding=GBK`，否则测试 argfile 解码失败报 `ClassNotFoundException`；这是环境绕行，不是产品缺陷。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.10.1-x64.exe` | `75c61681adbbc18f6b67a360098d61e3ca0e8e2758dedbc39b2bd5ea39fd266f` |
| `FocusLink-1.10.1-x64-portable.exe` | `3d156081846d20fc6607f4266da801ee6c90d87a6940f523adb5c981a33e5dfc` |

同时提供 `SHA256SUMS.txt`。
