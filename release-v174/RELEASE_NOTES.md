# FocusLink v1.7.4

> 发布日期：2026-10-27
>
> 对应提交：`8d581a2`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与 Windows / Xiaomi 安装回读通过；小米超级岛“岛上可见”未通过，本版不宣称该能力可用；Huawei 平板按用户指令不安装

## 主要变化

- **修掉一个真缺陷：本机专注从未到达原生层**。此前本机（未配对 / 离线）会话只存在于 WebView——`updateNativeFocusSnapshot` 在没有云端连接租约时直接抛错并被静默吞掉，原生 `updateSnapshot` 也以 `stale_connection` 拒绝。结果是：本机专注没有通知、没有锁屏控制、也没有小米超级岛。
- **三步修复**：① 本机权威快照允许无租约投递；② 原生侧为本机快照新增同 revision 覆盖路径（云端 idle rev=3 与本机 running rev=3 曾互相顶掉）；③ 云端快照改走 `putCloudSnapshotIfNoLocalAuthority`，本机权威存在时只作诊断、不覆盖本机运行态。
- **小米焦点通知载荷已投递成功**：本机会话运行时前台服务驻留，通知携带 `focuslink.systemSurface=xiaomi-island` 与完整 `miui.focus.param`（protocol 3、businessId、bigIslandArea / smallIslandArea），应用内「系统显示 → 小米系统表面」回读为 **使用中 · SystemUI 已接收**；SystemUI `FocusPlugin` 对本报文 `inflateFinishCallback=true`。
- **未完成（如实记录）**：超级岛的“岛上可见”未在 HyperOS 3 真机复现。`secure updatable_focus_notifs` 默认为空，手动加入本应用后仍未渲染（已恢复原值），判断剩余限制在 MIUI 侧应用白名单或字段规范，需继续核对，**本版不宣称超级岛可用**。
- 桌面 Windows、Electron 主进程、IPC 与同步协议零改动；改动集中在 `src/mobile/nativeFocusRuntime.ts` 与 Android 原生 `FocusRuntimePlugin` / `FocusRuntimeStore`。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **165 文件 / 1420 用例全绿**；`build`、`build:web`、`dist` 成功；`verify:packaged` PASS；`verify:budget` PASS。
- 真机链路（Xiaomi 22041216C / HyperOS 3）：logcat 依次出现 `Local-authority snapshot stored: ok=true, state=running` → `synchronize: state=running, fresh=true, canPost=true`；`dumpsys notification` 中该通知含 `miui.focus.param`；应用内回读 `SystemUI 已接收`；`FocusPlugin: inflateFinishCallback=true`。
- 安装矩阵（本版实测）：Windows 静默覆盖安装 `installer /S` → 卸载注册表 `DisplayVersion=1.7.4`、已装 `FocusLink.exe` 文件版本 `1.7.4`、`smoke:window-visible:launch` 主窗口句柄可见并回收实例；Xiaomi `adb install -r` → 设备回读 `versionName=1.7.4`、`versionCode=1350`。Huawei 本轮未安装。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并逐台回读 `versionName/versionCode`；生产连接只允许 canonical HTTPS authority，不配置 ADB reverse。
- 既有合法 `fl2` 凭据原位升级；如新设备登录 probe 返回 `not-deployed`，应保留旧设备在线并等待 canonical gateway 部署，不清除应用数据。

## 已知限制

- **小米超级岛未验收**：载荷已被 SystemUI 接收，但主屏未渲染岛上区域；需按 MIUI 焦点通知规范继续核对白名单与字段，不能宣称已可用。
- 统计页「有数据」的看板仍只在本地样本会话下核对过，真机真实账本渲染需按周复核。
- 任务页「今天已完成」用 `isCompleted && updatedAt ≥ 今天零点` 推导，协议没有 `completedAt`。
- 旧样式层迁移期仍被导入（工程债），5 张旧表仍由 `main.tsx` 挂载。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.7.4-x64.exe` | `0165a878b904197335a9c2bcc2f52b6bfe06691b3a885339cbc7b7c894ee421c` |
| `FocusLink-1.7.4-x64-portable.exe` | `3069044563d21087bd0fff9560db0d733798ae40f5a7e4c4e31e0407f1940f36` |

同时提供 `SHA256SUMS.txt`。
