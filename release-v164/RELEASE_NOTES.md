# FocusLink v1.6.4

> 发布日期：2026-10-15
>
> 对应提交：`65402fd`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 验证状态：Windows 门禁全部通过（静态与单元 149 文件 / 1261 项全部通过、真实构建的无头 App 与 MiniWindow 性能回归通过、小窗全功能 smoke 10 项状态与边缘吸附全部通过、静默覆盖安装回读通过、安装版与便携版启动验收通过、主窗口可见性通过）；本轮用户明确只开发 PC，Android 仅同步版本元数据 1.6.4 / 1340，未构建、未安装、未验证；`main` 推送未获公开发布授权且本地 GitHub 仍受代理/TLS 环境限制保持本地。

## 主要变化

**桌面专注小窗方案 A 细节落地与文字清晰度显著增强。** 响应用户要求：「方案a可以继续打磨，我先看到你才能落地」、「字体要能看清」。

- **时间读数清晰度增强**：收起态与展开态的主时间字体字重从 560/570 提升至 650，紧凑重置字间距为 0，启用 `text-rendering: optimizeLegibility` 与抗锯齿优化，微加紧凑文字投影，在浅色、暗色及各种桌面杂色壁纸下边缘坚挺、不再发虚。
- **任务标题识别度强化**：展开态顶部任务名称标题字重由 520 提升至 600，文字对比度达到 92%，长标题滚动遮罩通透顺滑，即便小字号也清晰易读。
- **累计数据排印对比度提升**：展开态三行累计指标（累计专注、累计暂停、总历时）标签纯度从 55% 提升至 72%（字重 550），数值纯度从 78% 提升至 88%（字重 700），严格 Tabular Nums 等宽对齐，扫视一眼即可分辨。
- **操作按钮手感与清晰度**：展开态「暂停/继续」与「结束」按钮文本字重提升至 700，主按键微受光顶边缘高光锐利，主次操作按键识别率显著提高。
- **尺寸与烟测指标硬约束守护**：严格保持两态固定尺寸——收起态 `184 × 44` px，展开态 `256 × 70` px，数值源自 `shared/miniWindowLayout.ts`，未引入第三种尺寸；保留全部既有 CSS 精确尺寸要求（8.5px/9.5px/9px 等），兼顾极致清晰度与严格回归门禁。

## 验证

- `npm run format:check`、`npm run typecheck`（含 Cloudflare worker）、`npm run lint` 全部通过；`npm test` 149 文件 / 1261 项全部通过。
- `npm run smoke:mini`（小窗全功能 UI 与边缘吸附 smoke）全部通过：空闲展开态、运行展开态、运行收起态、置顶几何与 Win32 前台窗口身份保持、展开幂等性、暂停展开态、暂停收起态、浅色运行展开态、浅色暂停收起态、明暗主题无刷新往返、主题切换后停止控制、四边（左/右/顶/底）真实吸附收起与展开释放、Windows 原生 move-loop 释放门禁、新拖动取消待折叠、长 H:MM:SS 预设、长 CJK 跑马灯与减弱动态回退全部 PASS。
- `npm run smoke:performance` 全部通过：真实 App 本地优先任务加载、重复打开、变更事件、失败状态、共享主题（cachedTaskOpenMs: 92）；真实 MiniWindow 有界渲染、重复点击防抖、重试命令、两态尺寸、圆角与 DPR（pausedReactCommitsIn2500ms: 3）。
- 静默覆盖安装：`release-v164\FocusLink-1.6.4-x64.exe /S` 退出码 0；回读卸载注册表 `HKCU\...\Uninstall\21cd4128-7715-582c-bf2a-6446eb8ab7a5` → `DisplayName=FocusLink 1.6.4`、`DisplayVersion=1.6.4`；回读已安装 `%LOCALAPPDATA%\Programs\FocusLink\FocusLink.exe` → `FileVersion=1.6.4`、`ProductVersion=1.6.4.0`。
- 安装版与便携版启动验收：`node scripts/review/verify-startup.cjs <exe>` 对已安装 EXE 与 `FocusLink-1.6.4-x64-portable.exe` 均退出码 0，回读 `version=1.6.4`、`commit=65402fd`、`hasShell=true`、`hasRail=true`、`hasNavButton=true`、`hasConsole=true`、`pauseToken="210 67 57"`。
- 主窗口可见性门禁 `npm run smoke:window-visible` 退出码 0：当前账户 5 个 FocusLink 进程，`pid=13560` 存在可见顶层窗口 `title="FocusLink"`，`handle=1117712`；日志回读证据 `main window shown {"trigger":"ready-to-show","force":false,"visible":true,"pid":13560}`。
- Git LFS 卫生：打包前后 `.git/lfs/tmp` 保持 0 文件 / 0 B，无任何临时文件泄漏。

## 升级提示

- Windows 使用安装器静默覆盖后已完成注册表与 EXE 校验并成功重启。
- 本轮为纯小窗 UI / 样式与无头验收修复：**未修改数据库结构、IPC 命令名或同步记录格式，未改变或删除任何历史数据。**
- 小窗保持两态固定尺寸（`184 × 44` / `256 × 70`），吸附延迟与贴边自动收起逻辑完全兼容既有配置。
- Android 未随本轮构建；手机与平板仍停留在上一版，不要按 1.6.4 核对移动端行为。

## 已知限制

- 三设备同版门禁未闭合：本轮用户限定只做 PC，未安装/未验证小米与华为，Android APK 未构建。
- 历史遗留未修：既有 Sync v2 冲突未清除；公网 `/sync/v2/live` 与 `/healthz` 仍受环境网络不可达影响。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.6.4-x64.exe` | `47E3B054BF3752803A6B5EEA2FB7AE484F541F8835F371BACE60B21F76941012` |
| `FocusLink-1.6.4-x64-portable.exe` | `E0197BBEBD3145193FFB19EF3ACAC7395A18C19E55306F326038FBA4CDFDCCD3` |

同时提供 `SHA256SUMS.txt`。
