# FocusLink v1.6.5

> 发布日期：2026-10-15
>
> 对应提交：`142a64e`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 验证状态：Windows 门禁全部通过（静态与单元 149 文件 / 1261 项全部通过、真实构建的无头 App 与 MiniWindow 性能回归通过、小窗全功能 smoke 10 项状态与边缘吸附全部通过、静默覆盖安装回读通过、安装版与便携版启动验收通过、主窗口可见性通过）；本轮用户明确只开发 PC，Android 仅同步版本元数据 1.6.5 / 1341，未构建、未安装、未验证；`main` 推送未获公开发布授权且本地 GitHub 仍受代理/TLS 环境限制保持本地。

## 主要变化

**桌面专注小窗真实双列架构精工对齐与微光雕琢落地。** 响应用户对旧版原型挤压折行缺陷（「累计专/注」折行、时间与按键被截断）的反馈并落实正式确认的设计方案。

- **彻底对齐真实双列网格架构**：顶部 20px 栏 + 主体 48px 双列网格（左列 ~150px 专注大核心 + 右列 104px 精密控制台），强制单行 `white-space: nowrap` 与 Tabular Nums 等宽对齐，彻底根除任何字形挤压、换行与底部截断。
- **微光立体感与外轮廓微弧度（方案 1）**：收起态升级为 22px 饱满全胶囊圆角，展开态 16px 精密大圆角；顶层微发丝受光边框与暗曜石多层阴影（`inset 0 1px 0 rgb(var(--app-highlight) / 0.12), 0 8px 24px rgb(0 0 0 / 0.4)`），悬浮质感温润通透。
- **操作按键与时间排印精修**：展开态主操作按键保留 4px 人体工学微圆角与翡翠微受光高光，次操作按键幽灵态透明对比；大时间数字字重 650 零字距抗锯齿渲染；三行指标（累计专注/累计暂停/总历时）等宽右对齐，对比分明。
- **长标题渐隐跑马灯**：任务栏左右边缘保留 6px 线性渐隐 Mask，长文本平滑进入移出，滚动舒展自然。
- **尺寸与烟测指标硬约束守护**：严格保持两态固定尺寸——收起态 `184 × 44` px，展开态 `256 × 70` px，数值源自 `shared/miniWindowLayout.ts`，未引入第三种尺寸。

## 验证

- `npm run format:check`、`npm run typecheck`（含 Cloudflare worker）、`npm run lint` 全部通过；`npm test` 149 文件 / 1261 项全部通过。
- `npm run smoke:mini`（小窗全功能 UI 与边缘吸附 smoke）全部通过：空闲展开态、运行展开态、运行收起态、置顶几何与 Win32 前台窗口身份保持、展开幂等性、暂停展开态、暂停收起态、浅色运行展开态、浅色暂停收起态、明暗主题无刷新往返、主题切换后停止控制、四边（左/右/顶/底）真实吸附收起与展开释放、Windows 原生 move-loop 释放门禁、新拖动取消待折叠、长 H:MM:SS 预设、长 CJK 跑马灯与减弱动态回退全部 PASS。
- `npm run smoke:performance` 全部通过：真实 App 本地优先任务加载、重复打开、变更事件、失败状态、共享主题（cachedTaskOpenMs: 93）；真实 MiniWindow 有界渲染、重复点击防抖、重试命令、两态尺寸、圆角与 DPR（pausedReactCommitsIn2500ms: 3）。
- 静默覆盖安装：`release-v165\FocusLink-1.6.5-x64.exe /S` 退出码 0；回读卸载注册表 `HKCU\...\Uninstall\21cd4128-7715-582c-bf2a-6446eb8ab7a5` → `DisplayName=FocusLink 1.6.5`、`DisplayVersion=1.6.5`；回读已安装 `%LOCALAPPDATA%\Programs\FocusLink\FocusLink.exe` → `FileVersion=1.6.5`、`ProductVersion=1.6.5.0`。
- 安装版与便携版启动验收：`node scripts/review/verify-startup.cjs <exe>` 对已安装 EXE 与 `FocusLink-1.6.5-x64-portable.exe` 均退出码 0，回读 `version=1.6.5`、`commit=142a64e`、`hasShell=true`、`hasRail=true`、`hasNavButton=true`、`hasConsole=true`、`pauseToken="210 67 57"`。
- 主窗口可见性门禁 `npm run smoke:window-visible` 退出码 0：当前账户 5 个 FocusLink 进程，`pid=46636` 存在可见顶层窗口 `title="FocusLink"`，`handle=1577830`；日志回读证据 `main window shown {"trigger":"ready-to-show","force":false,"visible":true,"pid":46636}`。
- Git LFS 卫生：打包前后 `.git/lfs/tmp` 保持 0 文件 / 0 B，无任何临时文件泄漏。

## 升级提示

- Windows 使用安装器静默覆盖后已完成注册表与 EXE 校验并成功重启。
- 本轮为纯小窗 UI / 样式与无头验收修复：**未修改数据库结构、IPC 命令名或同步记录格式，未改变或删除任何历史数据。**
- 小窗保持两态固定尺寸（`184 × 44` / `256 × 70`），吸附延迟与贴边自动收起逻辑完全兼容既有配置。
- Android 未随本轮构建；手机与平板仍停留在上一版，不要按 1.6.5 核对移动端行为。

## 已知限制

- 三设备同版门禁未闭合：本轮用户限定只做 PC，未安装/未验证小米与华为，Android APK 未构建。
- 历史遗留未修：既有 Sync v2 冲突未清除；公网 `/sync/v2/live` 与 `/healthz` 仍受环境网络不可达影响。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.6.5-x64.exe` | `1AC48DE04E4EEE68870D6BAE7414B246DD6DAC545703EA9D0C5C6EED0E8C9A78` |
| `FocusLink-1.6.5-x64-portable.exe` | `38C1EF9A30A565FA851230B7A870DC927454ECFB324E2A083394861C42252237` |

同时提供 `SHA256SUMS.txt`。
