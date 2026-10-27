# FocusLink v1.7.6

> 发布日期：2026-10-28
>
> 对应提交：`<COMMIT>`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与 Windows / Xiaomi 安装回读通过；Huawei 平板按用户指令不安装；小米超级岛仍未渲染（本版不宣称可用）

## 主要变化

- **任务页按滴答清单复刻**：用 REA（`morluto/rea`）配合真机节点树与截图反查界面后重写移动端任务页——浅灰底 + 白色圆角面板、圆形优先级复选框（高/中/低/无四色）、44px 行高、右侧红色延期天数、父任务展开箭头与子任务缩进、按清单分组、蓝色右下新建按钮、清单抽屉、底部四项导航（激活项蓝底图标 + 蓝字）。
- **新建与详情**：新建任务是底部面板（标题 + 清单选择）；任务详情是底部面板（清单、完成、勾选框 + 日期、标题、标签、子任务列表、开始专注）。数据仍走 FocusLink 任务快照，`onCreate` / `onToggleComplete` / `onStart` 行为与旧任务页一致。
- **root 顶部胶囊**：`openOverlayPermissionSettings` 先尝试 `su -c appops set … SYSTEM_ALERT_WINDOW allow`，授权成功即自动开启悬浮；悬浮计时改为顶部黑色胶囊（圆点 + 计时，暂停变红点），点按回应用，默认居中置顶。
- **任务视图隐藏品牌栏**：任务页不再显示 FOCUSLINK 顶栏，改为滴答清单式应用栏（清单按钮 / 标题 / 更多），其余页面不变。
- 承接 v1.7.4 的本机通知链路：本机（未配对 / 离线）专注照样进原生前台服务，通知携带 MIUI 焦点通知载荷。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **165 文件 / 1420 用例全绿**；`build`、`build:web`、`dist` 成功；`verify:packaged` PASS；`verify:budget` PASS（导航 p75 70ms、DOM 1015 节点、JS 堆 7MB）。
- 界面核对（Xiaomi 22041216C / HyperOS 3，真机截图）：任务列表（27 条真实任务，分组、子任务缩进、红色「24天」延期、已完成灰行）、清单抽屉、新建任务面板、任务详情面板四项均渲染正常；首屏安全区、底部导航与状态栏不再重叠。
- 安装矩阵（本版实测）：Windows 静默覆盖安装 `installer /S` → 卸载注册表 `DisplayVersion=1.7.6`、已装 `FocusLink.exe` 文件版本 `1.7.6`、`smoke:window-visible:launch` 主窗口可见并回收实例；Xiaomi `adb install -r` → 设备回读 `versionName=1.7.6`、`versionCode=1352`。Huawei 本轮未安装。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并逐台回读 `versionName/versionCode`。
- 顶部胶囊需要 root；无 root 时仍走系统「显示在其他应用上层」授权页。

## 已知限制

- **小米超级岛仍未渲染**：焦点通知载荷已被 SystemUI 接收（v1.7.4 记录），但主屏不出现岛上区域；替代方案是顶部胶囊。
- 任务页只复刻了任务主路径（列表 / 抽屉 / 新建 / 详情）；搜索、批量操作、清单改名与删除入口尚未搬进新界面，仍由旧逻辑承载。
- 统计页「有数据」的看板仍只在本地样本会话下核对过。
- 旧样式层迁移期仍被导入（工程债），5 张旧表仍由 `main.tsx` 挂载。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.7.6-x64.exe` | `9dc050f7e643f5e20e533495290a295573e930a27dc2935594d7bb0adc9f6baa` |
| `FocusLink-1.7.6-x64-portable.exe` | `b66db6af3ea5979350919c51ad7ad1be697a92a4893e664cb80e3ee9187cd85a` |

同时提供 `SHA256SUMS.txt`。
