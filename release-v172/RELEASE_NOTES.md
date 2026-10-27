# FocusLink v1.7.2

> 发布日期：2026-10-27
>
> 对应提交：`<COMMIT>`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与 Windows / Xiaomi 安装回读通过；Huawei 平板按用户指令本轮不安装（未授权），不计入本版矩阵

## 主要变化

- **运行/暂停态页面高度回到 915**：专注操作回执从「64px 双行块」改成两行、40px 行钳（失败原因不再被单行省略号截断，全文仍由 `role=status` 播报），回执外边距收到 2px、时间之带画布 104 → 88；412×915 实测 idle / running / paused 的 `scrollHeight` 均为 915，`overflowX=0`。
- **九种计时仪表实测通过**：在真实 renderer 里逐一记录 `standard / flip / pixel / thin / segment / counter / analog / vernier / draft` 的几何与是否裁切——9/9 未裁切、几何各不相同；`analog` 表盘 154 → 132px 后不再让页面超出 1px。适配规则全部在 FOCUS 段 `.mobile-timer-stage` 下，未改共享 `TimerDial`。
- **修掉时间之带渲染缺陷（真实缺陷，不是优化）**：`MobileRibbon` 初版每帧调用 5 次 `getComputedStyle` 读 CSS 变量且不限帧，专注运行约 8 秒后渲染线程被拖死（CDP `Runtime.evaluate` 超时、watchdog 心跳归零）。改为按 `<html>` 类名缓存调色板（只有主题/强调色/字体切换才重算）+ 绘制循环限 25fps + 减少动效时只画静态一帧；修复后同一场景 14 秒 30 次心跳，三种模式 canvas 像素 3932 / 3600 / 4208 且切换无空画布。
- 桌面 Windows、Electron 主进程、IPC 与同步协议零改动，本轮只改 `src/mobile/` 与其测试。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **165 文件 / 1420 用例**（连续三轮中两轮全绿，另有一轮 1 项时序抖动，复跑即绿）；`build`、`build:web`、`dist` 成功；`verify:packaged` PASS；`verify:budget` PASS（安装包 119.87MB ≤130MB、运行时依赖 3 个）。
- 渲染核对（412×915）：idle / running / paused 三态 `scrollHeight` 均 915，回执两行可见、主操作底 390、三时间底 729、`overflowX=0`；九种仪表逐一切换无裁切。
- 安装矩阵（本版实测）：Windows 静默覆盖安装 `installer /S` → 卸载注册表 `DisplayVersion=1.7.2`、已装 `FocusLink.exe` 文件版本 `1.7.2`、`smoke:window-visible:launch` 主窗口句柄可见并回收实例；Xiaomi 22041216C `adb install -r` → 设备回读 `versionName=1.7.2`、`versionCode=1348`。Huawei DBY-W09 本轮未授权、未安装，不作为本版通过项。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并逐台回读 `versionName/versionCode`；生产连接只允许 canonical HTTPS authority，不配置 ADB reverse。
- 既有合法 `fl2` 凭据原位升级；如新设备登录 probe 返回 `not-deployed`，应保留旧设备在线并等待 canonical gateway 部署，不清除应用数据。

## 已知限制

- 统计页「有数据」的看板目前只在本地样本会话下核对（8 条合成会话），真机真实账本渲染需按周复核。
- 任务页「今天已完成」用 `isCompleted && updatedAt ≥ 今天零点` 推导：协议没有 `completedAt`，昨天完成、今天改过标题的任务会被计入。
- 时间之带刻度文字与「现在」游标标签在窄容器仍可能贴近：根因在共享 `TemporalRibbon.tsx`，桌面侧零改动约束下未修。
- 小米超级岛：只完成厂商协议选择，通知权限关闭时没有系统岛可见证据，本版不宣称已集成。
- 旧样式层迁移期仍被导入（工程债）：`mobile-parity-base.css` 等 5 张旧表仍由 `main.tsx` 挂载。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.7.2-x64.exe` | `90135d4fc0a6baeffd94718fd699c2e8acb49f342d7c2413f4e502bb2a4b2699` |
| `FocusLink-1.7.2-x64-portable.exe` | `179917d89fb26b8146c56c2ea7eaa7c2337f6df7f02043b4534aa2560dadeee3` |

同时提供 `SHA256SUMS.txt`。
