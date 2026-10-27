# FocusLink v1.7.3

> 发布日期：2026-10-27
>
> 对应提交：`9f977d1`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与 Windows / Xiaomi 安装回读通过；Huawei 平板按用户指令本轮不安装（未授权），不计入本版矩阵

## 主要变化

- **修时间之带「现在」标签被裁**：画布顶部为标签留出空间（标签基线固定 23px、通道从 25px 起、轴线 `height − 24`、刻度文字基线 `height − 6`、刻度字号 10 → 11px），三种模式共用同一套纵向分区，所以「现在 / 暂停」标签高度一致且完整，底部 10 / 20 / 30 刻度不再被挤掉。
- **画布与滑杆高度重新配平**：时间之带画布 88 → 96px、视野滑杆行 48 → 36px；412×915 下 idle / running / paused 三态 `scrollHeight` 仍为 915，两行操作回执仍完整可读。
- 其余与 v1.7.2 相同：流线 / 光栅 / 时段三种时间之带、九种计时仪表真实切换、任务与统计看板、可见操作回执、`MobileRibbon` 渲染性能修复（调色板缓存 + 25fps 限帧）。
- 桌面 Windows、Electron 主进程、IPC 与同步协议零改动，本轮只改 `src/mobile/`。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **165 文件 / 1420 用例全绿**；`build`、`build:web`、`dist` 成功；`verify:packaged` PASS；`verify:budget` PASS（安装包 119.87MB ≤130MB、运行时依赖 3 个）。
- 渲染核对（412×915 亮色）：idle / running / paused 三态 `scrollHeight` 均为 915，主操作底 390、三时间底 725、画布高 96、`overflowX=0`；流线 / 光栅 / 时段三种模式截图里「现在」标签完整、刻度齐全。
- 安装矩阵（本版实测）：Windows 静默覆盖安装 `installer /S` → 卸载注册表 `DisplayVersion=1.7.3`、已装 `FocusLink.exe` 文件版本 `1.7.3`、`smoke:window-visible:launch` 主窗口句柄可见并回收实例；Xiaomi 22041216C `adb install -r` → 设备回读 `versionName=1.7.3`、`versionCode=1349`。Huawei DBY-W09 本轮未授权、未安装，不作为本版通过项。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并逐台回读 `versionName/versionCode`；生产连接只允许 canonical HTTPS authority，不配置 ADB reverse。
- 既有合法 `fl2` 凭据原位升级；如新设备登录 probe 返回 `not-deployed`，应保留旧设备在线并等待 canonical gateway 部署，不清除应用数据。

## 已知限制

- 统计页「有数据」的看板目前只在本地样本会话下核对（8 条合成会话），真机真实账本渲染需按周复核。
- 任务页「今天已完成」用 `isCompleted && updatedAt ≥ 今天零点` 推导：协议没有 `completedAt`，昨天完成、今天改过标题的任务会被计入。
- 时间之带刻度文字与「现在」游标标签在极窄容器仍可能贴近；桌面共享组件 `TemporalRibbon.tsx` 本轮未改。
- 小米超级岛：只完成厂商协议选择，通知权限关闭时没有系统岛可见证据，本版不宣称已集成。
- 旧样式层迁移期仍被导入（工程债）：`mobile-parity-base.css` 等 5 张旧表仍由 `main.tsx` 挂载。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.7.3-x64.exe` | `4ec3ad6020dfaa2f8ad9253d744cceba8f32253ac82fad2b4afba2f9c8172a70` |
| `FocusLink-1.7.3-x64-portable.exe` | `0e61a95227159bbe61eaa39dabb58fba00bee67fcacbdd49ec97e7da619afcdb` |

同时提供 `SHA256SUMS.txt`。
