# FocusLink v1.11.4

> 发布日期：2026-11-24
>
> 对应提交：`b55a3db`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁、打包启动自检、Windows 静默覆盖安装回读与窗口可见性通过（PC-only 轮次；Android 仅同步版本元数据，不装机）

## 主要变化

- **本机进行中的专注接入实时同步**：此前实时控制只在本机计时器 idle 时接管，PC 先开始的 running/paused 会话永远不会被手机看到。新增 `adopt` 协议：客户端把本机时间线交给云端，确认 applied/duplicate 且快照同 id 后才切换实时权威并删除本机活动行；失败则保留本机计时并退避。
- **暂停会话按暂停边界交接**：本机暂停只写 `pause_events`，segment 要等继续才关闭。种子构造时用 open pause 起点收口最后一段，避免把暂停时长原样上传成专注；云端保留本地 segment/pause id，finish 后仍能同 id 落账。
- **云端不再把暂停算成专注**：adopt 保留的 segment 可以跨多段暂停，旧 `materializeLive` 直接累加 segment 跨度，实测把 3,892,826ms 的专注算成 23,414,190ms。新增 `shared/sync/liveFocusTime.ts`，按 pause 与 segment 的交集扣减并封顶为 segment 跨度；实时快照、完成账本、个人云镜像与客户端分段明细统一使用。
- **部署策略真正生效**：旧 wrangler 4.125 的产物不认识 `code_update_strategy`，配置被静默忽略，部署后约 5 分钟才切到新代码。升级到 wrangler 4.167.0 与 workers-types 5.20261123.1，重新部署 a9285410 后一分钟内即读到修正值。
- **切页不再整块掉亮**：路由层不再使用 `AnimatePresence` 交叉淡入淡出。旧页直接卸载，当前页根容器从第一帧起自带不透明 `--app-surface`；过渡只保留页内 160ms、94%→100%、上浮 3px 的一次性轻入场，reduced-motion 下静态。
- **真实会话已交接**：本机 `ff051228-f750-4461-b381-d7b847334c06` 交接后云端 revision 815、paused、同 id；本机活动行与分段已删除，界面直接读取云端快照。

## 验证

- 源码门禁：`format:check` / `typecheck` / `lint` exit 0；`npm test` **186 文件 / 1,611 用例全绿**；定向用例 30/30。
- 云端：`wrangler deploy` exit 0，Current Version ID `a9285410-a184-4bb1-ae3a-97710fef093f`；部署后 `GET /sync/v2/live` 返回 revision 815、paused、同 id，active=3,892,826ms，active+pause=wall。
- 分段核对：seg1 580,396ms、seg2 2,116,996ms、seg3 1,195,434ms，合计 3,892,826ms；三条 pause 的 closed 部分不再计入分段 active。
- 打包启动自检：`npm run verify:packaged` PASS，portable 回读 version=1.11.4、commit=b55a3db，页面就绪 7,287ms，实例已回收。
- Windows：安装器 `/S` 静默覆盖 exit 0，卸载注册表 `DisplayVersion=1.11.4`、已安装 `FocusLink.exe` `FileVersion=1.11.4`；`smoke:window-visible` 通过，pid 43264 主窗口 handle 27526896，标题「FocusLink」。
- 安装后回读：`/v1/status` 与 `/v1/focus/current` 均为 paused、同 id、active=3,892,826ms，说明客户端已读取云端权威快照。
- 记录校验：`npm run release:verify` 21/21。
- Android：仅同步 `versionName=1.11.4` / `versionCode=1389` 元数据，不执行 `adb install`（用户 2026-11-21 指令：只负责开发 PC）。

## 升级提示

- 直接运行安装器静默覆盖即可；本轮安装包与旧版同为 1.11.4，但对应提交不同，必须以 `b55a3db` 这一版为准。
- 升级后如果看到一场 paused 的专注，这是云端仍在进行的真实会话，可正常继续或结束；不要手动改数据库。
- 如果手机端仍显示旧状态，先在手机上重新进入专注页或重新连接；云端与 PC 已读取同一 sessionId。
- 旧版若仍显示两小时专注，不要点结束；先升级到本版，让客户端读取修正后的云端快照。

## 已知限制

- 本轮没有让用户真实结束这条 paused 会话；`finish` 后的完成账本仍只有自动化与云端协议用例覆盖，未做真实收尾回读。
- 按 PC-only 指令未安装 Android，也没有手机端实时页面的真机截图；移动端只同步版本元数据。
- 打包版实时断网收尾仍无真机 E2E，证据为真实 `TimerManager` + 控制器 + 内存库 + fetch 桩。
- 任务列表虚拟化未做（仅 `content-visibility`），超大任务集滚动仍走全量 DOM。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.11.4-x64.exe` | `d29a4bccbafb5a9f39bdcdf5f8e7ddb087a88fbbbb7746caf31339282df4cc6b` |
| `FocusLink-1.11.4-x64-portable.exe` | `77fb75930df2444fd38e469b451f55992cea551c586fece29eeb180e946297d6` |

同时提供 `SHA256SUMS.txt`。
