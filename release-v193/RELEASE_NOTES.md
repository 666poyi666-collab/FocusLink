# FocusLink v1.9.3

> 发布日期：2026-11-02
>
> 对应提交：`6a2c13a`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 验证状态：源码门禁与便携版启动自检通过；小米真机已装同版；**Windows 覆盖安装未完成**（本机 1.9.2 实例以高完整性级别运行，中等完整性进程无法结束它，安装器无法替换被占用的 EXE）

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
- 接口实测：隔离 profile 启动打包产物后，`doctor` / `status` / `records create` / `records list` / `tomatodo preview` / `focus start·pause·resume·finish` 全部 applied；缺口修正返回 `TIMELINE_GAP`，同 operationId 重放返回 `duplicate`。
- 设备矩阵：小米 `192.168.1.5:5555` 已装 `1.9.3 / 1369`；Windows 未安装；华为按 2026-10-29 指令不在线。

## 升级提示

- Windows 必须先在托盘退出正在运行的 FocusLink，再用安装器静默覆盖，并回读卸载注册表与已安装 EXE 版本后重启应用。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并回读 `versionName/versionCode`。
- 首次启动会在 `%APPDATA%\focuslink\automation` 生成凭据与发现配置；旧 ProgramData 凭据与环境变量仍按原优先级生效，不会被静默轮换。

## 已知限制

- 安装包尚未内置 `focuslink` 可执行入口，CLI 目前需从源码目录（`npm run focuslink -- …`）运行；HTTP 接口不受影响。
- `focuslinkCloudState` 尚未接入 V2 Outbox 投影，当前如实返回 `unknown`。
- 删除、任意 SQL、脚本执行、番茄远端删除与回读均未开放。
- 仓库位于中文路径时 `electron-builder` 会失败（NSIS 报 `Error writing temporary file`），本次改用 `C:\fl-release-193` 输出后再复制回发布目录；该问题未在源码层修复。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.9.3-x64.exe` | `b3d13135302f57976051574c5d095e4655e97fa900fbe53e70561257a5b6bb51` |
| `FocusLink-1.9.3-x64-portable.exe` | `08dae9766b7abf8095bc931e2a520003fa6e2d857c644f6a6ad3019399b1ea11` |

同时提供 `SHA256SUMS.txt`。
