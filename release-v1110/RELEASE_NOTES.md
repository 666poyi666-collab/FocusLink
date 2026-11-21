# FocusLink v1.11.0

> 发布日期：2026-11-21
>
> 对应提交：`b4dafdb`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁、打包启动自检、Windows 静默覆盖安装与可见性回读通过；按用户 2026-11-21 PC-only 指令，小米/华为本轮不安装、不验收

## 主要变化

- **动效时长整体收敛**：`--dur-micro` 140→120ms、`--dur-base` 240→200ms、`--dur-page` 360→320ms，并新增退出缓动 `--ease-exit`（cubic-bezier(0.4,0,1,1)）；表盘/图表/图标等 8 处静态兜底字面量同步收窄。
- **交互叠加层 token 落地**：新增 `--app-hover-fill`/`--app-press-fill`/`--app-selected-fill` 三档（亮 0.04/0.08/accent 0.08，暗 0.06/0.12/0.14），linear 调色板继承映射改指 foundation token，暗色自动升档。
- **任务行状态矩阵补全**：hover 200ms、`:active` 下沉 1px + 按压底色、`:focus-visible` 2px 焦点环；行高改 min-height 容纳换行，密度三档（紧凑 44 / 标准 56 / 宽松 64px）token 化并接线 HistoryPanel `data-density`。
- **看板卡片 hover 去噪**：移除 translateY 上浮与投影增量，只保留 120ms accent 细边过渡；紧凑密度下看板卡内边距 20→16px。
- **reduced-motion 降级完整**：入场编排与状态过渡均降级为纯透明度/静态位移，无位移阶梯。

## 验证

- 源码门禁：`format:check` / `typecheck` / `lint` 全部 exit 0；`npm test` **181 文件 / 1580 用例全绿**；`verify:packaged` PASS（version=1.11.0，commit=b4dafdb，页面就绪 7441ms）。
- Windows：静默覆盖安装后注册表 `DisplayVersion=1.11.0`、已安装 EXE `FileVersion=1.11.0`（写入时间 22:19:06，对应 b4dafdb 构建波）；`smoke:window-visible:launch` 通过（pid 8388，实例已回收）。
- 小米 / 华为平板：按用户 2026-11-21 PC-only 指令，本轮不安装、不验收。
- Android debug APK（versionName 1.11.0 / versionCode 1385）已构建并本地备份，未装机。

## 升级提示

- 动效时长变化全局生效：hover/按压反馈更跟手，页面切换不变帧率前提下略快。
- 若系统开启「减弱动态效果」，所有入场与状态动效自动降级为纯透明度渐显。

## 已知限制

- 本轮按 PC-only 指令不做移动端装机验收，三端同版矩阵缺小米/华为两项。
- 详情栏字段行距维持现状（提案 §2.4「详情字段距」语义未定稿，未盲改）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.11.0-x64.exe` | `83b683bbe23d462c7eb24a7f45fe4fb4da9d39f63b756d025ec71c48bb8632d7` |
| `FocusLink-1.11.0-x64-portable.exe` | `3d7fd68963b780b2a671335df19d235315e2ba25d509c885183e779c4e9f362c` |

同时提供 `SHA256SUMS.txt`。
