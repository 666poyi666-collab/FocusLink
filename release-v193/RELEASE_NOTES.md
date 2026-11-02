# FocusLink v1.9.3

> 发布日期：2026-11-02
>
> 对应提交：`6a2c13a`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 验证状态：已通过（Windows 覆盖安装与小米真机同版均已实测回读）

## 主要变化

- **本地自动化接口**：新增 `/automation/v1`（状态、记录、汇总、能力、操作查询、提交事件、番茄预览）与 `focuslink` 本机命令，AI 与其他项目可读取当前专注、补录历史、修正已结束记录并控制计时。
- **版本闸门**：每条写命令必须带 `operationId`、预期版本与有效期；旧版本请求被明确拒绝并返回当前状态，不覆盖人工刚做的操作。
- **人工与 AI 同源**：按钮、快捷键、托盘与接口操作同一份账本；提交事件带单调序号，变化可续读、可取一致快照。
- **补录与修正严守时间守恒**：时间线必须覆盖整段，缺口/重叠/越界一律拒绝；修正必须附原因并保留修正链。
- **番茄仍为批准后同步**：预览绑定记录版本，记录变化即拒绝执行；结果分阶段返回本地写入、上传确认与手机可见性。
- **凭据按权限拆分**：首次启动在用户目录签发全权与只读两条 token；只读凭据不能控制计时、补录或同步番茄。

## 验证

- 源码：`format:check` / `typecheck` / `lint` 通过；`npm test` 176 文件 / 1542 用例全绿；`npm run build` 成功。
- 产物：`verify:packaged` 便携版 PASS（version=1.9.3、commit=6a2c13a、页面就绪 7281ms、实例已回收）。
- 接口实测：打包装置端到端跑通 `doctor` / `status` / `records create·list` / `tomatodo preview` / `focus start·pause·resume·finish`；缺口修正返回 `TIMELINE_GAP`，同 operationId 重放返回 `duplicate`。
- Windows：`installer /S` 退出 0；回读卸载注册表 `DisplayVersion=1.9.3`、已装 `FocusLink.exe` 文件版本 `1.9.3`；重启后 `smoke:window-visible` 通过（主窗口 `FocusLink` 可见，handle 74384812）。
- 开箱可用：全新安装后无需任何环境变量，`focuslink doctor` 直接返回 `ok`，凭据与发现配置自动落在 `%APPDATA%\focuslink\automation`。
- 设备矩阵：Windows 1.9.3、小米 `192.168.1.5:5555` `1.9.3 / 1369` 同版；华为按 2026-10-29 指令不在线。

## 升级提示

- Windows 必须先在托盘退出正在运行的 FocusLink，再从**纯 ASCII 路径**运行安装器（见下方已知限制），安装后回读注册表与 EXE 版本并重启。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并回读 `versionName/versionCode`。
- 首次启动会在 `%APPDATA%\focuslink\automation` 生成凭据与发现配置；旧 ProgramData 凭据与环境变量仍按原优先级生效，不会被静默轮换。

## 已知限制

- **中文路径下安装器必失败**：安装器位于含中文的目录时 NSIS 直接以退出码 2 结束（`Error writing temporary file`）。本次改为从 `C:\fl-release-193` 运行；产物文件本身相同。该问题未在源码层修复。
- 安装包尚未内置 `focuslink` 可执行入口，CLI 目前需从源码目录（`npm run focuslink -- …`）运行；HTTP 接口不受影响。
- 旧版卸载器静默运行返回 0 但不会真正清理，升级时表现为 `installer /S` 退出 2；本次先完成卸载再安装。
- `focuslinkCloudState` 尚未接入 V2 Outbox 投影，当前如实返回 `unknown`。
- 删除、任意 SQL、脚本执行、番茄远端删除与回读均未开放。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.9.3-x64.exe` | `b3d13135302f57976051574c5d095e4655e97fa900fbe53e70561257a5b6bb51` |
| `FocusLink-1.9.3-x64-portable.exe` | `08dae9766b7abf8095bc931e2a520003fa6e2d857c644f6a6ad3019399b1ea11` |

同时提供 `SHA256SUMS.txt`。
