# FocusLink v1.9.4

> 发布日期：2026-11-02
>
> 对应提交：`bd1aa37`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 验证状态：源码门禁、Windows 安装回读与小米同版均已实测；renderer 刷新与运维脚本运行输出留作下轮复核

## 主要变化

- **人工修改推进记录版本**：界面改学科、标题、任务关联、合并片段，与接口写入走同一个入口，都会推进 `recordVersion` 并写提交事件。AI 持旧版本再改会被拒绝并返回当前版本，不会覆盖人工刚保存的值。
- **云端导入同样计入版本**：设备同步导入的会话也推进版本并通知界面。
- **历史与统计实时刷新**：新增 `records:changed` 事件，打开中的统计页、会话账本与侧栏汇总收到后立即重取，不必手动切页。
- **运维脚本不再被代理探测挡住**：`tomatodo:check` / `tomatodo:approve` 只在实时读取前初始化系统代理，失败降级为直连；退出改正常流程并带 5 秒兜底。

## 验证

- 源码：`format:check` / `typecheck` / `lint` 通过；`npm test` 177 文件 / 1548 用例全绿；`npm run build` 成功。
- 契约测试：人工改后 AI 旧版本写入返回 `VERSION_CONFLICT` 且值未被覆盖；事务回滚不推进版本；不同连接 scope 版本隔离。
- Windows：`installer /S` 退出 0，回读 `DisplayVersion=1.9.4`、已装 EXE 文件版本 `1.9.4`；重启后 `smoke:window-visible` 通过（主窗口 handle 1648136）。
- 小米：`adb install -r` 成功，回读 `versionName=1.9.4` / `versionCode=1370`。
- 安装版 CLI：免环境变量 `focuslink doctor` 返回 `ok`、`version=1.9.4`。
- 华为按 2026-10-29 指令不在线，未安装。

## 升级提示

- Windows 先在托盘退出应用，再从**纯 ASCII 路径**运行安装器（中文路径下 NSIS 必失败，见已知限制），安装后回读注册表与 EXE 版本并重启。
- Android 使用同一 APK `adb install -r`，保留应用数据并回读版本。

## 已知限制

- **renderer 刷新只做了代码接线**：事件已订到历史统计的三处加载点并通过类型检查，但没有在真实窗口走一遍「改学科 → 看统计是否即时刷新」。
- **运维脚本未取得运行输出**：本机自动化环境下 Electron 子进程既不写 stdout 也不落日志，脚本改动只有代码与类型检查背书，需在真实终端跑一次 `npm run tomatodo:check` 复核。
- 中文路径下打包与安装器仍会失败，本轮继续用 ASCII 输出目录绕过；未从源码层修复。
- 安装包未内置 `focuslink` 命令入口，CLI 仍需从源码目录运行。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.9.4-x64.exe` | `04833bf0c6ebc538f1a4784cc8807815f8b8fd6ebc09811173baf38ad3b0ed29` |
| `FocusLink-1.9.4-x64-portable.exe` | `6f8db00a70533591ae2ae4f8630ef6be7d16fa642b27fde65482988d69bc45fa` |

同时提供 `SHA256SUMS.txt`。
