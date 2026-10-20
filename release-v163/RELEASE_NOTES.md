# FocusLink v1.6.3

> 发布日期：2026-10-15
>
> 对应提交：`0f8a544`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 验证状态：Windows 门禁全部通过（静态与单元 149 文件 / 1261 项全部通过、真实构建的无头 App 与 MiniWindow 性能回归通过、小窗全功能 smoke 10 项状态与边缘吸附全部通过、静默覆盖安装回读通过、安装版与便携版启动验收通过、主窗口可见性通过）；本轮用户明确只开发 PC，Android 仅同步版本元数据 1.6.3 / 1339，未构建、未安装、未验证；`main` 推送未获公开发布授权且本地 GitHub 仍受代理/TLS 环境限制保持本地。

## 主要变化

**桌面专注小窗细节深度打磨与重构。** 用户要求：「来重新设计一下小窗吧。小窗整体来说都可以，现在变成了圆角，经过一改版我觉得还可以更好。整体的样式都是这样子，但是我们需要打磨细节，由你来进行设计。还是老样子，我确定之后你再弄。」用户审阅交互原型后确认实施。

- **外轮廓与微光立体感**：收起态升级为 22px 饱满全胶囊圆角（`--radius-pill`），展开态升级为 16px 精密大圆角（`--radius-3xl`）；外层发丝描边软化，暗色模式增加 `inset 0 1px 0 rgb(var(--app-highlight) / 0.08)` 顶层微发丝受光边缘，在各种桌面壁纸下清晰悬浮。
- **剔除生硬割裂线**：彻底移除收起态右侧展开按钮的垂直实线，展开按钮改为内嵌式微交互胶囊（24px 命中区、全圆角 hover 泛光），内部浑然一体；展开态弱化模块间硬网格线，改用微背景色块与自然留白划分。
- **悬浮式秒流逝微轨**：收起态秒轨左右内缩 14px 悬浮（3px 高度），两端胶囊圆角收边，前沿配 2px 柔和微光斑，避免被外壳圆角裁切，暂停熔断引线粒子完整容纳在轨内。
- **操作按键人体工学优化**：展开态主操作按键（暂停/继续）与次操作按键（结束）赋予 `4px` 微圆角（`--radius-xs`），脱离贴角直角死板视感，主按键采用高饱和度微受光高光，次按键采用幽灵态，主次清晰、手感舒适。
- **任务标题平滑渐隐遮罩**：长标题跑马灯滚动在任务栏左右边缘加入线性渐隐 Mask，长文本平滑淡入淡出，不再突兀硬切。
- **指标排印微调**：累计专注、累计暂停、总历时三行指标开启严格等宽排版（Tabular Nums），数值靠右对齐，字重对比鲜明。
- **尺寸硬约束守护**：严格保持两态固定尺寸——收起态 `184 × 44` px，展开态 `256 × 70` px，数值源自 `shared/miniWindowLayout.ts`，未引入第三种尺寸。

## 验证

- `npm run format:check`、`npm run typecheck`（含 Cloudflare worker）、`npm run lint` 全部通过；`npm test` 149 文件 / 1261 项全部通过。
- `npm run smoke:mini`（小窗全功能 UI 与边缘吸附 smoke）全部通过：空闲展开态、运行展开态、运行收起态、置顶几何与 Win32 前台窗口身份保持、展开幂等性、暂停展开态、暂停收起态、浅色运行展开态、浅色暂停收起态、明暗主题无刷新往返、主题切换后停止控制、四边（左/右/顶/底）真实吸附收起与展开释放、Windows 原生 move-loop 释放门禁、新拖动取消待折叠、长 H:MM:SS 预设、长 CJK 跑马灯与减弱动态回退全部 PASS。
- `npm run smoke:performance` 全部通过：真实 App 本地优先任务加载、重复打开、变更事件、失败状态、共享主题（cachedTaskOpenMs: 111）；真实 MiniWindow 有界渲染、重复点击防抖、重试命令、两态尺寸、圆角与 DPR（pausedReactCommitsIn2500ms: 3）。
- 静默覆盖安装：`release-v163\FocusLink-1.6.3-x64.exe /S` 退出码 0；回读卸载注册表 `HKCU\...\Uninstall\21cd4128-7715-582c-bf2a-6446eb8ab7a5` → `DisplayName=FocusLink 1.6.3`、`DisplayVersion=1.6.3`；回读已安装 `%LOCALAPPDATA%\Programs\FocusLink\FocusLink.exe` → `FileVersion=1.6.3`、`ProductVersion=1.6.3.0`。
- 安装版与便携版启动验收：`node scripts/review/verify-startup.cjs <exe>` 对已安装 EXE 与 `FocusLink-1.6.3-x64-portable.exe` 均退出码 0，回读 `version=1.6.3`、`commit=0f8a544`、`hasShell=true`、`hasRail=true`、`hasNavButton=true`、`hasConsole=true`、`pauseToken="210 67 57"`。
- 主窗口可见性门禁 `npm run smoke:window-visible` 退出码 0：当前账户 5 个 FocusLink 进程，`pid=15368` 存在可见顶层窗口 `title="FocusLink"`，`handle=15732026`；日志回读证据 `main window shown {"trigger":"ready-to-show","force":false,"visible":true,"pid":15368}`。
- Git LFS 卫生：打包前后 `.git/lfs/tmp` 保持 0 文件 / 0 B，无任何临时文件泄漏。

## 升级提示

- Windows 使用安装器静默覆盖后已完成注册表与 EXE 校验并成功重启。
- 本轮为纯小窗 UI / 样式与无头验收修复：**未修改数据库结构、IPC 命令名或同步记录格式，未改变或删除任何历史数据。**
- 小窗保持两态固定尺寸（`184 × 44` / `256 × 70`），吸附延迟与贴边自动收起逻辑完全兼容既有配置。
- Android 未随本轮构建；手机与平板仍停留在上一版，不要按 1.6.3 核对移动端行为。

## 已知限制

- 三设备同版门禁未闭合：本轮用户限定只做 PC，未安装/未验证小米与华为，Android APK 未构建。
- 历史遗留未修：既有 Sync v2 冲突未清除；公网 `/sync/v2/live` 与 `/healthz` 仍受环境网络不可达影响。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.6.3-x64.exe` | `8AADB9FCE29E25A4F838CABFF421FEEC8EB471AA4F8E945D891EB5C057017656` |
| `FocusLink-1.6.3-x64-portable.exe` | `D5B6D5E0892B10B5459DAFB032AAC8B17DB687453C35ECA1AECD96393573FDC7` |

同时提供 `SHA256SUMS.txt`。
