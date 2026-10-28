# FocusLink v1.8.3

> 发布日期：2026-10-28
>
> 对应提交：`7febb19`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与 Windows / Xiaomi 安装回读通过；顶部胶囊默认开启后的真机画面未核验（手机在使用中，未再操作界面）；Huawei 平板按用户指令不安装

## 主要变化

- **顶部胶囊默认开启**：`FocusRuntimeSystemSettings.isOverlayEnabled` 的默认值由 `false` 改为 `true`——权限没给时 `FocusDesktopOverlayController` 自己会跳过绘制，不需要用户先找到开关；用户显式关闭过才尊重关闭值。这样 Xiaomi 上不依赖 MIUI 超级岛也能看到置顶计时胶囊。
- **悬浮窗权限已用 adb appops 授权并保留**：`SYSTEM_ALERT_WINDOW: allow`，配合默认开启，安装后无需在设置里点「悬浮条」。
- 其余沿用 v1.8.2：详情面板整屏与 `detail_*` 布局直译、任务行按 `standard_task_list_item` 直译、圆角方形勾选框、资源真值配色、滑动完成/移清单、清单抽屉、root 授权路径。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **165 文件 / 1420 用例全绿**；`build`、`build:web`、`dist` 成功。
- 安装矩阵（本版实测）：Windows 静默覆盖安装 → `DisplayVersion=1.8.3`、EXE `1.8.3.0`；Xiaomi `adb install -r` → 回读 `versionName=1.8.3`、`versionCode=1359`。Huawei 未安装。
- **未完成**：胶囊真机画面。核对时手机停留在 B 站直播页（用户正在使用），已停止一切设备操作，没有把「胶囊可见」写成已验证。

## 升级提示

- Windows 静默覆盖安装后必须回读卸载注册表与已安装 EXE 版本并重启应用。
- Android `adb install -r` 保留数据，逐台回读 `versionName/versionCode`。
- 顶部胶囊默认开启；如不想看，在「设置 → 系统显示 → 悬浮条」关闭一次即可记住。

## 已知限制

- **小米超级岛仍未打通**：载荷已被 SystemUI 接收，但主屏不渲染；本轮查了 `/data/system`（`HyperNotificationDatabase.db` 的 `switches` 表为空、无 focus 白名单文件），MIUI 侧没有可写的白名单入口。当前替代就是默认开启的顶部胶囊。
- **胶囊未真机核验**：需要一次运行中的专注会话才能看到，核对时无法安全操作手机。
- **编辑类交互仍缺**：任务协议只有创建/完成/移动三种写入。
- 旧样式层迁移期仍被导入（工程债）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.8.3-x64.exe` | `351dd879d408e1e3a5d5dfb9fb05ffc7abae5ec8d7d7e0ff73565e8bbc18047a` |
| `FocusLink-1.8.3-x64-portable.exe` | `9a7762b3038f4aa74e18041a58dfd288bed005f474c485c5644b7fe6b519c377` |

同时提供 `SHA256SUMS.txt`。
