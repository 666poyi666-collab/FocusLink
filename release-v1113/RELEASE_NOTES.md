# FocusLink v1.11.3

> 发布日期：2026-11-23
>
> 对应提交：`943f56c`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁、打包启动自检、Windows 静默覆盖安装回读与窗口可见性通过（PC-only 轮次；Android 仅同步版本元数据，不装机）

## 主要变化

- **已结束的专注不会再复活成两小时**：断网接管后本机先同步了完成账本，云端实时会话却仍保留同 id 的活动状态；应用重启后旧逻辑会把它重新当成实时权威展示。现在本机同 id 会话只要已经 `finished/aborted` 或已有结束时间，接管入口就直接拒绝，重连时按本机结束事实发同 revision 的 `abort`，收口失败也留在本机账本，不再把幽灵计时器交给用户。
- **服务端可以幂等收口 live 残留**：`finish/abort` 在账本实体已存在时不再重复发布（旧行为会因 `session_id_exists` 永远拒绝），只清 `live_state` 并推进 revision；完成账本落库时若命中同 id 的活动会话，也会自动丢弃残留，避免 live/ledger 再次分裂。
- **部署策略改为 immediate**：Cloudflare Durable Objects 默认 `deferred` 代码更新最多让活动对象继续跑旧代码 300 秒；`wrangler.jsonc` 已固定 `code_update_strategy: immediate`，本轮以真实 abort 的 `applied` 回执和 idle 快照验收，而不是只看部署版本号。
- **今日统计日期归位**：`/v1/analytics/today` 原先把本地零点转成 UTC 日期，东八区会返回前一天；现在复用本地日期键，返回真实的本地 `YYYY-MM-DD`。
- **远端已收口、本机账本未改写**：受影响会话 `db19414b-e91e-4e08-8198-64e294689a1b` 仍是 finished、3,513,747ms（58.56 分钟）；云端在 revision 814 变为 idle，应用状态接口同步返回 idle。
- **回归覆盖**：新增“本机已结束拒绝接管”“重启后仍能收口远端幽灵”“账本已存在时 finish/abort 放行而 start 仍拒绝”“本地日期键不落 UTC 前一天”等用例。

## 验证

- 源码门禁：`format:check` / `typecheck` / `lint` exit 0；`npm test` **185 文件 / 1599 用例全绿**；定向用例 26/26。
- 云端：`wrangler deploy` 成功，Durable Objects 立即更新；对幽灵会话的 `abort` 返回 `applied`，revision 814，随后 `/sync/v2/live` 与 `/v1/status` 均为 idle。
- 打包启动自检：`npm run verify:packaged` PASS，portable 回读 version=1.11.3、commit=943f56c，页面就绪 7,863ms，实例已回收。
- Windows：安装器 `/S` 静默覆盖 exit 0，卸载注册表 `DisplayVersion=1.11.3`、已安装 `FocusLink.exe` `FileVersion=1.11.3`；`smoke:window-visible:launch` 主窗口 handle 可见且实例已回收。
- 记录校验：`npm run release:verify` 21/21。
- Android：仅同步 `versionName=1.11.3` / `versionCode=1388` 元数据，不执行 `adb install`（用户 2026-11-21 指令：只负责开发 PC）。

## 升级提示

- 已安装版本可直接用安装器静默覆盖；升级后打开历史页核对最近一场长专注，界面时长应与历史记录一致。
- 如果旧版界面上仍挂着一条“暂停中”的两小时会话，不要点旧版的“结束”——旧版可能走接管把错误时长写进本机账本。升级到本版后重启，客户端会按本机已结束事实收口云端残留。
- 云端修复只影响实时控制面，不会改写任何已完成账本；本机 58.56 分钟记录保持不变。

## 已知限制

- 打包版“实时权威断网收尾”仍没有真机 E2E：canonical 设备令牌被强制路由官方端点，legacy loopback 凭据启动即被迁移销毁；证据为真实 `TimerManager` + 真实控制器 + 内存库 + fetch 桩的用例。
- 任务列表虚拟化未做（仅 `content-visibility`），超大任务集滚动仍走全量 DOM。
- 本轮按 PC-only 指令未做小米/华为装机回读，移动端只同步版本元数据。
- 若云端暂时不可达，关闭“PC 参与实时专注”并重启客户端只能先恢复本机计时，不能宣称幽灵已清理；手机端仍可能看到 paused 状态。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.11.3-x64.exe` | `01c7976cc30dca93e5af94814209ca9d186ef10514a867b14c3e56807d0628d2` |
| `FocusLink-1.11.3-x64-portable.exe` | `a0737e4d70f1d5d9a82870a97a5571a730abec454093f0ef42fed18bdb0d45bc` |

同时提供 `SHA256SUMS.txt`。
