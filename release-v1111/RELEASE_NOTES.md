# FocusLink v1.11.1

> 发布日期：2026-11-23
>
> 对应提交：`fc959dc`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁、打包启动自检、Windows 安装版本回读通过；按用户 2026-11-21 PC-only 指令，小米/华为本轮不安装、不验收

## 主要变化

- **断网也能结束专注**：实时同步模式下暂停/继续/结束原本只走远端命令，网络一断就抛「实时同步请求超时」，本地没有兜底。现在传输失败（含超时、401/403）时先把远端快照接管成本机账本（沿用远端 session/segment id，重连后同 id 收口），再执行本地暂停/继续/结束；HTTP 409 等语义拒绝仍原样上抛。
- **同步队列换成指数退避 + 熔断 + 死信**：传输失败只记 `[retry:n]` 且不消耗重试次数，离线再久也不会把记录判死；退避 30s 起翻倍封顶 30min，再乘按 id 计算的稳定抖动；连续 3 次传输失败打开 30s→10min 熔断；只有语义失败累计 5 次才进 `[dead-letter]`。队列日志按状态去重，不再每 60s 刷一条 paused。
- **去 AI 设计感与卡顿**：任务遮罩去背景模糊，设置页 9 台仪表改空闲时延后挂载，历史卡与任务行加 `content-visibility`，悬停位移/发光/过冲曲线全部收敛，外观菜单 emoji 换色点与 SVG 并支持 Esc 关闭。
- **移动端任务页分组卡与筛选**：清单分组升级为圆角卡片（组名 + 任务数抬头、0.5px 行间分隔），有子任务的分支补竖向引导线；待办/已完成改成带数量的筛选芯片。
- **移动端系统原生切页过渡**：优先走 `document.startViewTransition`（新页 190ms 上浮淡入、旧页 140ms 上收淡出），不支持或开启减弱动态效果时直接切换。
- **移动端统计看板卡片化**：三格指标与五块看板改独立圆角卡，7 日趋势柱 7px→22px，今天那一列加 8% 强调底；新增连续专注天数。

## 验证

- 源码门禁：`format:check` / `typecheck` / `lint` 全部 exit 0；`npm test` **184 文件 / 1592 用例全绿**。
- 打包启动自检：便携版 PASS（version=1.11.1，commit=fc959dc，页面就绪 8536ms，实例已回收）；已安装主程序 PASS（version=1.11.1，commit=fc959dc，页面就绪 4361ms，实例已回收）。
- Windows：静默覆盖安装后注册表 `DisplayVersion=1.11.1`、已安装 `FocusLink.exe` `FileVersion=1.11.1`，页面回读 commit=fc959dc。
- 小米 / 华为平板：按用户 2026-11-21 PC-only 指令，本轮不安装、不验收。

## 升级提示

- 设置里关闭「实时同步」或断网时，专注的暂停/继续/结束都在本机完成，恢复连接后自动把已接管会话按同一 id 收口。
- 若系统开启「减弱动态效果」，所有入场与状态动效自动降级为纯透明度渐显。

## 已知限制

- 打包版「实时权威断网收尾」没有真机 E2E：canonical 设备令牌会被强制路由到官方端点（`electron/sync/deviceSyncService.ts:1173`），legacy loopback 凭据启动即被迁移销毁（`electron/sync/deviceSyncAccountService.ts:76`、`electron/main.ts:1444`），而官方端点在本机 TLS 不可达。该路径的证据为 `tests/timerLiveOfflineFallback.test.ts`（真实 TimerManager + 真实控制器 + 内存库 + fetch 桩）。
- 本轮按 PC-only 指令不做移动端装机验收，三端同版矩阵缺小米/华为两项。
- 任务列表虚拟化未做（仅加 `content-visibility`），超大任务集滚动仍走全量 DOM。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.11.1-x64.exe` | `805606cd91aa79685d904428bb4569c3c37b1b8501fb272d54eff2a3b0f9ba85` |
| `FocusLink-1.11.1-x64-portable.exe` | `094024f5120dabd30d026448572cbda270eeca9256b2d3ffbc10e349e4fd3d4a` |

同时提供 `SHA256SUMS.txt`。
