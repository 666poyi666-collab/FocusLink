# FocusLink v1.10.8

> 发布日期：2026-11-21
>
> 对应提交：`581ef5e`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁、打包启动自检、Windows 静默覆盖安装与可见性回读、小米同版安装回读通过；华为平板 adb 连接失败本轮未安装

## 主要变化

- **看板五卡依次显现**：统计页首次进入，Hero/律动/甜甜圈/榜单/热力五卡按 40ms 阶梯依次入场（240ms，expo-out 缓动）；此前 `anim-in-*` 类挂在 JSX 上但 CSS 从未定义，五卡是瞬时弹出的。
- **任务行「开始专注」快捷胶囊**：hover 或键盘聚焦任务行时，行尾 140ms 渐显「开始专注」按钮，点击即开无需进详情栏；已完成行与编辑态不渲染。
- **维护清理**：移除 2 处从未定义的 `pulseRing` 死引用；`.meta-pill` 的 `transition:all` 收窄为仅背景色/文字色。
- 动效降级完整：`prefers-reduced-motion` 下入场编排降级为 140ms 纯透明度、零阶梯，快捷胶囊位移静态化。

## 验证

- 源码门禁：`format:check` / `typecheck` / `lint` 全部 exit 0；`npm test` **181 文件 / 1580 用例全绿**；`verify:packaged` PASS（version=1.10.8，commit=581ef5e）。
- Windows：静默覆盖安装 exit 0，注册表 `DisplayVersion=1.10.8`、已安装 EXE `FileVersion=1.10.8`；`smoke:window-visible:launch` 通过（pid 24108，实例已回收）。
- Xiaomi：`adb install -r` 后回读 `versionName=1.10.8`、`versionCode=1384`。
- 华为平板：`adb connect 192.168.1.12:5555` 连接失败（10060 超时），本轮未安装、不计入通过。

## 升级提示

- 看板入场动画受系统「减弱动态效果」偏好控制，开启后自动降级为纯透明度渐显。
- 任务行快捷胶囊只在 hover/键盘焦点时出现，不新增常驻视觉噪音。

## 已知限制

- 华为平板本轮不可达，三端同版矩阵缺华为。
- KPI 数字不做 count-up：Hero 主读数首帧即出真实值，符合规范对统计页首帧的要求。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.10.8-x64.exe` | `7bb8d79549019c0096482ddcfd5c83e15684a4db08ab622f0af5b023d113940f` |
| `FocusLink-1.10.8-x64-portable.exe` | `d43616f5861538a2354f34ea8a338cc1f3df8c4f58c21875ff4a644d1ddb0ad6` |

同时提供 `SHA256SUMS.txt`。
