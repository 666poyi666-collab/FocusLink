# FocusLink 同步错误索引

这是一份可重复使用的同步排错文档。它覆盖三条彼此独立的链路：FocusLink 跨设备账本、滴答清单队列和番茄 To-do 上传。错误编号稳定，截图或日志出现同样文本时可以直接按编号处理。

## FL-SYNC-001：`timer:start-with-task` / `fetch failed`

典型提示：

> 操作失败：Error invoking remote method `timer:start-with-task`: TypeError: fetch failed

### 含义

这不是任务标题、SQLite 或计时器状态错误。PC 已开启「PC 参与实时专注」，于是开始按钮会请求配置的实时服务：

```text
<同步服务地址>/v1/live/command
```

默认地址 `http://127.0.0.1:18787` 由 0.12.22 及以后版本的 Windows 桌面主进程按需托管；旧版本或自定义地址仍需要单独启动后端。旧版本的 `8787` 默认值容易与 Windows 桌面软件（本机当前由 Baidu Netdisk 占用）冲突；地址没有监听、VPN/代理拦截或服务崩溃时，Node/Electron 会报告 `TypeError: fetch failed`。

### 处理步骤

1. 先不要连续点击开始。打开「设置 → 同步」，确认「同步服务地址」和令牌属于同一个服务。
2. 如果只想使用本机计时，关闭「PC 参与实时专注」，点击「保存并连接」。已结束的账本同步仍可单独保持开启；这不会删除本地记录。
3. 如果要做跨设备实时专注，在工作区启动与设置中令牌相同的后端：

   ```powershell
   Set-Location C:\Users\poyi\Desktop\time1\FocusLink
   $env:FOCUSLINK_CLOUD_TEST_TOKEN = '<与设置页相同的访问令牌>'
   npm run dev:cloud
   ```

4. 用健康检查确认服务确实在监听，再回到设置点击「保存并连接」：

   ```powershell
   Invoke-WebRequest http://127.0.0.1:18787/health | Select-Object -Expand Content
   ```

   返回 HTTP 200 后再开始实时专注。不要把访问令牌写进仓库、截图或日志。

   如果仍使用旧配置或自定义端口，先检查端口归属：

   ```powershell
   Get-NetTCPConnection -LocalPort 18787 -ErrorAction SilentlyContinue |
     Select-Object LocalAddress,LocalPort,State,OwningProcess
   ```

安装验收时只运行仓库根目录 `release-v01222\` 下的安装包；`%TEMP%\focuslink-*` 目录只用于 smoke 或安装器临时测试，不能当作交付版本。旧包即使文件名相同，也可能仍显示未包装的 `Error invoking remote method` 原始错误。

修复后的客户端在实时握手成功前不会把本机计时切换到云端事实源；因此服务暂时没启动时，普通桌面计时仍可开始。已经建立的实时会话断线时不会伪造本机确认状态；如果云端当前为空闲，客户端会自动退回本机计时路径，避免开始按钮被不可达服务卡住；如果云端仍有进行中的会话，则继续锁定云端状态，直到服务恢复。设置页会显示「实时连接已断开」，服务恢复后再重连。

发布前用本次刚构建的 unpacked 可执行文件复验这个降级路径：

```powershell
npm run smoke:live-fallback -- <本次构建的 win-unpacked\FocusLink.exe>
```

该 smoke 在系统临时目录创建隔离 profile，并由 Electron `safeStorage` helper 现场生成 synthetic 非生产令牌，再写入不可达的随机 loopback 地址，通过独立 Electron 实例验证“首次实时握手失败 → 本机计时可开始 → 可结束”。它不得读取、复制或解密当前账户的真实同步凭据，也不会连接、关闭或修改当前正在使用的 FocusLink；helper 初始化、加密或解密失败必须在有界超时内明确失败，不得以 `SKIP` 计入通过。

## FL-SYNC-002：`network_error` / `无法连接跨设备同步服务`

这是已结束账本或实时同步请求当时不可达。当前 canonical 客户端使用 `/sync/v2/exchange`、`/sync/v2/status` 和 `/sync/v2/live*`；日志可能只保留结构化 `network_error`。旧安装或 loopback 测试后端仍可能出现 `/v1/sync`。先按本页“连接事故诊断顺序”区分历史失败、当前可达性和产品状态；它与滴答清单同步无关。网络恢复后点击「立即同步」，本地待同步会话不会因为一次网络失败而丢失。

滴答清单页面显示「N 条同步失败」时，点击「立即重试」会先把已达到重试上限的记录恢复为待同步，再执行队列；若服务仍不可达或处于限流冷却，会提示「已恢复 N 条失败记录，等待连接恢复后自动重试」，不会静默无动作。

## FL-SYNC-003：HTTP 401/403 或“令牌无效”

服务可达但设备凭据失效。普通用户无需管理员账号：打开两台设备的“多端同步”，任一台输入另一台显示的 8 位本机码即可重新建立独立设备凭据。已有设备升级后若旧 `fl2` 仍有效则原位使用；失效时不要清 SQLite 或本机任务。切换同步凭据只清理旧连接的本机 cursor/实时缓存，不删除会话。

历史事实：2026-08-24 的 legacy bootstrap 会打开 43 位管理员码网页；2026-08-26 页面曾完成中文化。当前产品事实：普通 FocusLink 配对已经退出该 bootstrap 流程，客户端只使用 8 位设备码。若旧日志仍含 `deployed-login-required`，将其记录为旧客户端/后台维护路径，不要引导用户输入管理员码，也不要清缓存或数据库。

若手机任务页长期停在旧 revision：先确认 canonical `GET /sync/v2/tasks` 响应含 `Cache-Control: no-store`，再比较 PC 发布日志的 revision/source/payload 确认与手机回读。v0.12.104 当前候选中，移动端持续可见时应在 5 秒内拉新，回到前台、窗口重新聚焦或 pageshow 会立即刷新；低 revision 不覆盖本机缓存，同 revision 异文会报告 authority 不一致。PC 的创建/改色/移动/完成/恢复在 renderer 返回前会等待本次 pending task snapshot 发布尝试，pending 只有服务端原样回读后才清除；pending 未清说明发布链仍未确认，不要手工伪造 revision。

v0.12.71 起，Electron 从 `fl2` token 解析与 authority 一致的 `deviceId`，live command 和任务快照不再发送 legacy 本机 UUID。若空闲状态下仍收到 401/403，“开始专注”会退回本地计时并在 `liveFocus` 日志写入 `credential-rejected`；已经进行中的云端会话不会降级。任务快照日志应显示具体 HTTP 状态/消息，不应只出现 `[object Object]`。

## FL-SYNC-004：`pause 引用了不存在的 segment`

这是旧版本合并/删除片段留下的本地孤立暂停引用，不是网络错误。当前客户端在生成跨设备 bundle 时会把无法解析的旧引用降级为会话级暂停（`segmentId: null`），原始本地账本不被删除；日志会保留诊断。若仍被标记为冲突，请保留会话 ID、暂停 ID 和日志时间，不要直接删除数据库。

## FL-SYNC-005：请求超时

提示为「跨设备同步请求超时」。检查服务端健康检查、反向代理和 VPN；恢复后可重试。客户端使用有限超时，不会无限占用同步队列。

## FL-SYNC-006：云端恢复后仍显示“跨设备同步失败” / `conflict_present`

2026-09-08 移动展示补充：首次账本同步没有 lastSyncAt 时也必须优先呈现 partial/conflict/rejected 的“有记录待处理”；缺少历史确认时间不能覆盖当前终态。首次 transport 请求失败使用“首次同步未完成”，不推进确认时间。检查 `presentMobileLedgerFreshness` 的分支顺序及其首次同步测试，不要通过伪造 checkpoint 消除提示。

### 事故证据

v0.12.78 的一次已安装实例先在日志中真实记录 canonical Sync v2 `network_error` 与 liveFocus 重试；稍后 DNS、TCP 443 和 HTTPS 已恢复，canonical adapter 的 `GET /healthz` 连续返回 200，无凭据 `GET /sync/v2/status` 返回 401。此时 Electron 状态仍可能返回 `lastError=conflict_present`，设置页却显示 danger/“跨设备同步失败”。早先网络失败、当前服务恢复和本机仍有未解决冲突是三个可以同时成立的事实。

同轮 QA 还发现三处同类误分类：手机 completed-ledger 即使本轮返回 conflict/rejected，仍清空 native error 并显示“账本同步已确认”；Android native ledger 把 conflict/rejected ack 保留在 durable outbox 后仍作为普通异常请求后台重试；OPPO watch 对 live command conflict/rejected ack 只接受返回 snapshot，不显示 ack 结果。v0.12.79 已分别改为 partial ledger、保留原始记录的 terminal sidecar、以及“本次未执行，已刷新云端状态”的明确 notice；自动化必须继续锁住这些分支。

### 根因

`electron/sync/deviceSyncV2Service.ts` 在一次同步完成后，如果本机冲突箱非空，会把稳定机器码 `conflict_present` 写入 `deviceSync.lastErrorV2.<scope>`。`readDeviceSyncStatus()` 优先返回持久化码；v0.12.78 的 `SettingsPanel.tsx` 却只用中文“未解决的跨设备冲突”正则识别 conflict-only 状态。因此机器码落入通用失败分支。这是状态分类和呈现 Bug，不是 health 失败，也不应靠清数据修复。

移动端是同一类“收到响应即视为成功”问题：

- `MobileApp.pullLedger()` 没有先检查 `runMobileSyncV2()` 的 `conflicts/rejected`，便写入空 `lastErrorCode`、`confirmed` state 和“已确认”文案。
- `FocusLedgerSyncProtocol` 会拒绝 conflict/rejected ack 并保留 outbox；但 `FocusLedgerSyncWorker` 的通用异常分支没有把这些确定性终态与瞬时 transport 失败分开，所以 WorkManager 可以持续重试相同 mutation。
- `WatchApp.sendCommand()` 收到任意合法 ack 后只映射 snapshot；它没有调用 `commandAckNotice()` 或等价策略，因此 conflict/rejected 没有用户可见结果。

正确语义：

- `conflict_present` 且 `unresolvedConflicts > 0`：warning，“同步已连接，有记录待确认”；保留冲突，不自动覆盖。
- `network_error` / timeout：最近一次 transport 请求失败；若没有更晚成功证据，显示当前未连接。
- 401/403 或 credential code：服务可达但身份/scope 被拒绝，不能写成网络断开。
- `rejected_operation`：远端拒绝某项操作，保留诊断；不能把整条连接标成离线。
- 移动 completed-ledger 的 conflict/rejected：请求已得到权威响应，但对应 mutation 未获确认；保留 pending/conflict/rejected 状态并显示待处理，禁止更新“最近确认”或清空错误。
- Android native ledger 的 applied/duplicate 才能确认 projection 并删除 outbox；conflict/rejected 是需要显式处理的持久终态，不做无界自动 retry。只有可恢复的 transport、5xx 或 rate-limit 才进入有界退避。
- 手表 live command 的 applied/duplicate/conflict/rejected 都必须显示精确 ack 结果；conflict/rejected 应说明“未执行/被拒绝”和云端当前 snapshot，不能静默，也不能仅因 snapshot 可解析就显示确认。

### 连接事故诊断顺序

1. 记录用户看到的文案、当前本地时间和最后成功时间；不要先清 token、缓存、checkpoint 或 SQLite。
2. 从已安装设置读取并脱敏 endpoint，只保留 scheme/host/port/path；从 `%APPDATA%\focuslink\logs\focuslink-YYYY-MM-DD.log` 提取最近时间和结构化错误码，不输出 credential、请求正文或用户数据。
3. 对 endpoint host 依次检查 DNS 与 TCP 443。`198.18.0.0/15` 等合成地址通常表示本机代理/TUN DNS，记录这一环境事实，但不要单凭它判定云端宕机。
4. canonical `foxlink-cloud-mcp` origin 只做匿名 `GET /healthz`；本机 loopback Node 后端才用 `GET /health`。health 200 只证明当前请求链存活。
5. 必要时对 canonical `GET /sync/v2/status` 发无凭据只读请求；401 是“路由存在且鉴权拒绝”的预期证据，不证明已存 token 有效。不得输出或复制已存 token。
6. 不得用 bootstrap 做健康探测：inventory/entities 为 POST，会创建或更新远端 bootstrap 状态。只有完成上述只读层并获得明确授权后，才运行会写同步的“立即同步”或账号流程。
7. 最后读取结构化 `lastError`、`unresolvedConflicts`、`lastSyncAt` 和 live telemetry 分别归类。历史 `network_error` 不因当前 200 被抹掉，当前 200 也不清除 durable conflict。

## FL-SYNC-007：手机/平板“实时连接中断 · 自动重试中”

### 已确认的本轮事故

v0.12.80 在小米 `D68P65855TPBHYWS` 与华为 `f8630574` 上反复失败。两台设备均为普通 Wi‑Fi、无 VPN/HTTP 代理；`workers.dev` DNS 答案持续漂移，TCP 443 在 TLS 前超时，未产生 HTTP 状态或 401/403。小米 WebView 的 `/sync/v2/live`、`/sync/v2/tasks`、`/sync/v2/status` Resource Timing 均为 `transferSize=0`，Android authority 同时记录 `network_error`。这不是 token 失效、scope 拒绝、任务树或计时器故障。

只读验证同一网络上的固定备用数据面 `https://focuslink.pyzzgk.dpdns.org`：`GET /healthz=200`，无凭据 `GET /sync/v2/status=401`。该地址只能作为源码固定白名单的同步数据面 failover，不能变成用户可编辑域名，也不能用于 OAuth/owner 登录或 bootstrap 健康探针。

### v0.12.84 客户端处理（继承并收口 v0.12.81）

- 实时、任务快照、移动 Sync v2 与 Android `FocusCloudClient` 优先请求固定备用 origin：只有 transport/network/timeout 失败才试 canonical；任一 origin 返回的 HTTP 响应（包括 408/425/429/5xx、401/403、409、协议错误或其他明确拒绝）都保留为该 authority 的权威结果，不切换 origin，也不改写成网络失败。Android 只在首个 `IOException` 后切换，第二次请求的 401/403 同样必须保留外层 HTTP 状态，账本 Worker 据此停止自动重试。
- document hidden、Capacitor inactive 时立即 abort 当前 live long-poll；visible/pageshow/active 仅以 generation+epoch 建立唯一新 loop。备用与 canonical 的 bounded wait 都使用协议请求本身的 timeout，不能因备用 origin 不是持久化 endpoint 就在 8 秒提前中止合法的 25 秒 long-poll。网络/超时/409/5xx/rate-limit 有界退避，认证/协议错误停止盲目重试并给出明确文案。
- DOM visibility 与 Capacitor app active 是两个独立门禁：`pageshow` 只能重新评估当前状态，不能强行把 native inactive 改成 active；live effect 每次因 online、凭据或其他依赖变化准备启动前都必须重新经过该门禁，后台不得重建 long-poll。连接失败原因必须同时进入实时状态条和专注控制台，权威 snapshot 成功后清除；不得让旧“正在自动重连”覆盖已经恢复的连接或命令 ACK。
- 首次恢复后的只读顺序：备用/主 origin `/healthz=200` → 无凭据 `/sync/v2/status=401` → 再在应用内观察 live 握手。不得清 token、缓存、checkpoint 或 SQLite 来“修复”这类 transport 事故。

### v0.12.84 验收

必须覆盖：两个 origin 的候选顺序与未知域名拒绝；备用 origin transport 失败后 canonical 成功；备用 origin 超过 8 秒才完成的合法 bounded wait 不得误切 canonical；两端都失败时结构化 `network_error/timeout`；首个或第二个 origin 返回 401/403 都不继续自动重试；hidden→active 旧请求 abort 且只有一个新 loop；Android failover 请求；真机前台→后台→前台与 Wi‑Fi 切换。OPPO OWW221 已于 2026-08-11 退役，不再纳入新版本发布验证。

### v0.12.84 综合验收（继承 v0.12.80 及此前门禁）

设置页不得再用本地化错误字符串正则推断状态。定向测试至少覆盖：

- 旧安装遗留的中文 durable error 只允许在 Electron 持久层边界一次性迁移并回写 machine code；renderer presenter 源码不得含 legacy 中文正则，未知旧文本统一降为 `sync_failed`，不得跨 IPC 原样展示。

- 桌面 `lastError=null`、`network_error`、timeout、401/403、`conflict_present`（冲突数 0 与大于 0）和 `rejected_operation`；`conflict_present + unresolvedConflicts > 0` 永不渲染“跨设备同步失败/连接失败”，同时保留更早网络错误的日志证据。
- 手机 completed-ledger 的 applied/duplicate、conflict、rejected、混合 ack 和 transport failure；只有全部应确认 mutation 获 applied/duplicate 才使用“账本同步已确认”并推进 native `lastVerifiedAt`，其余状态保留准确的 pending/conflict/rejected 计数和错误码。
- 手机 partial 后立即投影、重启 hydration、再次 retry 三条路径都不得推进 `lastVerifiedAt`；legacy/V2 待办按 session identity 并集计数，同一场 ledger+metadata 不得显示成两场，已绑定其他 device 的记录不得计入或上传，未绑定 legacy record 只能由一个 device 原子认领。
- Android native ledger Worker 的 applied/duplicate 删除、conflict/rejected 持久终态、401/403 停止自动重试，以及 transport/5xx/rate-limit 有界退避；验证确定性 ack 不形成无限 WorkManager retry。authority projection 必须把 terminal 数量/安全错误码持续列为 attention，不能被另一条 applied record 清空；敏感字段过滤在 Turkish locale 等环境下仍须拒绝大小写变体。terminal 只能由用户在电脑端处理后显式点击重新检查：入口先核对当前 device/lease，独立 `REPLACE` work 持久绑定 expected device id，marker 在执行前保留且普通 Worker 不可读取；排程失败、进程重启或账号切换不得产生裸 pending。只有显式 Worker 收到 applied/duplicate 后，outbox 与 sidecar 才同时清除。
- 冻结的 OPPO watch 历史合同仍保留自动化回归，但不再扩展功能或纳入真机发布门禁。
- v0.12.84 追加：`rejected_operation` 在 Windows 设置页必须是 warning“同步已连接，部分记录未同步”，不得落入整体连接失败；Android authority 对 `conflict_present/rejected_operation` 必须维持 attention freshness（有 verifiedAt 时 fresh/stale、无 verifiedAt 时 unknown），不得因 terminal ack 伪报 offline。所有 synthetic status fixture 的 `nextCursor` 必须符合正式 `^c[0-9a-z]+$` 合同；Android failover-first 的第二 origin 401/403 必须保留外层状态并停止重试，备用 long-poll 超过 8 秒但在协议 timeout 内合法返回时不得误切 canonical。先通过真实 instrumentation 再晋级资产。

## FL-SYNC-008：loopback 同步服务分配到 Fetch forbidden port（`TypeError: fetch failed` 间歇 flake）

### 含义

回环协议测试与嵌入测试后端在不显式指定端口时绑定动态端口 0；若操作系统分配的临时端口落入 WHATWG Fetch forbidden-port 列表（0、1、25、465、587、6000、6667、10080 等），Electron/Chromium `fetch` 会在请求发出前直接拒绝该 URL，表现为 `TypeError: fetch failed`，即使服务端实际已在监听。这是测试/嵌入服务端口与 Fetch 协议限制的冲突，不是真实断线、防火墙或 VPN 问题，也不能据此判定服务未启动。

### 处理与修复（v0.12.85 起）

- 显式配置 forbidden port 时在 `listen()` 前拒绝，不进入 bind。
- 动态端口 0 至多有界重试（`MAX_DYNAMIC_PORT_BIND_ATTEMPTS=16`），每次尝试后若分配端口 forbidden 先关闭该 listener 再重试。
- 标准 forbidden 列表不能被测试 seam（`isPortForbidden`）绕开；seam 只能在标准列表之上追加条件。
- 并发 `listen()` 调用合并为同一次 in-flight bind，返回同一地址。
- 重试耗尽后服务保持关闭，不残留监听。

### 验证

`tests/deviceSyncServerPortSafety.test.ts` 覆盖标准端口判定、显式端口 bind 前拒绝、seam 不可绕开、动态端口重绑、耗尽关闭与并发合并；回归已在干净源码 `e75e466` 复跑通过（全量 Vitest 114 文件 / 801 项）；回环协议测试与 Cloudflare 本地协议测试在干净源码上复跑通过，不得把端口 flake 当作 authority 故障。

## FL-SYNC-009：番茄 To-do 电脑显示已上传，手机没有记录

先把三种状态分开：`cloudSyncGetStatus.isBound=true` 只表示云端账号已绑定；`cloudSyncUploadRecord.success` 只表示电脑上传接口接受了批次；只有手机 `CloudSyncManager` 的“文件下载成功 / 下载到专注记录数量”才是手机真实接收证据。四位码属于电脑直连手机通道，不能用来解释已绑定的云端下载失败。

真实安装版已验证两个独立失败条件：

- 小米锁屏进入 Device Idle 后，番茄 To-do 进程可能对 `pcd.fanqietodo.cn` 报 `UnknownHostException`，即使 `adb shell ping` 同一域名成功。先检查该应用的后台联网和省电限制；恢复后重启应用，并以新的手机日志复验，不能沿用历史错误。
- 番茄 To-do 专注云投递只接收最近 7 天记录。受控上传 17 条时手机只下载窗口内 12 条；将 4 条移入窗口后，手机明确下载 4 条。桥接层对超窗记录返回 `tomatodo_record_outside_seven_day_window` 并保留待同步；产品不得静默修改日期。历史补录只有在用户明确接受新时间段后才能重排。

专注云文件按一次性批次消费，后一次上传可能覆盖手机尚未取走的前一批。多条记录必须同批上传；真实设备验证时严格按“停止手机应用 → 上传一个完整批次 → 启动手机应用 → 读取下载数量”执行，避免后台提前消费后再误读为 0 条。

2026-08-30 补充实证：设置页显示 223 条待上传并连续两次 `uploaded=0/failed=223`；桥身份 probe 已连接，当前时间临时记录上传确认成功。脱敏日期聚合确认 223 条全部超过 7 天，属于永久不可投递历史，不是桥或番茄钟整体失败。v0.12.105 验收补修后，超过窗口的记录继续保留在本机 PCRecord，但不再计入“待上传”或后台重试；界面显示“历史已停止重试”。禁止批量改成今天来换取成功，也禁止把停止重试写成已上传。

2026-09-08 源码诊断补充（修复中）：历史页没有消费后台 `phone-pending`，共享 IPC 类型也缺少该值。诊断时必须同时检查 durable intent 的原因、当前学科与外部记录是否一致，以及上传/手机通道的独立确认；当前 durable segment ID 列表不能证明待处理项仅是手机投递。不要因 marker 存在就清队列，也不要用旧 `isSynced=1` 确认尚未写入的新学科。此发现尚未完成真实番茄客户端验收。

## FL-SYNC-010：8 位设备配对码无效或过期

数字码在 10 分钟内有效。输入时只移除空格/换行，不改写其他字符；非 8 位数字在本机直接拒绝。同一 installation 重复提交同一码会幂等返回同一凭据，不应显示“已使用”；不存在、过期或已被另一 installation 占用才返回 `pairing_expired`。

- 当前配对入口不做次数限流；若旧客户端仍显示 `pair_rate_limited`，刷新本机码并升级客户端，服务端不要求等待 `Retry-After`。
- `pairing_binding_mismatch`：该码已被另一 installation 占用；保留当前设备数据，在任意设备刷新一个新码。
- 401/403 / `scope_denied`：旧 offer/approve 兼容路径的凭据已失效；改用任意设备生成的新本机码直接交换，不复制管理员 token、pair authority 或服务凭据。
- 成功兑换后仍没有任务/实时/账本：分别读取 task revision、live connection 和 completed-ledger 状态。兑换成功只证明设备凭据已登记；三条链路必须各自形成确认，不得用其中一条冒充全部同步完成。

排查时严禁记录 8 位明码、Bearer token 或完整 installationId。服务端只允许 HMAC/哈希 key；若日志出现原始 code，视为安全回归并停止发布。

## FL-SYNC-011：任务/清单 mutation 冲突、未确认或“清单删除后又出现”

### 含义

FocusLink 自有任务是 Account DO `task_state` 的完整快照寄存器。PC、手机、平板和云端 MCP 都必须先读取当前 `revision`；MCP 的每次写入还携带稳定 `operationId` 和 `expectedRevision`。旧 revision 返回 `409 task_revision_conflict`，不会覆盖其他设备的新任务。相同 operation 重放返回 `duplicate`，只表示原次操作已确认，不代表再次执行。

清单删除和任务删除不是同一语义：普通清单删除始终将其中所有任务/子任务迁入固定 `local-inbox`；只有显式“删除任务”才永久删除目标子树。收件箱不可删除。PC 在本地 SQLite 中先用事务迁移任务并删除清单，再发布完整快照；发布失败或未获服务端原样回读时会恢复原清单/归属并显示错误。移动端只在服务端回读确认后替换内存与 IndexedDB 快照。

### 处理步骤

1. 先记录当前页面显示的 revision、动作、时间和安全错误码；不要重复点击，也不要清空 SQLite、IndexedDB、凭据或云端任务。
2. `task_revision_conflict`：重新读取 `GET /sync/v2/tasks`，确认新的清单/任务树后，用新的 revision 重新提交一次新的 operationId。原 operationId 只能以同一正文重放，不能拿来覆盖新 revision。
3. `task_snapshot_conflict`、`task_snapshot_timestamp_too_far_ahead` 或任务发布未确认：保持本地 pending/失败提示，检查 endpoint 的 `no-store` 响应和最近发布日志；不要手工伪造 revision。桌面 timestamp 422 只允许一次可信 GET + 一次以服务端时间重戳 POST，第二次失败继续保留 pending。
4. 若清单删除后刷新又出现，确认删除路径使用了 `skipCloudSnapshotMerge`，并读取服务端 revision 是否已经前进；旧快照不得在本地删除事务之前重新合并。若本地回滚失败，保留清单 ID、任务数量和结构化错误，先停止继续写入再恢复备份。
5. MCP 只接受 `focuslink:read focuslink:write` OAuth scope。只读 token 的写调用应得到 `403 insufficient_scope`；服务端错误只展示稳定 code，不输出任务标题、标签、凭据或上游响应正文。

### 验证

纯函数/Account DO/Worker/MCP 回归应覆盖清单安全迁移、收件箱保护、父子子树、截止时间/优先级/标签、完成/恢复、永久任务删除、同 operation 重放、operationId 复用拒绝、旧 revision 冲突和跨账号隔离。使用 `npm test -- tests/taskSnapshotMutation.test.ts`、`npm run test:cross-device` 与 `cloud/mcp` 的 typecheck/test；生产临时数据只有在明确授权部署验收时创建并在同一轮完整清理。

## FL-SYNC-012：循环任务日期没有推进或旧设备覆盖循环规则

### 含义

v0.12.105 的开始时间与结构化循环仍使用 task snapshot v1 envelope，但通过 `x-focuslink-task-capabilities: task-scheduling-v1` 显式协商。新客户端读写 `startDate/recurrence`；0.12.104 严格客户端继续只收到旧字段。`completedCount` 是 authority 进度，MCP/CLI 创建或更新规则时不能指定它。

### 处理步骤

1. 先读取任务 revision、`startDate/dueDate/recurrence` 和 mutation confirmation；不要把“完成按钮已点击”当成循环已推进。
2. `task_revision_conflict`：重新 GET 并使用新 revision、新 operationId 重试。原 operationId 只能重放完全相同正文。
3. `invalid_task_mutation` / `invalid_recurrence`：确认 IANA timezone、interval、ISO weekday 1–7、month day 1–31、endAt/count 和 `from_schedule/from_completion`；循环任务必须至少有开始或截止时间，开始不能晚于截止。
4. 旧设备整包写回不会删除新循环字段；若旧写入改变了循环任务的日期而无法与规则合并，authority 返回 conflict 并保留当前快照。升级旧设备后再按最新 revision 修改。
5. `complete_task` 返回 `recurrenceRolled=true` 时任务仍为未完成并给出下一截止时间；只有 `recurrenceExhausted=true` 才进入已完成。恢复只回退最终耗尽的那一次完成。

### 验证

运行 `npm test -- tests/taskRecurrence.test.ts tests/taskSnapshotMutation.test.ts tests/taskSnapshotCloud.test.ts tests/focuslinkCli.test.ts`，并运行 `cloud/mcp` 全量测试。兼容门禁必须同时覆盖无 capability 的旧 GET 不含新字段、旧整包 POST 保留循环、带 capability 的 PC/移动/MCP/CLI round-trip、重复 operation 不二次推进次数。

## FL-SYNC-013：平板显示“实时状态已连接”，但任务第一次创建/移动/完成失败

### 含义与根因

实时 long-poll、任务快照和已结束账本是三条独立链路。“实时状态已连接”只证明 live 链当前确认，不能证明用户动作前的 task GET 已提交。v0.12.105 补修前，移动端后台每 5 秒刷新与创建/移动/完成前的强制刷新共用 latest-wins lifecycle；同账号的后发 GET 会 abort 先发 GET，前台收到 `null` 后显示“未能确认最新任务清单”，稍后重试却成功。这是同账号读请求竞态，不是配对码、revision 冲突或凭据失效。

### 处理步骤

1. 分别记录顶部 live 状态、任务 revision、动作时间和错误；不要连续点击、清 IndexedDB 或重新配对。
2. 等待一个 5 秒周期后只读观察 revision。revision 前进且立即重试成功，优先按同账号 refresh 竞态排查；401/403、transport timeout 和 `task_revision_conflict` 仍按各自错误分类。
3. 修复后的客户端以 connection key 合并同账号 in-flight task refresh；前台 mutation await 同一个 Promise。账号/endpoint/token 切换仍必须 invalidate 并 abort 旧请求，禁止跨账号复用。
4. 账号切换从 native credential mutation 开始建立 transition barrier；task/live/ledger 在提交 React 或 IndexedDB 前同时核对 request lease、connection key 和 barrier。清缓存仍未结束时，旧账号 interval 即使触发也只能返回空结果。
5. completed-ledger 同样合并同账号在途 pull，避免一次 pull 已落 IndexedDB 却在 React 状态提交前被另一轮取消；Cloudflare 往返期间保留旧账本并显示 pulling，完成后无需重载页面收敛。

### 验证

自动化覆盖同 key 只执行一次、两个 await 获得同结果、不同 key 新建请求且旧 finally 不清新请求。真机先触发顶部刷新，再在 50ms 内第一次完成/恢复任务，两个动作都必须直接成功；删除临时账本后连续触发两次刷新，页面应在有界请求完成后从 1 场变为 0 场且不 reload。所有临时任务、清单、会话和 tombstone 结果必须精确回读并清理。

## FL-SYNC-014：覆盖安装后原生凭据仍在，但移动界面显示“尚未配对设备”

### 含义与根因

先把 Android Keystore 事实与 renderer 状态分开：native `getConnection()` 显示 configured 只证明安全存储仍有凭据；界面显示未配对只说明 React 尚未把该凭据恢复到内存。1.3 补修前，`MobileApp`、专注原生控制和设置权限区都只在首次 render 检查一次 `isPluginAvailable('FocusRuntime')`。OEM WebView 若在该检查后才完成插件注入，恢复 effect 永久退出，即使稍后原生调用已经可用，界面仍保持 unconfigured。这不是配对码错误、凭据失效或云端 transport 故障。

### 处理步骤

1. 不清 Web Storage、IndexedDB、应用数据或 Keystore，也不重新输入配对码。先分别记录脱敏布尔：`isNativePlatform`、`isPluginAvailable('FocusRuntime')`、native `getConnection().configured`，禁止输出 access token。
2. 若 native configured=true 而 renderer unconfigured，回到前台或重新聚焦一次，观察有界 readiness 重试是否恢复设备身份；不要连续点击登录/配对，因为显式账号操作会按设计废止旧启动恢复 generation。
3. 修复后的原生能力探测只在 Android 轮询插件，启动连续执行三段、每段最多 5 秒；仍未就绪时再由 foreground/focus/pageshow 触发新一组有界探测。startup generation 在组件创建时预留且始终复用；显式登录、配对、退出的 generation 优先，旧恢复不得取消或覆盖它。
4. Android 的 native connection read/configure/clear 必须在插件暂不可用时有界等待后失败关闭。返回 `null` 只适用于非 native Web；Android 不得把空 native state 当作持久写入或清除成功，否则退出后旧凭据可能复活，配对后也可能在下次启动丢失。

### 验证

自动化覆盖插件晚注入、超时、AbortSignal、startup generation 复用、显式账号操作抢占、配对持久写入等待和退出持久清除等待。真机使用正式 applicationId APK执行原位 `adb install -r`，不清数据；启动时记录上述三个脱敏布尔，确认自动恢复实时连接、任务 revision 与账本，再执行一次前后台切换。只有界面与 native deviceId/lease 收敛且无需重新配对，才可关闭本条。

## FL-SYNC-015：番茄 To-do「等待同步确认」为何不能显示具体原因

### 含义

历史页与设置页的 `confirmation-pending` 状态只表示「本机保留了一个待处理操作，尚未获得完整确认」。它刻意不写具体原因（记录写入 / 分类更新 / 手机投递），因为当前数据结构无法可靠区分这三者。

### 数据结构审计（2026-09-10，只读）

durable 队列是单个 settings 键 `tomatodo.pendingSegmentIdsV060`，值是一个扁平的 `string[]`（仅 segment ID，无原因字段）。三类意图都会往同一个列表里追加同一个 segment ID：

- **记录写入**：新 segment 需要写一条 PCRecord；
- **分类更新**：手动改学科后重新上传；
- **手机投递**：云上传已成功但手机 `syncRecord` 尚未确认。

这三者不是独立的 durable 条目，而是复用同一个 segment ID。因此在「不改 SQLite 表结构、不做迁移」的前提下，**不能**可靠区分原因，根因有两点：

1. 同一个 segment ID 可以同时因多个原因处于 pending（例如一条新记录既没写入、手机也没投递）。
2. `cloudSynced=true`（旧 marker）不能用来反推「仅在等手机」：一条 pending 的学科更新可能也带着旧 subject 的 `cloudSynced=1`（正是 FL-SYNC-009 强调的「不要用旧 isSynced=1 确认尚未写入的新学科」）。若按 `cloudSynced` 推导，会把「新学科待上传」误报成「手机投递待确认」。

在读数时靠 `recordState.exists / cloudSynced` 反推只是部分且易错的启发式，会编出不存在的原因，违反「不为好看硬造语义」的纪律。故本轮保持诚实措辞：显示「等待同步确认」，title 说明「可能涉及记录写入、分类更新或手机投递」，不编造具体原因。

### 需要动数据结构的方案（本轮不做）

要让原因可解释，必须让 durable 队列携带每项的意图原因，例如把值从 `string[]` 改为 `Array<{ id: string; reasons: Array<'record-write'|'subject-update'|'phone-delivery'> }>`，或按原因拆成多个 durable 键。这涉及 settings 值的形状迁移，本轮按约束不实施、不动 SQLite 表结构、不做迁移。待该结构落地后，历史页才可按原因显示，且旧 `string[]` 值需做兼容读取。

### 验证

`tests/tomatodoSyncService.test.ts` 与 `tests/historyTimelineRenderer.test.ts` 锁住以下不变量：状态读取不清 durable 队列、不写外部记录；旧的云端确认不得被新的待处理学科借用（`cloudSynced` 在仍有 durable pending 时回落为 `confirmation-pending`）；超 7 天的未确认历史保持 `expired-history` 且不计入重试；渲染层只显示诚实的「等待同步确认」，不声称「等待手机」或「已上传」。所有用例均用真实 fixture，不使用伪造 checkpoint、不改 `isSynced` 来让提示消失。

## 日志位置与收集方式

Windows 日志在 `%APPDATA%\focuslink\logs\focuslink-YYYY-MM-DD.log`。只提供包含错误编号/时间、endpoint（可打码）和 HTTP 状态的片段；不要提供 `focuslink-device-sync-credential.json`、访问令牌或整个 SQLite 文件。

## 维护规则

- 新错误先分配稳定 `FL-SYNC-xxx` 编号，再补触发条件、可逆处理和验证命令。
- 每轮同步改动前先读 `IMPLEMENTATION_LOG.md` 顶部当前版本 Bug/事故、相关 `FL-SYNC-*` 条目和完整 `TEST_AND_RELEASE.md`；禁止另建平行 Bug 日志或一次性故障报告。
- 跨设备、滴答清单、番茄 To-do 三条同步链路的成功状态不能互相冒充。
- 任何“已同步”结论都必须有对应服务的确认；网络不可达只能显示“未同步/同步失败”。
- 番茄 To-do 自 2026-10-13 起是**批准后同步**：`tomatodo.autoSyncEnabled=false` 时产品不得在后台写库或上传，只能由用户答复后经 `npm run tomatodo:approve` 写入。核对与写入的读写面必须分开（见 FL-SYNC-021）。
- 番茄记录名（`PCRecord.name`）**默认必须是学科名**（数学/英语/物理/化学/生物/语文/学习）：只有用户明确点名要某个自定义标题时才写 `focus_sessions.tomatodo_record_name`。擅自使用自定义标题会把记录在用户手机上标成另一个标签，属于改变用户可见结果，必须逐场得到答复（用户 2026-10-13 明确要求）。
- 上传番茄记录不能只看返回值：`cloudSyncUploadRecord` 的 `success` 只代表调用成功，受第三方投递节流影响（见 FL-SYNC-024）；多条记录必须逐条间隔重传，并以用户手机端确认作为唯一可见性证据。

## FL-SYNC-016：统计页已关联会话，但片段仍显示未关联

这是本地关联层级问题，不等于设备传输失败或滴答写入失败。`timer.linkSessionTask` 对已结束会话只更新会话默认任务；片段自己的 taskId 不会自动修改。诊断时分别读取 `sessions.get` 的 session 默认任务与每个 segment.taskId，不能只看标题或任意历史 lastError。

v1.3.20 PC 统计页关联会话后显式执行 `linkSegmentsBatch(..., onlyUnlinked=true)`；已有片段关联保持原值。独立片段更换走 `timer.linkTask`。取消选择器不发 mutation。两次会话调用不是原子事务，若第二步失败，应重新读取当前状态，保留已经成功的会话默认关联并显示失败；不得为了补关联清空同步冲突、重置设备身份或覆盖其他已关联片段。

重复诊断以 `npm run smoke:stats` 的隔离 renderer 为起点，真实端只读核对会话与片段。完成本地关联不能宣称已经同步到滴答清单或其他设备。

## FL-SYNC-017：实时专注已结束，但本机统计缺记录

先独立读取云端 authority 的 live state 与 completed session，再只读本机同一 sessionId；云端 finished、本机缺失是导入待确认，不能报成计时结束失败，也不能用快照时长伪造本地会话。2026-10-02 的 `772f4d04` 云端包含两个 segment/一次 pause，而 PC exchange 持续 `contract_error`。

检查已认证设备 ID 与待发 mutation.deviceId：历史安装 UUID 的操作会被 canonical adapter 拒绝。v1.3.21 仅将同 scope、本机 legacy ID 的操作路由到当前已认证设备，保留 opId/payload；其他设备身份不得重写。先无 mutation 拉取，再推送，避免任意旧操作阻断新会话投影。诊断与验收不得删除真实记录或清空冲突来伪造成功。

已确认结束后若导入失败，呈现“专注已结束，记录已保存在云端，等待导入本机”；重试通过原同步路径导入一次，核对 session、segments、pauses 三表和统计请求范围。transport、身份鉴权、耐久冲突与第三方待投递分别记录；滴答或番茄未确认不代表本地/FocusLink 云端记录丢失。

## FL-SYNC-018：番茄 To-do 的自定义记录标题变回「学习」

### 含义

番茄记录名与学科分类是**两层数据**，不能互相冒充。`focus_segments.tomatodo_subject` 是统计口径（只能是 语文/数学/英语/物理/化学/生物/学习 七个值）；`focus_segments.tomatodo_record_name` 是用户可见的记录标题，可以为空（为空时 `buildTomatodoRecord` 写 `name = subject`），也可以是完全自定义的字符串（如「数学错题回顾」，上限 40 个码点）。出现「标题变回『学习』」时，先判断是哪一层被抹：本地 SQLite、`tomatodo_db.json`、还是云端记录。

### 根因（2026-10-13 修复，v1.6.1 未升版本）

1. 旧实现 `buildTomatodoRecord` 恒为 `name: input.subject`，产品里不存在记录标题概念。
2. 旧 `uploadPendingTomatodoRecordsUnlocked` 的待传回填是 `subject: isTomatodoSubject(record.name) ? record.name : TOMATODO_FALLBACK_SUBJECT`：**任何非学科名都会被降级成「学习」并写回待传记录**，一次上传就把用户手改的标题抹掉。现改为 `recordName: record.name`，记录名原样保留，`subject` 只用于统计兜底。
3. 旧 `updateTomatodoRecordSubjects` 的幂等判断按学科比较，导致「改名」既不触发重新上传、又可能被同名判断跳过。现按**最终记录名**比较：同名返回原记录（保住 `isSynced=1`），改名写 `isSynced=0` 重新排队。

### 处理步骤

1. 读 `SELECT id, tomatodo_subject, tomatodo_record_name FROM focus_segments WHERE ...`，确认自定义标题是否还在本地库里；本地为空说明从未保存过标题，不是同步丢失。
2. 用 `parseSegmentIdFromMarker(record.s1)` 在 `tomatodo_db.json` 找对应 `PCRecord`，读 `name` 与 `isSynced`：`name` 正确但 `isSynced=0` 表示「已写入本地、尚未上云」；`name` 已被改成「学习」说明写入方仍是旧逻辑。
3. 判定期望值用 `resolveSegmentRecordName(segment, subject)`，不要自己拼。
4. **必须重启 FocusLink 再上传**：运行中的旧实例内存里仍是旧回填逻辑，在它上面点「立即上传」会再次把标题抹成「学习」。

### 验证

`tests/tomatodoPolicy.test.ts` 锁归一化/回退/构建；`tests/tomatodoAdapter.test.ts` 锁「改名写 `isSynced=0`、同名保 `isSynced=1`」；`tests/tomatodoSyncService.test.ts` 锁「保存并推桥」「清空回退学科」「状态读取不写外部」「**回填不把自定义标题降级成『学习』**」。

### 边界

durable 队列 `tomatodo.pendingSegmentIdsV060` 仍是扁平 `string[]`，记录改名是第四类复用同一 segment ID 的意图，同样不区分原因（见 FL-SYNC-015），措辞继续保持「等待同步确认」。番茄客户端仍**没有远端删除 API**：删除只保证本机 marker 清理，`remoteDeleteSupported=false`，不得宣称远端已清理。

## FL-SYNC-019：番茄 Todo 明明在运行，却报「本地同步桥不可用」（手机直连 API 缺失被当成身份校验失败）

### 含义

`tomatodo_bridge_identity_not_verified` 有两种完全不同的来源，必须分开记：**(a)** 端口上没有番茄页面，是真的没连上；**(b)** 页面在、标题也对，但身份校验要求的某个 `electronAPI` 方法不存在。2026-10-13 本机遇到的是 (b)，而界面文案一律说成「番茄 Todo 正在运行，但本地同步桥不可用」，会把能力差异误报成连接故障。

### 现象与证据（2026-10-13 11:00 本机实测）

- 番茄 Todo 正在运行（`C:\Program Files\TomaToDo\TomaToDo.exe`，4 个进程，`%APPDATA%\tomatodo\DevToolsActivePort` = 55409）；CDP `/json/list` 能取到 page target，`document.title` = `番茄ToDo`。
- `ensureTomatodoBridge()` 返回 `{state:'connected', connected:true}`（它只要求云 API），但 `syncSegmentToTomatodo` 立刻返回 `tomatodo_bridge_identity_not_verified`。
- 页面内 `typeof window.electronAPI[m]`：8 个云方法（`getAllRecords`/`addRecord`/`updateRecord`/`deleteRecord`/`getRecentUnsyncedRecordsForCurrentDevice`/`cloudSyncGetStatus`/`cloudSyncUploadRecord`/`cloudSyncFetchTodo`）全是 `function`，`cloudSyncGetStatus()` 返回 `{isBound:true, bound:true, deviceToken:'pc_...'}`；而 **`syncGetStatus` 与 `syncRecord` 都是 `undefined`**（`Object.keys` 里也没有）。该版本同时暴露 `syncUnbind`，说明这不是「未绑定手机」，而是这个方法族在本版本/本账号下根本不存在。
- 后果：`syncSegmentToTomatodo` 恒传 `syncToPhone:true`，身份校验要求 `[...云方法, ...TOMATODO_PHONE_IDENTITY_METHODS]` → 必然失败 → 用户番茄库里 442 条带 FocusLink marker 的记录全部 `isSynced=0`，**从未有一条真正上传过云**。

### 根因（2026-10-13 修复，v1.6.1 未升版本）

`electron/integrations/tomatodo/cloudBridge.ts` 把**手机直连 API 当成了目标身份的一部分**：`writeTomatodoRecordsThroughBridge` 与 `updateTomatodoRecordNameThroughBridge` 在 `syncToPhone` 为真时把 `syncGetStatus`/`syncRecord` 加进 `evaluateJson` 的必需方法列表，缺失即判「不是可信的番茄页面」，整条写库 + 云上传被丢弃；脚本内 `(${syncToPhone} && (!api.syncGetStatus || !api.syncRecord))` 也在最外层直接 `return { ok:false }`。**手机投递是能力，不是身份。**

### 处理步骤

1. 用**只读** CDP 探测区分 (a)/(b)：读 `DevToolsActivePort` 首行端口 → `/json/list` 找 `type==='page'` → `Runtime.evaluate` 打印 `typeof window.electronAPI[<method>]`。只有确认页面在、标题是「番茄To-do」、云方法齐全，才谈得上「桥可用」。
2. 出现 `..._identity_not_verified` 时**不要**去关掉或重启用户的番茄 Todo：`bridgeLifecycle` 对「已运行但无桥」返回 `restart-required`，禁止杀进程。
3. 修复后身份校验只要求**品牌标题 + 8 个云 API**；手机通道改用 `TOMATODO_PHONE_IDENTITY_METHODS` 运行时探测，缺失时只跳过手机投递并回填 `phoneSyncError='tomatodo_phone_sync_api_unavailable'`，写库与云上传照常完成。
4. 单条云上传受番茄接口节流：一次运行里通常只有第一条拿到 `uploadConfirmed:true`，其余返回 `cloudError='cloud_upload_failed'`；对**已存在 marker** 的记录要间隔数秒重试，重试后 `isSynced` 变 1。批量路径 `writeTomatodoRecordsThroughBridge` 对已有 marker 走 `skipped`，**不能**用它补上传旧记录，补上传要用 `updateTomatodoRecordNameThroughBridge`。

### 验证

`tests/tomatodoCloudBridge.test.ts`：无手机 API 时写库 + 云上传仍成功且 `phoneSyncError='tomatodo_phone_sync_api_unavailable'`；同条件下改名同样成功；原有「云确认与手机投递分开」「无手机连接时为 `tomatodo_phone_not_connected`」「已确认记录仍要重试手机投递」用例保持不变。

### 边界

- 云上传成功 = `cloudSyncUploadRecord` 返回 success 且回写 `isSynced=1`，即「上传已确认」，**不是独立云端回读**（`cloudRecordReadbackSupported=false`）。
- 手机投递在缺少该 API 的客户端上**无法验证**，因此 durable 队列不会被 `completeDurableTomatodoSegments` 清除，状态如实停在 `confirmation-pending`。把「客户端没有手机通道」直接视为「不需要手机投递」会改变产品语义，**待决，勿擅改**。
- `syncToPhone:false` 时返回的 `phoneSyncConfirmed:true` 语义是「本次没有请求手机投递」，**不能读成手机投递已验证**。

## FL-SYNC-020：番茄 To-do 里一次专注只同步了几分钟（记录粒度与时长口径）

### 含义

番茄 Todo 里 FocusLink 记录的时长与专注列表显示的分钟数不一致（例如列表显示 1 小时 54 分钟，番茄里那条却是 7 分钟），或一次专注会话在番茄里出现好几条记录。

### 根因（2026-10-13 修复，v1.6.1 未升版本）

1. 记录粒度是**片段**（marker `[FocusLink:tomatodo:segment:<id>]`），一次会话里每段打断/继续都单独成条，时长只算该片段。
2. `PCRecord.time` 写毫秒真值（`activeElapsedMs / 60000` 保留 6 位小数，如 `7.5046`）：番茄客户端显示时**截断**成 7，FocusLink 的 `formatMinutes`（`src/lib/time.ts:30-37`）用 `Math.round` 得到 8，同一条记录两边读数不同。
3. `createDate` 取片段结束时刻，把会话中间的暂停也算进跨度。

### 处理步骤

1. 先判 marker 种类（`parseTomatodoMarker`）：`segment:` 是旧口径记录，`session:` 是新口径。
2. 新口径：**一条番茄记录 = 一次专注会话**；`time = Math.max(1, Math.round(会话 activeElapsedMs / 60000))`（与界面 `formatMinutes` 同一取整）；`startDate = 会话 startedAt`；`createDate = startedAt + minutes * 60000`，**不把会话中间暂停推给终点**。用 `buildTomatodoSessionRecord` 构造，marker 为 `[FocusLink:tomatodo:session:<id>]`。
3. 会话的学科/标题取 `focus_sessions.tomatodo_subject` / `tomatodo_record_name`；来源片段由 `pickTomatodoSessionSourceSegment` 决定（带自定义标题 → 手动学科 → 最早片段）。**不要**回头改统计页口径去对齐：统计卡片的分钟是按任务把片段相加，与专注记录口径本来就不同源（用户 2026-10-13 明确要求各按各的）。
4. 就地修复历史记录：按 marker 找记录，改 `name` / `time` / `startDate` / `createDate` / `s1` 并写 `isSynced=0` 重新上传。**不要**改 `startDate` 去骗 7 天窗口（见 FL-SYNC-009）。
5. 上传：`cloudSyncUploadRecord({ records: [record], updateTime: Date.now() })` —— 传裸 record 会返回 `{ success: false }`。该接口有节流，一次运行里第二条起常失败，需间隔数秒重试，成功后把 `isSynced` 回写为 1。

### 验证

`tests/tomatodoSyncService.test.ts`（会话级重写，34 项）锁住：`450276ms → 8`、`6842106ms → 114`、`0 / -5 → 1`；同一会话多片段只写一条记录；`getTomatodoSyncStatus` 只读不写外部记录、不清 durable 队列；桥返回失败不得被算成「上传已确认」。

### 边界

- durable 队列键从 `tomatodo.pendingSegmentIdsV060` 改为 `tomatodo.pendingSessionIdsV161`（值仍是扁平 `string[]`，装 session id）；旧键在下次启动时由 `settingsStore` 一次性迁移清空，旧片段级意图**不重放**（重放会为同一会话写出第二条记录）。
- 记录粒度改为会话后，**跨设备同步不再携带学科与标题**（`shared/sync/deviceProtocol.ts` 的片段白名单没有会话级列）。本轮 PC-only，未改协议。
- 旧的片段级记录保留在本机、保持未同步、不再重试；`remoteDeleteSupported=false`，本地删除不等于远端清理。
- **实测（2026-10-13 12:2x）**：删掉重复的片段级记录后，**仍在运行的旧代码实例**会按 `tomatodo.pendingSegmentIdsV060` 里的片段 id 把记录**重建**回来（PCRecord 485 复现：`time=50.954883` 原始毫秒值 + `segment:` marker）。所以清理重复记录**必须同时清空旧队列**，否则旧实例会周期性写回；彻底止住要等新代码启动（`settingsStore` 迁移清空旧键，且新代码只按 session id 工作）。清空后 100 秒内未再复现。
- 番茄 `electronAPI.deleteRecord` 的参数是**记录 id**（`api.deleteRecord(record.id)`），传记录对象不会报错但**不会删除**。
- **不要手工给 PCRecord 写 `isSynced=1`**（实测 2026-10-13）：一次性运维脚本给 483/486/488 手工标了 `isSynced=1` 并声称上传过，但手机上一直没有这几条记录；随后用 `cloudSyncUploadRecord({ records: [record], updateTime: Date.now() })` 逐条**单独**重传，每条都返回 `{ success: true }`，手机随即显示。结论：本地标记 ≠ 云端收下 ≠ 手机可见，三者必须分开判；批量的 `cloudSyncUploadRecord` 会被节流（一次通常只有第一条真被确认），补传必须逐条、间隔数秒。

## FL-SYNC-021：番茄 To-do 里莫名其妙多出旧日期的专注记录（后台自动同步未关）

### 含义

番茄 To-do（尤其手机端）出现若干条**用户没有批准过**的记录：日期是几天前甚至几个月前，时长看着合理，名字多为「学习」。FocusLink 界面里这些会话的状态却可能是「未写入」或「等待同步确认」。

### 根因（2026-10-13 记录，v1.6.1 未升版本）

1. `electron/main.ts` 的 `autoSyncFinishedSession` 与 `runTomatodoPendingUpload` 会在**后台自动**写番茄库并上传，用户没有机会在写库前确认标题；标题自动推断（`inferTomatodoSubject`）认不出「第二章直线部分回顾复盘」这类表述（`直线` 不在数学关键词表里），于是先按错误名字建单。
2. 周期路径会把 durable 队列里的历史 session **重建**为会话级记录，其中落在番茄云 7 天窗口内的会被真正上传。实测（2026-10-13 12:59:40–14:50 新代码在闸门加入前运行）：`PCRecord` 442 → **589**，新增 150 条会话 marker 记录，**18 条被上传**（2026-10-06…10-12，26–192 分钟，名字多为「学习」，`isSynced=1`）。
3. 当前客户端**没有远端删除 API**（`remoteDeleteSupported=false`），已上传的这类记录无法由本机撤回。

### 处理步骤

1. 先确认闸门在生效：`settings.tomatodo.autoSyncEnabled` 应为 `false`，且 `electron/main.ts` 的**两处**（专注结束路径与周期补传路径）都用 `shouldAutoSyncTomatodoSession` 判断。只堵一处等于没堵。
2. 核对是否真的在跑的新代码：用 `npm run tomatodo:check` 只读列出「结束时间 + 时长 + 建议标题 + 当前状态」，它**不写任何东西**；写入必须单独由 `npm run tomatodo:approve` 触发。跑这两个命令前 `Remove-Item Env:ELECTRON_RUN_AS_NODE`。
3. 判断番茄库里哪些是未批准记录：按 marker 取 `parseTomatodoMarker`，会话 marker 的记录对应 `focus_sessions.id`；对照 `focus_sessions.tomatodo_subject` / `tomatodo_record_name` 是否为空（用户从未批准/选择过）。
4. 本地清理用 `deleteTomatodoRecordBySessionId` / `api.deleteRecord(record.id)`（参数是**记录 id**，不是记录对象）；已上传云端的记录只能如实报告 `remoteDeleteSupported=false`，交给用户在手机端删除，**不得声称远端已清理**。

### 验证

`tests/tomatodoPolicy.test.ts` 的 `tomatodo sync gating` 用例锁住「总开关关 / 自动同步关 / 两者皆开」三种组合；`npm test` 147 文件 / 1234 项全绿。

### 边界

- 每小时核对是 **DSH 会话级提醒**，只在宿主进程存活时触发，且停机后**只补发最后一次**漏掉的提醒；它不是产品能力，关机期间不会检查，也不会自己写番茄。
- 未批准前该次会话在番茄里**完全没有记录**，`getTomatodoSyncStatus` 如实显示 `not-written`（不假装在等同步）。
- 进行中的专注**只报告、不写番茄**：`activeElapsedMs` 仍在增长，此刻写库必然写出错误时长。
- 历史 132 条已重建但未上传的会话级记录留在本机、保持未同步；不要为了「让状态好看」把它们标成已同步。

## FL-SYNC-022：设备同步一直 network_error（开着 Clash 系统代理/fake-ip，Node fetch 不走代理）

### 含义

日志里周期性出现 `[deviceSync] sync failed {"errorCode":"network_error"}` 与 `canonical Sync v2 failed (network_error)`，但浏览器或 curl 访问同一域名却是通的。这是**进程级代理缺失**，不是账号、服务端或证书问题；同样地，界面上的「实时专注」看不见也可能是这个原因。诊断要按 DNS → TCP → TLS → 鉴权 → 产品状态分开记，**禁止**用一条历史 `lastError` 断言当前断网，也**禁止**要求用户关掉 Clash。

### 根因（2026-10-13 修复，v1.6.1 未升版本）

1. 设备同步全部使用 Node 全局 `fetch`（undici），**完全不读 Windows 系统代理**；`electron/` 下此前没有任何 `setProxy` / `proxyRules` / `resolveProxy` / `session.defaultSession` 用法。
2. Clash Verge 开着系统代理并使用 fake-ip 时，`foxlink-mcp.focuslink-poyi-6465e9.workers.dev` 被解析成 `198.18.0.6`（`198.18.0.0/15` 是跑分保留网段）。**绕开代理直连**该地址会 TLS 失败：`schannel: next InitializeSecurityContext failed: SEC_E_ILLEGAL_MESSAGE (0x80090326)`；而走 `127.0.0.1:7897` 正常（`/sync/v2/live` 无凭据返回 401 `device_credential_required`，说明 Worker 路由存在）。
3. 实测频率 2026-10-13 UTC 09:15–10:23 每 1–15 分钟一次失败，同一时段另有成功与 `conflict_present` 并存 → 表现为「间歇性」，正是查错时最容易被误判成服务抖动的形态。

### 处理步骤

1. 先分清是哪一层：对同一 URL 比较「直连」与「走系统代理」两条路径，读 DNS 结果是否为 `198.18.x.x`；**不要**关闭用户的 Clash，也不要建议改网络环境。
2. 应用侧修法（本轮已实现）：`electron/sync/deviceSyncProxy.ts` 用 `session.resolveProxy(endpoint)` 取 Chromium 的系统代理判定，非直连时给 undici 全局 dispatcher 装 `ProxyAgent`（回环地址豁免），在 `whenReady` 后、首次同步前安装，并在设备同步设置变更时重装。
3. 验证成功信号：日志出现 `[deviceSync] node fetch proxy resolved {"resolved":"PROXY 127.0.0.1:7897","proxyUrl":"http://127.0.0.1:7897","reason":"proxied"}`；随后不再出现 `network_error`，且活跃域的 `deviceSync.lastSyncAtV2` 继续推进。
4. 运维工具（`npm run tomatodo:check`）要读实时专注时，注意 `getSettings()` 走 electron-store，而 **electron-store 在构造时就把 cwd 钉死**：路径钉定必须放在 `scripts/maintenance/pinAppUserData.ts` 里并作为**第一条 import**，否则设置静默读成默认值（表现为「设备同步未启用或缺少凭据」）。

### 验证

`tests/deviceSyncProxy.test.ts`（10 项）覆盖直连、系统代理、fake-ip 地址串、`PROXY` 带 `DIRECT` 回退、`SOCKS5`、`HTTPS`、解析异常、回环豁免、重复安装幂等与 endpoint 变更重装。

### 边界

- 只跟随系统代理/PAC 的 Chromium 判定结果，不自建 PAC 求值；Clash 改模式后要等下一次设置变更或重启才重装 dispatcher。
- 代理通了**不等于**业务成功：`conflict_present` 是同步冲突，必须与网络错误分开报告，不能互相冒充。
- 实时专注由设备同步服务托管、**不落本机账本**；读到了也只表示「跟随中」，只有整场结束才进 `focus_sessions`，进行中一律只报告、不写番茄。

## FL-SYNC-023：开着「批准后同步」，番茄里还是多出了没批准过的记录（云端 provider delivery 绕过闸门）

### 含义

`tomatodo.autoSyncEnabled = false`（批准后同步）时，番茄 To-do 里仍然出现用户**没有批准过**的会话记录，名字通常是兜底的「学习」，时长与起止看起来完全正常、已经 `isSynced=1`；而 FocusLink 里该会话的 `tomatodo_subject` / `tomatodo_record_name` 都是空。它与 FL-SYNC-021 同属「未经批准就写番茄」，但**路径不同**：021 是本地定时路径，本条是云端下发的投递意图。

### 根因（2026-10-13 修复，v1.6.1 未升版本）

1. 闸门最初只堵了 `electron/main.ts` 的两条本地路径（`autoSyncFinishedSession`、`runTomatodoPendingUpload`）。
2. **第三条路径没堵**：`electron/sync/remoteWritebackCoordinator.ts` 的 `deliverTomatodo()` 执行云端 provider delivery 时直接 `syncSessionToTomatodo()` —— 于是「云侧记下了这次专注」就等于「本机立刻写番茄」。实测 2026-10-13 会话 `827833a5-cd87-4585-8535-b7f8fefeb71e`（「高二暑第三节」91 分钟）被写成 `PCRecord id=636`、`name="学习"`、`isSynced=1`。
3. 症状会持续刷日志：`[tomatodoSync] session synced {skipped:1, recordFound:true, syncState:"confirmation-pending"}` 与 `[remoteWriteback] provider delivery deferred {error:"tomatodo_cloud_pending:N"}` 每分钟重复。

### 处理步骤

1. 先把三条路径都点清：`electron/main.ts:autoSyncFinishedSession`、`electron/main.ts:runTomatodoPendingUpload`、`electron/sync/remoteWritebackCoordinator.ts:deliverTomatodo`。**只堵前两条等于没堵。**
2. 确认闸门判据统一：`shouldAutoSyncTomatodoSession(settings.tomatodo)`；协调器改用 `getTomatodoSyncStatus(sessionId).autoSyncEnabled`（避免在同步层再摸设置）。
3. 批准前该意图必须**不写、不重试风暴**：当作终态 no-op 并在日志留 `tomatodo delivery skipped: waiting for user approval`。
4. 用 `npm run tomatodo:check` 复核：`needsApproval` 现在会把「记录已存在但会话从未手动指定过学科」的记录重新算作**待批准**，并且「已上传」桶会排除它。

### 验证

`tests/remoteWritebackCoordinator.test.ts` 的 `never writes TomaToDo from a cloud intent while automatic sync is off` 断言自动同步关闭时不调用 `syncSessionToTomatodo`、意图按终态完成且不重试；`npm test` 148 文件 / 1245 项全绿。

### 边界

- 已经上传的记录**无法由本机撤回**（`remoteDeleteSupported=false`）；改名只能走批准流程重新上传，且要如实说明远端是否确认。
- 批准模式下「云侧认为已投递、番茄侧确实没有记录」是有意为之：**没有用户答复就不应该有番茄记录**；不要为了对齐云侧状态而偷偷写入。
- 「记录存在但会话从未指定过学科」只是可用的启发式；若用户批准时选的正是兜底学科「学习」，之后就无法与自动写出的记录区分。

## FL-SYNC-024：连续上传多条番茄记录，只有最后一条真正到手机

### 含义

同一小段时间内连着上传两条以上番茄专注记录时，`cloudSyncUploadRecord` 对**每一条**都返回 `{"success":true}`，本机 `PCRecord.isSynced` 也全是 `1`，但用户手机上只出现**最后上传的那一条**，前面几条并没有在番茄云落库。它与 FL-SYNC-009（超 7 天窗口）不同：这些记录日期都是当天、在窗口内，字段形状与已成功的那条完全相同（`isSynced=1`、`isTransfer=0`、`boundDeviceId=null`）。

### 现象与证据（2026-10-13 本机实测）

1. 22:2x 依次写入三条：`636`（物理，91 分钟，会话 `827833a5-cd87-4585-8535-b7f8fefeb71e`）、`637`（数学，58 分钟，会话 `15b0406c-4512-4780-9cd1-221f03a789f1`）、`638`（数学，5 分钟，会话 `fe8e3c83-0674-467d-96af-22c8d83dff18`）。`cloudSyncGetStatus()` 返回 `{isBound:true, deviceToken:'pc_1ad39d82c6b57c58069c02094484702d'}`，绑定正常。
2. 用户手机上只出现了 `638`。把 `636`、`637` 逐条重传（相隔 11 秒）后，仍是 `637` 未出现；把 `637` **单独**再传一次（与上一次上传相隔 30 秒）后才出现。
3. 更早的同类证据：`483`（114 分钟）当时 `isSynced=1`，手机上一直没有，单独重传一次才出现。
4. 当前番茄客户端**没有专注记录的云端回读接口**（`cloudRecordReadbackSupported=false`），因此本机无法自行确认云端到底收下了几条。

### 处理步骤

1. 要写多条时**逐条上传、间隔 ≥30 秒**，并把最需要确保落地的那条放在**最后**。
2. 不要只看 `success:true`：请用户在手机端刷新确认，本机没有回读能力。
3. `npm run tomatodo:check` 里的 `recordIsSynced` 只是本地标记，不代表手机可见；汇报时必须如实区分。
4. **不要为了让状态好看而手工给 `PCRecord` 写 `isSynced=1`**，那会把「没落库」伪装成「已同步」。

### 验证

`cloudSyncUploadRecord({records:[record], updateTime: Date.now()})` 逐条调用返回 `success:true`；间隔 30 秒重传后记录出现在用户手机上（2026-10-13 22:40 实测，`637`）。

### 边界

- 这是**第三方投递节流**，不是本机同步故障：不要因此改记录日期、不要伪造 `isSynced`，也不要报成 `network_error`。
- 已经落库的记录本机无法撤回（`remoteDeleteSupported=false`），只能改名后按批准流程重传。

## FL-SYNC-025：任务一直加载、小窗继续或 Ctrl+1 像卡死

### 区分症状

1. 同一时间查看 `hotkey trigger pressed`、异步完成/失败和 `liveFocus` 日志。按键有记录但状态未变，不代表未触发；早期版本会在网络结果之前错误写 `success:true`。2026-10-15 15:04:59 → 15:05:09 的真实记录是 10.255 秒后 transport 失败。
2. 任务读取若先等待 `/sync/v2/tasks`，断网会拖住已有本地任务。v1.6.2 的 `tasks:refresh({localOnly:true})` 不经过云端/CLI，已有列表可浏览，后台失败保留数据并显示更新失败。
3. 小窗操作有「确认中」或错误反馈，仍保持原有状态，表示尚无云端 ACK；不得改本地数据库或伪造 running 解除远端会话锁。

### 诊断顺序

- 先确认安装的 EXE/构建 commit，再按 `FL-SYNC-022` 检查应用是否跟随系统代理。不要关闭 Clash 或改变用户网络环境。
- 使用当前配置允许的 canonical/固定备用 origin 只读 `/healthz`；没有请求凭据的 `/sync/v2/live` 返回 401 只能证明路由/transport 可达，不证明账号有效。TLS reset、超时、401/403、耐久 conflict 与第三方投递分别归类。
- 同时验证本地列表是否立即出现、失败时任务是否仍在、鼠标与快捷键是否有 pending/错误、重复输入是否只发同一个 command。finish 已 ACK 而导入卡住时，控制台必须能继续使用；导入晚到不能覆盖新会话。
- 运行 `npm run smoke:performance`、`npm run smoke:stats` 和 controller 单元测试；无头 synthetic IPC 通过不能替代真实网络已恢复或原生拖拽已验证。

### 已知事实

2026-10-13 代理修复实例有真实成功；2026-10-15 15:33 的新 Node/代理探测仍得到 `ECONNRESET` 或 `/healthz` 超时。两者时间不同、可以同时成立，不能仅凭旧日志把当前故障说成已修复，也不能把当前失败反推成旧成功无效。

## FL-SYNC-026：手机上切换账号或「忘记配对」后，旧账号的任务清单自己回来了

### 区分症状

1. 操作顺序是「任务页有一次创建/改名/移动/勾完成正在等云端」→ 立刻在设置里换账号或点「忘记配对」→ 界面先显示新账号，几秒后旧账号的清单又出现在任务页；杀进程重开仍在，说明 IndexedDB 缓存也被写进去了。
2. 若只是任务页刷新回旧列表、杀进程后没有，那是读通道的旧快照（FL-SYNC-006 口径），不是本条。本条的特征是**写响应**越权提交。
3. 结束专注时的离线补交是另一条链路（原生队列 + 索引库两份写入），不要按本条处理。

### 含义

2026-10-26 之前的移动端只有任务/清单的**读**通道做了连接身份重验（`connectionKey` + 代际 + 提交前 `isMobileAccountRequestCommitCurrent`）。任务**写**通道（`createCloudTask` / `createCloudProject` / `updateCloudProject` / `deleteCloudProject` / `moveCloudTask` / `toggleCloudTaskComplete`）既不带 `AbortSignal`，也不在写回前复核账号身份：切账号只 abort 了实时与账本请求，写请求的 `await` 照常返回，直接把旧账号的 `TaskSnapshotResponse` 写进 `taskSnapshotRef`、`setTaskSnapshot` 和 `writeCachedTaskSnapshot`。

### 处理步骤

1. 先确认安装的版本；1.6.8 及更早的构建都有此缺口。修复在 `src/mobile/MobileApp.tsx` 的 `beginTaskWrite` 与 `src/mobile/accountLifecycle.ts` 的 `createMobileAccountRequestGroup`。
2. 复现后先看是否「内存与缓存同时回退」。只回退内存的按读通道处理；两者都回退的按本条记录 Bug 证据。
3. 修复后的判定口径：切账号 / 忘记配对 / 清缓存时 `taskWrites.invalidate()` 必须 abort 掉在途写，且响应回来时 `canCommit()` 为 false 则不写内存、不写缓存；这两点由 `tests/mobileTaskWriteCommit.test.ts`（源码契约）与 `tests/mobileAccountLifecycle.test.ts`（请求组语义）覆盖。
4. 不要把「写请求被取消」当成失败提示给用户；账号已经切换，该操作本来就不该生效，静默丢弃是正确的。

## FL-SYNC-027：同一场专注在手机上结束两次后，账本再也对不上

### 区分症状

1. 结束一场离线专注时提交失败（例如存储写失败或原生队列报错），草稿还在；过一会儿重开草稿再点结束，之后这条会话在云端/桌面端反复出现 `revision_conflict`，待传数量降不下去，删除重试也不收敛。
2. 界面上先看到「离线会话已安全保存」，但实际原生队列里已经有第一份记录；这是 `nativeQueued` 单布尔把「没排队 / 已排队 / 身份冲突」压成一个 `false` 造成的误报，不是网络问题。
3. 只有「同一 session id 结束两次」才会触发。普通断网重试、切账号后的写取消是另两条链路（FL-SYNC-026 与本条无关）。

### 含义

2026-10-26 之前，待传记录的 `opId` 由含 `endedAt` 的 payload 派生（`makeDeviceSyncOperationId(session.id,'put',0,bundle)`），而 Android 原生队列按 `bundleId` 去重、对异 payload 直接抛 `IllegalArgumentException('completed ledger identity already exists')`；该异常被调用方的 `.catch(() => false)` 吞掉。于是 IndexedDB 侧排进第二份 payload，服务端按 revision 判冲突，而本地没有消费冲突的入口，账本永久不收敛。

### 处理步骤

1. 先确认安装版本：1.6.8 及更早的构建都有此缺口；修复在 `src/mobile/offlineCompletionIdentity.ts` 的冻结身份与 `src/mobile/cache.ts` 的 `COMPLETION_FREEZE_PREFIX`。
2. 复现后看 IndexedDB：`meta` 里 `offlineCompletionFreeze.<sessionId>` 应存在且 `endedAt` 等于第一次结束的值；`pendingBundles` 里该会话只应有 1 条记录，`bundle.session.endedAt` 与冻结值一致。
3. 修复后的判定口径：同一 session 第二次结束必须是 `reusedFreeze:true` + `native:'duplicate'` 或 `'identity-conflict'`，提示文案不得出现「已安全保存」；`pending===null` 时草稿必须保留。对应测试为 `tests/mobileOfflineCompletionIdempotency.test.ts`。
4. 已经产生的双写分叉不会自动消失：服务端冲突需要人工处理，不要通过改本地 `endedAt` 或伪造 revision 来「修好」。

## FL-SYNC-028：手机上的同步冲突一直挂着，看得到却点不动

### 区分症状

1. 设置页出现「同步冲突」分区并列出同一场专注的两列差异（本机 vs 云端），点「保留本机」或「采用云端」后没有任何结果文案，条目也不消失。只有 1.6.9 及以后的构建有这个分区；1.6.8 及更早根本没有入口。
2. 老版本表现为：账本卡片显示冲突计数，或被 `NativeSystemControls` 提示「去电脑端处理」，而桌面端只有一条 toast 计数，找不到能点的地方。这是同一条缺口的旧面孔。
3. 结束专注时的离线双写（FL-SYNC-027）和任务写通道越权（FL-SYNC-026）是另外两条链路，不要按本条处理。

### 含义

2026-10-26 之前，冲突只在本地被「记录」：`src/mobile/v2Cache.ts` 的 `putRemoteConflict()` 往 `syncConflicts` 写一行，带 `base` / `local` / `remote` 三份 payload，但全仓没有消费方。`src/mobile/SyncV2Management.tsx` 写好了却没有任何 import；`POST /v2/conflicts/:id/resolve` 只有服务端实现、零调用，而且对本机这种 `remote-<changeSeq>-<type>-<entityId>` 的本地记录不成立（云端没有对应的冲突行）。结果是账本永远「有 1 条冲突」，用户既看不到差异也做不了决定。

### 处理步骤

1. 先确认版本：本闭环在 1.6.9 及以后；1.6.8 及更早没有设置页分区。代码入口是 `src/mobile/v2ConflictResolution.ts` 与 `src/mobile/MobileApp.tsx` 的 `resolveSyncConflict()`。
2. 核对显示：设置 →「同步冲突」，每条应显示标题、原因、本机/云端两列差异；`blockedReason` 非空时两个按钮禁用并给出原因（版本号缺失、payload 类型不符）。
3. 判定口径：点下决定后必须出现六种结局之一（已按你的选择收敛 / 这次选择此前已提交过 / 冲突还在 / 云端拒绝了这次选择 / 已排队 / 还没拿到回执）；同一行应收敛为 `resolved`，`resolutionOpId === resolve:<conflictId>:<side>`；同一实体的旧 pending 上传必须被 `supersedeMobileV2PendingMutations()` 清掉，不能与决定一起上传。
4. 云端同时被别的设备改过时会得到 `conflict`，冲突仍在——刷新账本按新差异再选一次即可；不要手改 IndexedDB，也不要用 `POST /v2/conflicts/:id/resolve` 去凑本地记录（云端没有那行，必然 404）。

## FL-SYNC-029：手机上账本同步失败，界面说「云端账本响应异常」，但其实只是被限流或云端在重启

### 区分症状

1. 设置页的账本新鲜度显示「最近刷新失败」，账本提示是「云端账本响应异常」，而同一台电脑端此刻能正常同步，或者过几分钟自己就恢复了。这种「一会儿坏一会儿好」不符合契约错误的特征。
2. 老版本（1.6.8 及更早）没有重试提示：失败后就一直停着，只能靠手点「重新检查」或重启 App，用户会以为同步坏了。新版本会多一句「约 N 秒后自动重试」。
3. 与契约错误的分界：真正的契约错误（响应格式/字段集不符、`invalid_exchange_request`）重试多少次都不会好，文案是「云端账本响应异常」或「云端拒绝」；429/5xx 属于可自愈的退让信号。

### 含义

2026-10-26 之前，`src/mobile/v2Sync.ts` 的请求层只映射 401/403/400+`invalid_exchange_request`，其余非 2xx 一律 `contract_error`，于是 429 限流与 5xx 故障被显示成「云端账本响应异常」；同时 `drain()` 对任何失败都固定 `now + 30_000` 重试、无上限，也不读 `cloud/deviceSyncServer.ts` 给出的 `Retry-After`。结果是既误导了排查方向，又在该退让的时候按固定节奏猛打。

### 处理步骤

1. 先确认版本：可重试分类与退避在 1.6.9 及以后；1.6.8 及更早按老口径排查（没有 `rate_limited` / `server_error` 两个码）。
2. 判定当前失败属于哪一类：看设置页账本提示与 `Meta` 里的 `LAST_ERROR.code`——`rate_limited`（429）、`server_error`（5xx）、`network_error` / `timeout` 属可自愈；`contract_error` / `invalid_exchange_request` / `authentication_failed` / `authorization_failed` 属终止类，重试无意义，应查凭据、版本与服务端字段集。
3. 看退避是否生效：outbox 行的 `attemptCount` 应随失败增长，`nextRetryAt` 应落在 `15s × 2^(n-1)` 与封顶 15 分钟之间，且不早于服务端 `Retry-After`；终止类失败应停在封顶（等用户动作），不应每 30 秒重来。
4. 不要手工改 outbox 的 `nextRetryAt` 或 `attemptCount` 来「催」同步：调度器只认这两个字段，改小会让限流更严重；需要立刻重试用设置页的「重新检查」入口。

## FL-SYNC-030：锁屏或切账号之后，通知栏快捷动作还在后台发包

### 区分症状

1. 在锁屏、通知栏或系统快捷动作上结束专注后，回到 App 会看到这次动作像是「已经发出去又没生效」：账本多拉了一次、快照里出现过不属于当前账号的任务，或者切账号后旧账号的清单自己回来了。这类现象只在「锁屏/切后台那一刻正好有原生命令在途」时出现。
2. 老版本（1.6.8 及更早）在进入后台时只中止 live 请求，原生命令的 drain 循环没有任何 `AbortSignal`，5 秒定时器也照旧触发，因此在后台持续发包与写缓存。1.6.9 及以后的构建里，切账号、忘记配对、进入后台都会 abort 在途命令。
3. 单纯「账本刷新次数多、耗电偏快」但没有旧账号数据复活，属于同一轮修掉的第二条缺口（同连接重复拉取）；而离线结束双写是 FL-SYNC-027，任务写越权是 FL-SYNC-026。

### 含义

2026-10-26 之前，`src/mobile/MobileApp.tsx` 的 `processNativeQueue()` 与 `sendNativeCommand()` 都不接受取消信号：`suspend` 分支只调 `liveRequest.current?.abort()`，而 drain 循环里每条命令执行完仍会无条件写回 `taskSnapshotRef` 并清掉原生行。同一段代码还在每条 finish 命令之后主动拉一次账本。判断「该不该在后台跑」用的是 `document.visibilityState`，在 Capacitor WebView 与 OEM 前台服务下与真实应用活跃态不一致。修复落在 `src/mobile/ledgerPullPolicy.ts` 的 `shouldDrainNativeCommands()` / `decideMobileLedgerPull()` 与 `MobileApp.tsx` 的 `nativeCommandAbort` / `requestLedgerPull()`。

### 处理步骤

1. 先确认版本：1.6.8 及更早没有这些守卫；1.6.9 及以后进入后台、切账号、忘记配对都会中止在途命令，并且每轮 drain 结束只补一次账本拉取。
2. 复现时看行为而不是看日志：在被 abort 的那一轮里，`setTaskSnapshot` 与 `writeCachedTaskSnapshot` 都不应执行，原生行也不应被清掉（下次前台会重放）；界面不应出现「已提交」提示。
3. 判定口径：同一连接上连续触发前台恢复与命令完成，只应有一次真实 exchange；1500 毫秒内的重复 `foreground` 触发必须被 `fresh` 丢弃，而 `manual`/`retry` 无论何时都必须发起（在途由 coalescer 合并）。对应测试是 `tests/mobileLedgerPullPolicy.test.ts`。
4. 不要用「把 5 秒定时器调成 0」或「在后台强杀进程」来绕：前者把小请求变成密集轮询，后者会丢掉原生队列里的在途项；也不要手改 outbox 或原生 SQLite 表去清残留。

## FL-SYNC-031：手机上设置页说任务已同步，其实那只是本机缓存

### 区分症状

1. 设置页「任务同步」格显示「N 项 / revision R」，但另一台设备刚改过任务，手机上看不到；或者手机刚启动、根本没联网，那格也照样有数。这类现象只在 1.6.8 及更早出现——那一版把缓存快照的条数与 revision 直接当成确认结果显示。
2. 「任务同步」显示已确认、但「账本新鲜度」显示最近刷新失败：这不是矛盾，而是两个域各自的状态；旧版把它们混在一格，用户会以为整机同步失败或整机同步成功。
3. 与 FL-SYNC-026（切换账号后旧任务清单复活）、FL-SYNC-027（同一场专注结束两次后账本对不上）不同：本条没有任何数据错乱，只是界面把「本机有」说成了「云端已确认」，数据本身仍按既有队列规则收敛。

### 含义

设置页的状态格原来只有两域：实时连接与账本新鲜度。「任务同步」格读的是 `src/mobile/cache.ts` 的缓存快照（`taskCount` 与 `revision`），既没有确认时间，也没有失败态，因此无法区分「云端刚确认」和「很久以前存的本机副本」；账本的排队上传、冲突、被拒绝三种失败模式被合并成一个「待上传 N」；第三方投递（滴答清单、番茄 To-do）在移动端没有任何状态。修复落在 `src/mobile/settingsStatusPresentation.ts` 新增的 `presentMobileTaskSync()` / `presentMobileSettingsLedgerQueue()` / `presentMobileThirdPartyDelivery()`，以及 `src/mobile/cache.ts` 的 `readCachedTaskSnapshotConfirmedAt()`。

### 处理步骤

1. 先确认版本：1.6.9 及以后「任务同步」格有三态——未配对显示「未启用」、只有本机缓存显示「N 项（本机）」、云端确认过才显示「N 项已确认 · 最后确认 X 分钟前 · revision R」；1.6.8 及更早没有这个区分。
2. 判断任务域是否真的确认过：看那格是否带「最后确认」时间；只有「N 项（本机）」表示这次清单只在本机，联网后才会被云端确认，此时任务改动仍可能被云端更新的版本覆盖。
3. 「账本待处理」格要把三个数分开读：待上传会自愈（配合 FL-SYNC-029 的退避）；冲突必须由用户在「同步冲突」分区选择（FL-SYNC-028）；被拒绝是服务端拒收，重试无用，要先看拒绝码再改数据。
4. 不要用「多刷几次」让「任务同步」格变成已确认，也不要手改 IndexedDB 里的缓存时间戳：确认时间只由真实响应写入，改时间只会让界面替一个没发生的确认背书；第三方投递在手机上永远是「仅桌面端」，需要在电脑端设置里查看与重试。

## FL-SYNC-032：手机停在专注页没动，任务清单明明没改，云端却每 5 秒收到一次整份下载

### 区分症状

1. 手机安静停在专注页（没有切页、没有改任务），抓包或看服务端日志能看到每 5 秒一次 `GET /sync/v2/tasks`，每次响应都带完整的 `projects`/`tasks` 列表。
2. 手机上任务清单确实没变，但流量与电量花在重复传输上；换成另一台设备改了任务之后，下一次轮询又能正确看到改动——说明不是同步坏了，是**没变的那些轮**也在整份传。
3. 与 FL-SYNC-030（锁屏后通知栏动作还在发包）不同：那条是后台仍被唤醒，本条是前台轮询本身不经济；与 FL-SYNC-029（失败被限流）也不同，本条没有任何失败码。

### 含义

任务快照走的是 `GET /sync/v2/tasks`，客户端 `src/mobile/syncClient.ts` 的 `liveFocusFetch` 固定 `cache:'no-store'`，浏览器 HTTP 缓存不会替我们做条件重验，因此修复必须让请求自己带上「我手上是第几版」：服务端 `cloud/deviceSyncServer.ts` 在响应上给 `ETag`（形如 `"flts1-<revision>-<sched|legacy>-<deviceId>"`）与 `Vary: x-focuslink-task-capabilities`，客户端 `src/mobile/MobileApp.tsx` 把 `etag` 连同所属 `connectionKey` 存起来，下一轮带 `if-none-match`；命中时服务端回 **200 + `snapshot:null` + `unchanged:true`**，客户端只推进确认时间，不重算也不重写缓存。

### 处理步骤

1. 先确认请求头：抓一次 `GET /sync/v2/tasks`，第二次起应当带 `if-none-match: "flts1-…"`；没有这个头就是条件请求没有接上，先看 `MobileApp.tsx` 的 `refreshTasks` 是否还在调无条件版本。
2. 再看响应：命中时是 `200` 且 body 里 `snapshot` 为 `null`、`unchanged` 为 `true`；如果每次都是完整列表，检查 `ETag` 是否随 `revision` 变化（同一 `revision` 必须得到同一个 tag，否则说明服务端把内容又算出了新版本）。
3. 换成另一台设备发布任务后，旧的 `if-none-match` 必须失效并回一次全量：若回到全量但 `revision` 没变，是两个不同内容撞了同一 `revision`，按 FL-SYNC-027 处理数据分叉，不要靠刷缓存掩盖。
4. 不要用「把 5 秒间隔调大」或「关掉任务轮询」来省流量：那会让跨设备改动延迟可见；也不要手改 IndexedDB 里的 `etag` 或 `taskSnapshot`，条件读只认服务端给的 tag。

## FL-SYNC-033：手机放着不动，另一台设备改了任务，要等半分钟左右才出现

### 区分症状

1. 手机停在任务页或专注页，没有触摸、没有切页，另一台设备改完任务后，手机上的清单要过十几秒到半分钟才更新；一旦在手机上动一下（切页、下拉、点任意按钮），清单立刻刷新到最新。
2. 设置页「任务同步」格的时间仍会往前走（条件读命中也会推进确认时间），因此「最后确认 10 秒前」与「清单里没看到刚改的任务」可以同时成立——这不是同步失败，是空闲时轮询被有意放慢。
3. 与 FL-SYNC-032（每 5 秒整份下载）相反：那一条是**太快**且每次都传全量；本条是**变慢**且每次只回 marker。与 FL-SYNC-026 / FL-SYNC-027 的数据错乱无关，本条没有任何数据被覆盖或复活。

### 含义

任务快照的前台轮询在 2026-10-26 之后是自适应的：`src/mobile/taskSnapshotCadence.ts` 给出 `[5s, 5s, 15s, 30s]` 的间隔表，连续多轮条件读命中 `unchanged` 就把间隔放宽到 30 秒，一旦拿到新 `revision` 或发生任何本地写，`advanceMobileTaskSnapshotStreak()` 把 streak 归零、立刻回到 5 秒。改回前台也会清零 streak，所以「刚解锁的手机」不会带着上一段的空闲直接等 30 秒。

### 处理步骤

1. 先确认是不是节奏而不是故障：在手机上切一次页或下拉刷新，若清单立即更新，说明条件读与退避都正常，只是空闲节奏在 30 秒档。
2. 看设置页「任务同步」格：带「最后确认」时间即表示条件读在命中；若长时间「最后确认」不动且有失败提示，按 FL-SYNC-029（失败分类）排查，不要归到本条。
3. 跨设备改动需要「立刻看到」时，用页面切回前台、下拉刷新或任务页的刷新入口触发一次显式刷新——这三条路径都会绕过空闲间隔。
4. 不要为了「更快」把 `MOBILE_TASK_SNAPSHOT_IDLE_DELAYS_MS` 改回固定 5 秒，也不要手改 IndexedDB 里的 `etag` / `taskSnapshot`：前者把空闲耗电打回去，后者会让条件读对齐到一个云端不存在的版本。


### FL-SYNC-034 手机上点了同步，界面像没反应，失败也不知道为什么

- **区分症状**：① 点顶栏同步片后按钮文字仍是「实时状态已连接」，看不出有没有在查；② 设置页「账本新鲜度」格在失败时只说“最近刷新失败”，不说原因，成功率一旦恢复就再也看不到上次为什么失败；③ 手动刷新后重试定时器被清空，回执句子丢失，只能靠猜。
- **含义**：拉取层写好的回执（「正在拉取已结束会话账本…」「云端账本响应异常」」）此前被 `const [, setLedgerNotice]` 丢弃，是死状态；手动刷新只做 `epoch++`，没有任何可见回执。判定要点：顶栏文案在点按期间应变成「检查中」，设置页应出现一条带左边框的回执行；两者都不出现说明回执通道没接上，而不是网络问题。
- **处理步骤**：① 顶栏同步片在已配对时点一次，观察文案是否短暂变成「检查中」并带 `aria-label` 的「正在核对云端账本…」；② 打开设置页，看「账本新鲜度」下方是否出现回执行（动作中偏强调色、失败偏危险色、其余中性）；③ 若一直停在「检查中」超过 20 秒，按 FL-SYNC-029 先看退避与限流，再按 FL-SYNC-032 看条件读；④ 回执行与格子里的时间必须分开读：格子回答“最后一次确认是什么时候”，回执行回答“这一次在做什么/为什么失败”。
- **禁止**：不要把回执文案写回 `presentMobileLedgerFreshness` 的 `detail`——那里是时间域，混进去会让“最后成功 X 分钟前”变成半句网络错误；也不要恢复 `const [, setLedgerNotice]` 的丢弃写法。

## FL-SYNC-035：本机省流明明有效，装到手机连生产云端却每 5 秒整份下载任务清单

### 区分症状

1. 开发机上用本地测试后端（`tests/taskSnapshotCloud.test.ts`、`npm run dev:cloud`）跑条件读，命中时只回几十字节 marker；换到手机连官方云端，抓包或看日志发现每次 `GET /sync/v2/tasks` 都是整份任务清单。
2. 浏览器/WebView 控制台出现预检失败（`Request header field if-none-match is not allowed by Access-Control-Allow-Headers`），或请求发出去了但客户端 `response.headers.get('etag')` 一直是 `null`。
3. 手机上「任务同步」的「最后确认」时间照常前进，因此看起来「同步正常」，只是流量与耗电没降下来——这和 FL-SYNC-032（每 5 秒整份下载）表现一致，但原因在生产服务端而不在客户端节奏。

### 含义

条件读要三段同时成立才算省流：① 生产 Account DO 认 `If-None-Match` 并回 `unchanged` marker（`cloudflare/accountDurableObject.ts:636-652`）；② Worker/gateway 预检允许 `if-none-match`，响应暴露 `etag`；③ 客户端拿到可读 ETag 或已验证的 unchanged marker。没有 validator 能力证据时客户端使用普通 GET，并根据实际相同 revision/正文降频，不能猜一个 tag 来触发下一次不被允许的预检。

### 处理步骤

1. 先用行为测试确认转发与暴露：`npx vitest run tests/cloudflareWorkerRouting.test.ts tests/taskSnapshotConditionalRead.test.ts`——前者断言带 `if-none-match` 的 `GET /sync/v2/tasks` 透传到 DO、响应 `access-control-expose-headers` 为 `etag`；后者断言两个后端共用同一判定。
2. 线上排查顺序固定为「预检 → 响应头 → DO 行为」：先看 `OPTIONS /sync/v2/tasks` 的 `access-control-allow-headers` 是否含 `if-none-match`；再看实际 GET 响应是否有 `access-control-expose-headers: etag` 与 `ETag`；最后确认响应体是否出现 `unchanged: true`。
3. 客户端兼容路径：全量响应没有可读 ETag 时不发送 `If-None-Match`。先前的 validator 遇到 transport/CORS 错误时可降级一次普通只读 GET，并清除无法确认能力的 tag；鉴权拒绝或其他 HTTP 结果不能降级重试。要获得真正的条件响应省流，仍需部署完整 gateway/Worker/DO 实现。
4. 不要为了省事把条件读改回「固定 30 秒全量」：那会把跨设备可见延迟从秒级拉到半分钟（见 FL-SYNC-033），且流量并未下降。

### 补充（2026-10-26 晚）：个人云 gateway 那一跳

手机装的是 1.6.x，拨到的生产入口是 `CANONICAL_SYNC_ORIGIN`（`android/app/build.gradle:46`），它指向 `cloud/mcp/src/exchange.ts` 这一层 gateway，与上面「Worker → Account DO」不是同一跳。该层同样要三件齐：转发 `if-none-match`、把上游 `ETag` 写回重建的响应、预检允许 `if-none-match` 且 `access-control-expose-headers` 暴露 `etag`。缺任何一件，手机上仍然每 5 秒整份下载，而 `npm test` 全绿。核对入口：`npx vitest run tests/exchange.test.ts`（`cloud/mcp` 目录）里的 `carries the task conditional read across the canonical hop`。

### 线上复核（2026-10-27）

本轮从 Windows 对官方域与 canonical Worker 分别发起带 `Origin: https://localhost` 的任务预检，均返回 HTTP 204；`access-control-allow-headers` 仍只有 `authorization, content-type, x-focuslink-task-capabilities`，没有 `if-none-match`，也没有 expose 头。两个域的只读 health 均返回 HTTP 200，匿名 status 均返回 HTTP 401。前者证明传输可达，后者仅证明鉴权边界存在，不能据此认定小米设备凭据有效。

2026-10-26 的 gateway/Worker/DO 源码与本地测试记录继续保留；2026-10-27 实际响应说明线上尚不能按新条件读合同验收。本轮客户端兼容修复不等于服务器已经部署。用手机的真实 WebView origin 重测预检、认证 GET 与 unchanged marker，三项通过后才记录生产省流通过；不要把请求头禁用误报为用户未联网。

## FL-SYNC-036：本机会话仍在，却无法开始或控制；新建任务一直等网络

### 区分症状

1. 本机 IndexedDB 有活动 runtime，云端/原生凭据恢复后 `liveSnapshot` 却为 null；界面只见连接中，开始按钮禁用，也没有暂停、继续或结束本机专注的入口。
2. 创建任务先等待云端整份任务读取和发布，网络不通时保存迟迟不返回；操作回执若再被 `sr-only` 或裁切规则隐藏，普通用户无法知道失败原因。
3. 小米原生状态能返回 `xiaomi-island`、协议版本与厂商权限，但 `canPostNotification=false`；协议被选中不能证明系统已展示超级岛。

### 处理步骤

1. 先只读本机 runtime 与当前渲染 props；不要清除应用数据、离线草稿或凭据来让按钮恢复。保留两者的时间戳，以本机 runtime 投影本机活动态；本机恢复完成前禁止新建第二份会话。
2. 先验收不联网的开始、重开恢复、暂停、继续、结束与账本耐久保存，再单独核对设备认证与云端 live。真实远端活动态不能在网络失败时偷偷变成本机计时。
3. 新建任务只等 IndexedDB intent 提交，立即出现在目标清单并显示等待云端确认。补传复用稳定 task id、operationId 和已固化 CAS base；明确冲突后才换 base 与操作身份，匹配回执后才删队列。
4. 任务补传只在前台在线时执行；限流和临时失败退避，鉴权失效停止盲重试并保留任务。手动重试只更新投递字段，不能用旧 UI 状态覆盖已固化正文或 CAS base；旧操作的回执不能清除新操作。
5. 同步分开验收：传输 → 设备鉴权 → 任务确认 → 已结束账本 → 在线实时控制 → 第三方投递。OAuth 只读成功、已配对、系统通知显示均不能相互替代。
6. 小米系统表面先读通知权限，再实测运行、暂停、继续和结束。网页预览的胶囊始终标为示意；通知权限未授予或没有实际可见结果时，不写“超级岛已完成”。

### 当前边界

本轮源码支持本机新建任务与待确认任务的本机专注；待确认任务的完成、移动和清单管理仍需云端确认，尚未实现完整离线任务编辑。2026-10-27 后续无线 ADB 连接超时且设备列表为空，原生系统表面与新版安装尚未通过；用户明确本轮仅验收 Windows＋小米，华为暂不安装。
