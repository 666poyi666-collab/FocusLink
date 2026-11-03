# FocusLink 后端与共享契约规范

> 状态：v1.x 后端单一真相；当前源码基线 v1.9.3。移动端本机可用性修复自 v1.7.4 起已随版本安装；Electron 主进程、IPC 与云端 wire shape 保持现有边界。
>
> 边界：Electron 主进程持有计时、持久化、外部服务和窗口事实；renderer 只能通过 preload API 请求能力。

## 移动端本机可用性合同（2026-10-27，待实装）

- IndexedDB 的活动本机草稿是本轮本机计时权威。原生凭据恢复、云端缓存清理和连接重试不能把本机会话显示为空闲；`resolveMobileDisplaySnapshot` 在本机 runtime 存在时始终由它投影，结束耐久提交前不移除草稿。启动恢复未完成时禁止新建第二份活动态。
- 移动端新建任务先向同一 IndexedDB 的 `meta/localTaskCreates.v1` 写入持久 intent，然后立即返回 UI。intent 含稳定 task id、operationId、scope、创建时间、CAS base、尝试次数和重试时间；不保存凭据。原有清缓存不能删除此队列，有待同步任务时禁止退出设备同步。
- 本机 pending 是叠加到远端快照上的 UI 投影，不能伪造 authority revision 或把本机保存时间当成云端确认。尚未配对的 intent 只在当前账号完成一次可信读取后原子绑定该 scope，其他账号的 intent 不读取、不上传、不覆盖。
- 任务投递复用既有 `create_task + taskId` mutation，读取当前 revision 后先固化操作身份再发送。响应丢失保留原 operationId、base 与正文；只有明确 409 才可读取新 base 并生成新的 operationId。applied/duplicate 且回执身份匹配后才清除 intent。
- 自动任务补传只在 renderer 前台且在线时运行，后台 abort，账号变更继承请求 lease 与提交闸门。网络/服务错误指数退避并按 task id 分散，设计上限 15 分钟；401/403 和确定性拒绝保留记录并停止盲重试，用户显式重试可重新安排。
- 条件读取只有在服务端明确返回可读 ETag 或已验证的 unchanged marker 时才继续发送 validator。全量响应没有可读 ETag 时使用普通 GET；相同 revision/正文可用于客户端降频。旧 validator 出现 transport/CORS 失败时只降级一次普通只读 GET，401/403 和其他 HTTP 权威结果不得被降级或备用域掩盖。
- HTML 视觉实验与真实客户端隔离；其中的任务、统计与系统岛均为设计夹具，不能进入生产空态、authority 或设备能力声明。

## v1.6.2 本地任务与实时控制响应合同

- `tasks:refresh({localOnly:true})` 只读本地任务与清单，不访问云端、不探测 CLI、不发布快照。renderer 共享已加载状态（含空集合）、本地读请求和 30 秒后台刷新窗口；新本地读取/`tasks:changed` 使旧刷新结果失效，后台失败不会清空本地数据。
- 本地任务 mutation 在 SQLite 保存后调用 `queueLocalTaskWorkspace()`：`publishDeviceTaskSnapshot()` 先同步写入既有 durable pending，再在后台发送；IPC 返回不等待网络。`tasks:changed` 广播最新本地工作区给所有 renderer。外部任务完成仍等待原 Provider；清单删除仍按原有确认/回滚路径执行。
- `timer:command-pending` 为快捷键的暂态反馈，不是计时事实。日志只有在异步 handler 完成后才写 `trigger handled`；拒绝时记录失败并推送错误提示。
- 实时命令以 generation/session/action/task/segment 识别在途请求；同一意图共用 Promise，不同意图明确拒绝而不是叠发同 revision。普通请求预算 4 秒，long-poll 保留 `LIVE_FOCUS_MAX_WAIT_MS + 5 秒`，重试复用同 commandId 和截止信号。
- finish/abort 的 authority ACK 先发布真实 idle/`ledgerImportPending`；账本导入异步执行。导入和 finished 收束必须校验连接、generation、revision 与当前状态，不能覆盖新的活动会话。网络中断不把已确认的远端活动会话偷偷转换为本机计时。

## 本地自动化接口（2026-11-02 方案，v1.9.3 已实装）

**结论**

以现有 Electron 回环业务 API 为基础，交付 `focuslink` CLI 和本地 HTTP 接口，让其他项目与 AI 读取、补录、修正专注并显式同步到番茄 To-do；人工与 AI 共享业务入口、版本校验和界面通知。方案状态：已完成；实现状态：v1.9.3 已实装（见本节末「已实装边界」）。

**事实**

| 序号 | 事实 | 证据位置 | 证据类型 |
| --- | --- | --- | --- |
| ① | 已有回环 HTTP 服务、凭据校验、会话读取和计时控制路由 | `FocusLink/electron/mcp/businessApi.ts:133` | 证据记录 |
| ② | 现有 API 控制版本按计时状态与会话身份变化；控制完成后另写幂等回执，串行队列位于 HTTP 层 | `FocusLink/electron/mcp/businessApi.ts:152` | 证据记录 |
| ③ | 现有 CLI 分发时间、清单与任务命令，客户端使用云端任务合同 | `FocusLink/scripts/cli/focuslink-cli.ts:133` | 证据记录 |
| ④ | 人工计时 IPC 直接调用控制器，主窗与小窗消费同一快照广播 | `FocusLink/electron/ipc.ts:140`、`FocusLink/electron/main.ts:1118` | 证据记录 |
| ⑤ | 番茄已有会话级同步与操作锁，可复用适配器和稳定 marker | `FocusLink/electron/sync/tomatodoSyncService.ts:512`、`FocusLink/shared/tomatodoPolicy.ts:315` | 证据记录 |
| ⑥ | 已结束账本的变更已有 correction 与 Outbox 路径 | `FocusLink/electron/sync/deviceSyncV2Service.ts:541` | 证据记录 |
| ⑦ | 历史故障规范分别记录批准闸门、投递节流、云回读与远端删除边界 | `FocusLink/backend-design/SYNC_TROUBLESHOOTING.md:426`、`FocusLink/backend-design/SYNC_TROUBLESHOOTING.md:485`、`FocusLink/backend-design/SYNC_TROUBLESHOOTING.md:514` | 证据记录 |
| ⑧ | 当前实施日志记录移动工作台与离线动作现状；本轮只核对记录，未复跑设备或第三方同步 | `FocusLink/backend-design/IMPLEMENTATION_LOG.md:4` | 证据记录 |

**问题**

P0 无本轮实测事故 — 当前工作仅编写方案，以下是落地前必须解决的设计约束 — 证据①至⑧。

P1 写入口一致性 — 只扩充 HTTP 层无法覆盖人工入口和异步导入，必须下沉并发控制及提交通知 — 证据②④⑥。

P1 专注命令合同 — 现有 CLI 路由尚未覆盖目标操作，需要补齐补录、修正、同步及结果查询 — 证据①③⑤。

P2 第三方确认能力 — 客户端回执不足以证明手机可见，API 必须返回分阶段状态和能力限制 — 证据⑦。

**改动**

本轮文档改动：本节记录方案。v1.9.3 的源码改动见本节末「已实装边界」；该小节之外仍属拟实施或尚未开放的能力。

**交付范围与调用方式**

首轮完成本地读取、历史补录、历史修正、计时控制、番茄预览与显式同步、操作查询。删除、任意 SQL、通用脚本执行和自动扫描全部历史后上传不纳入首轮能力。

调用链固定为：`AI / 其他项目 → CLI 或 HTTP → Electron 业务服务 → 计时控制器 / SQLite / 既有同步队列`。界面按钮、快捷键、托盘与小窗也进入同一业务服务；CLI、MCP 和运维脚本不直接打开生产 SQLite，不维护第二套专注账本。

扩展 `electron/mcp/businessApi.ts` 已有回环 listener，沿用端口 `18770`，该值来自现有 `PORT` 常量；新增自动化路由命名空间 `/automation/v1`，保留既有 `/v1` 兼容入口。它是业务 API，不是另起一个设备同步 authority。新旧路由最终必须调用同一服务。

CLI 扩展既有 `scripts/cli/focuslink-cli.*`，保留原来的云端任务命令；新增 `focus`、`records`、`tomatodo` 命令只访问本地。连接失败明确返回 `APP_NOT_RUNNING` 或 `LOCAL_API_UNAVAILABLE`，不静默切换到云端。应用退到托盘仍可服务，完全退出后本地接口不可用。

安装包附带预打包 CLI 客户端和 `focuslink` 启动入口，从任意项目目录可调用，不依赖源码目录、`tsx` 或现场构建。主进程保持唯一数据拥有者，不通过启动第二个 Electron profile 执行业务。CLI 冷启动开销另行验收。

交互参考[滴答 CLI 说明](https://help.dida365.com/articles/7464976698707017728)和仓库既有 dida Provider 的命令调用方式；以下命令及 `schema`、`doctor`、JSON 合同是本方案拟定的 FocusLink 能力。

```text
focuslink status --json
focuslink focus current --json
focuslink records list --date today --timezone Asia/Shanghai --json
focuslink records get <session-id> --json
focuslink records create --input-file <record.json> --operation-id <stable-id> --json
focuslink records update <session-id> --input-file <patch.json> --if-version <record-version> --operation-id <stable-id> --json
focuslink focus pause --session <session-id> --if-version <control-version> --operation-id <stable-id> --json
focuslink tomatodo preview --session <session-id> --json
focuslink tomatodo sync --plan <plan-id> --operation-id <stable-id> --json
focuslink operations get <operation-id> --json
focuslink schema --json
focuslink doctor --json
```

计时控制还包括明确的 `start`、`resume`、`finish`、`abort` 与任务关联命令，禁止把 `toggle` 暴露成可重试的自动化命令。中文与多行正文走 UTF-8 文件或 stdin；程序调用使用参数数组。按标题查找出现多个候选时返回候选 ID，不猜测目标。

**统一的读写合同**

- 读取覆盖当前运行/暂停状态、默认任务及片段覆盖、三项累计、会话/片段/暂停明细、按日期与任务汇总、各同步域状态；状态附 `observedAt`、数据来源和新鲜度。
- 当前会话使用控制器与 `liveSessionProjection`；历史和统计复用共享查询/selector，按会话 ID 去重。日期以 IANA 时区计算边界，列表分页，汇总不受列表页长或固定条数截断。
- 自动化返回字段使用明确白名单；默认不含备注、标签、设备标识、凭据、数据库路径及本地诊断正文。`doctor` 只输出脱敏能力与稳定错误码。

`records create` 是补录已结束历史，输入必须包含带偏移的开始/结束时刻及专注/暂停时间线，或明确的无暂停连续区间；服务器计算毫秒累计并校验边界、非重叠与三时间守恒。缺失或矛盾的时间不能由 AI 默补，跨会话重叠返回 `OVERLAPPING_RECORD` 及候选摘要，不静默去重或合并。

`records update` 使用字段级 patch：缺省表示不改，显式 `null` 表示清空；metadata 与时间线修正分开。metadata 允许标题、任务关联、学科与经明确指定的番茄标题；时间修正必须携带原因和完整受影响时间线，服务端重算累计，复用 `focus_ledger_correction_v2`，保留原始账本及修正链。进行中的会话只允许计时控制和既有任务关联，不接受历史时间覆盖。

学科与番茄标题先按当前会话级本机字段保存；现有跨设备白名单未携带这些会话字段，首轮不得宣称它们已跨设备同步。读取与显示共同消费应用 correction 后的有效账本，原始记录仅用于追溯，避免界面和接口各读一套数值。

默认任务与片段覆盖按现有三态合同解释，接口不能用修改默认任务悄悄覆盖已单独关联的片段。会话与片段批量关联需要一个服务事务，返回精确影响范围。

`GET /automation/v1/state`、`/records`、`/records/{id}`、`/summary`、`/capabilities` 提供读取；`POST /automation/v1/commands` 接受类型化命令，`GET /automation/v1/operations/{id}` 查询结果，`GET /automation/v1/events` 提供认证变化流。`schema` 由 `shared/` 合同生成，CLI 和后续 MCP 不另写字段语义。

每条写命令包含 `operationId`、目标 ID、预期版本、必要的预期状态及有效期；`sourceClient` 是审计标签，不是权限证明。时间控制还绑定当前会话身份，避免旧“暂停”请求作用到后来开始的新会话。新建通过持久化 operation 预留稳定 session ID；重试沿用原 ID、原正文和原版本。

返回区分 `applied`、`duplicate`、`accepted`、`conflict`、`rejected`。`accepted` 仅表示操作已耐久登记，不能当成计时或第三方同步完成。写响应包含操作身份、目标 ID、新版本与必要的规范化回读；错误含稳定 `code`、`retryable` 及安全的当前版本，HTTP 状态与 CLI 退出码都须稳定并写入 schema。

**人工与 AI 并发、重试与崩溃恢复**

- 业务服务按计时域、会话实体和 provider 操作建立共享调度；所有人工入口、API、旧脚本与云端导入均参加，不能只锁 HTTP 请求。冲突域外的历史编辑不阻塞当前专注。
- 本地实体使用独立单调 `recordVersion`，计时使用包含会话身份、控制修订和连接代际的 `controlVersion`；版本在业务变更时推进，每秒累计显示不推进。不能把现有状态/会话版本当成完整编辑版本。
- 所有写入在共享调度内重核预期版本；同一旧版本的人工与 AI 写入最多一项成功，另一项返回冲突和最新状态。禁止读取最新版本后自动覆盖或把冲突当网络错误盲重试。
- 已接入云端 live 的命令必须携带与本次观测对应的 authority revision，并由 Account DO 再做 CAS；本地锁不能替代跨设备 CAS。异步返回前复核连接代际和目标身份，旧账号结果不能进入新账号。

本地修改、版本、脱敏审计、幂等回执与同步 Outbox 在同一 SQLite 事务落盘，事务中不调用网络或番茄桥。同一 `operationId + 正文摘要` 重放返回原结果；同 ID 异文拒绝。连接 scope 纳入操作身份，重启保留回执，过期清理后旧 ID 也不得重新执行，可保留压缩拒重 tombstone。

云端 live 与第三方调用不能与 SQLite 跨系统原子提交。执行前先持久化 pending 操作及原 command ID/版本/正文；响应丢失先查操作状态或按原 ID 重放，不能换 ID 重做。处于未知结果时如实返回 `accepted` 或待核对状态，并通过原始事实恢复，不承诺第三方不具备的全链路 exactly-once。

**显示一致性与人工编辑保护**

事务提交后发布带单调 `changeSeq`、实体 ID、版本和变更域的事件；同一业务变化同时通知主窗、固定两态小窗、历史、统计与外部订阅者。计时仍复用现有快照广播，历史变更不伪造计时状态切换，也不靠切页或重启刷新。

renderer 按实体版本与请求代际接收结果，迟到的旧查询不能覆盖新事件或刚提交的数据。界面编辑表单保存其打开时版本和未提交字段；AI 更新同一记录时保留用户输入并显示“记录已更新”，保存发生冲突后给出差异，不自动清空输入或强制覆盖。

事件和提交序号耐久关联；订阅断开、事件超出保留窗口或 renderer 重建时，使用变化序号重新获取一致快照。外部变化流支持游标续读和 `resync-required`，不会把未收到事件误判为数据未变。网络同步、番茄上传失败不回滚已成功的本机修改。

例：AI 读取运行中的会话后，用户已经点暂停；AI 再发旧版本的暂停必须冲突并返回当前暂停快照。用户正在编辑记录标题时，AI 补改学科可以提交新版本，但界面保留标题草稿，用户保存前必须确认它基于哪个版本。

**番茄 To-do 的批准、版本绑定和真实结果**

补录或修改专注默认只改 FocusLink；番茄上传通过独立 `preview → sync` 命令显式触发。预览不写业务数据、不启动外部应用，生成的计划绑定会话 ID、记录版本、实际学科/标题、开始时间、取整分钟、payload 摘要及有效期；同步时计划过期或数据已变即返回 `PLAN_STALE`。

保留“批准后同步”。调用方已有 `tomatodo:write` 权限且用户明确要求同步指定记录/范围时，该次意图即可进入执行，不增加机械的人工点击；普通读写权限或 `approved:true` 字段不能替代授权。自定义番茄标题仅在用户明确指定时使用，默认名称为学科名。未批准记录不能被后台任务或云端 provider 意图绕过闸门。

复用现有会话 marker `[FocusLink:tomatodo:session:<id>]`、桥身份校验及服务级锁。一次会话对应一条番茄记录；时长按 `tomatodoRecordMinutes(activeElapsedMs)` 取整，投影结束时间由开始时间加取整后的有效时长计算，保持 FocusLink 原始暂停与自然跨度不变。

durable 投递项从仅会话 ID 扩展为带会话版本、payload 摘要、批准范围、原因、lease、阶段回执与下次重试时间的结构；历史 ID 列表兼容读取为“等待同步确认”，不能据此补造批准。人工同步、CLI 与后台重试共用此投递账本，避免独立上传队列互相覆盖。

修改发生在排队时，旧计划失效；发生在已发出的上传期间，保留旧回执所属版本，新版本保持未上传，旧回执不能清除新 pending。未经新内容授权不补传更改后的正文；外部已接收的旧内容不能假装撤回。标题、时间和时长更新须先验证桥实际支持的字段；不支持就返回 `UPDATE_UNSUPPORTED`，不能靠删除重建掩盖。

结果分别返回 `localCommitted`、`focuslinkCloudState`、`tomatodoLocalWritten`、`uploadConfirmed`、`phoneDeliveryState` 与 `remoteReadbackSupported`；未知手机可见性返回 `unknown`，不以 `isSynced` 推断。若当前 durable 数据不能区分原因，继续显示“等待同步确认”。没有远端删除能力时 `remoteDeleteSupported=false`，清理始终标记 `local-record-only`。

投递策略以 `FL-SYNC-024` 的较新证据为准：逐条串行，初始间隔不少于 `30 秒`，该值取自该故障条目的历史实证；可根据后续真实验收调整，不能声称此间隔保证送达。不得只依据旧 `FL-SYNC-009` 的批次建议并行上传。超过历史记录窗口的项停止自动重试并解释原因，不修改日期换取成功。

客户端已运行但无可信桥时返回 `restart-required`，不终止用户进程。用户显式同步并允许启动时才使用现有受控启动路径；后台重试绝不启动番茄。必须先通过标题与所需 `electronAPI` 方法校验，手机直连能力缺失与桥身份失败分别报告。

**本地权限与未来云端衔接**

接口仅绑定回环；本地自动化凭据与云端 device/OAuth token 分离，按 `focus:read`、`focus:control`、`records:write`、`tomatodo:write` 授权并可撤销。安装时提供当前用户可用的受保护发现配置，CLI 自动解析，避免向 AI 对话或命令行参数粘贴密钥；旧 MCP 凭据按兼容路径保留，迁移不静默轮换。

HTTP 严格检查 Host、认证、JSON 字段与大小，不接受任意来源网页调用、不启用通配 CORS；发现配置及 token 文件需验证当前用户与文件身份。只读 token 不得控制计时、补录或同步番茄。诊断与审计不保存原始正文或凭据。

本地稳定后扩展既有 `mcp/foxlink_mcp` 作为薄适配层，不另建业务实现；新工具可使用 FocusLink 正式命名，保留旧 Foxlink 别名。后续云端 MCP 继续访问现有 Account DO 权威合同，不直接暴露本机端口或另外建设身份源。

云端读取标明最后确认时间；云端专注写能力单独设计 scope 与 CAS。需要番茄桌面桥的远程操作以绑定记录版本的 durable intent 等待获授权的 Windows 消费；电脑离线时显示待执行，电脑关机不代表番茄已同步。不得沿用本机隧道而声称离线也可完成本机操作。

**实施顺序与验收门槛**

先实现共享命令合同、并发调度、版本和提交事件，将人工计时/历史操作与云端导入接入；再开放读取、历史补录与 correction；随后接 CLI、番茄投递与操作查询；最后完成安装版的开箱接入和人工/AI 同时使用的真实验收。本地验收完成后再排云端 MCP 写能力，不与首轮混交付。

新增 `shared/automation/` 合同与 `electron/automation/` 业务服务，并扩展既有 API、控制器、数据库迁移、番茄服务与 CLI（实际文件名见本节末「已实装边界」）。renderer 仅消费提交事件和展示冲突。旧运维写脚本改为调用同一入口，禁止保留绕过服务的生产写路径。

以下性能均为设计目标，尚未实测：同机应用已运行、历史数据本机就绪、无外部网络等待时，HTTP 读取 p95 不超过 `200 毫秒`，本地补录/编辑耐久回执 p95 不超过 `300 毫秒`，事务提交到已打开相关界面呈现 p95 不超过 `500 毫秒`；每类至少采样 `30 次`，以单调时钟计时并按 nearest-rank 计算 p95。CLI 从进程启动到 JSON 读结果 p95 不超过 `1000 毫秒`，单独计入进程启动开销。外部上传返回耐久操作身份，后续状态轮询不阻塞界面；不能把 accepted 计入上传完成延迟。

验收必须包括：

- 同一版本的人工/AI 并发修改与暂停/继续/结束；不同会话的独立操作；旧会话命令到达新会话；多显示面同一版本收敛；未保存表单不丢输入。
- 同 ID 同文重放、同 ID 异文拒绝、请求丢失、事务边界崩溃、重启查询、幂等保留期后的拒重，以及 API/IPC/快捷键/后台导入无法绕开版本闸门。
- 无暂停补录、多段暂停时间线、时间矛盾、跨日/时区、同名任务与重叠记录；correction、三时间、汇总和分页与人工界面使用相同结果。
- 番茄未运行/无桥/身份不符、未批准、超窗、节流、旧回执、新版本修改、重复 marker 与更新字段能力；手机可见性另行提供真实证据。
- 普通网页、只读 token、非法字段、错误账号代际与过期计划拒绝；端口被占、应用退出时给出可操作错误，不连接到身份不符的本地服务。

上述验收项在 v1.9.3 的首轮实装中只覆盖本机可自动断言的部分（见下）；真实番茄临时数据、人工/AI 同时操作的手工矩阵与安装回读按 `TEST_AND_RELEASE.md` 单独执行，未执行的项目不得写成已通过。设备范围按当轮有效用户指令核对：2026-10-29 起华为平板不在线，门禁只要求 Windows + 指定小米手机同版。

### 已实装边界（v1.9.3）

- 合同：`shared/automation/contract.ts`（命令、结果、错误码与 HTTP/CLI 映射、读取视图白名单、schema 生成）、`shared/automation/timeline.ts`（时间线校验、三时间守恒、controlVersion 编码、番茄计划规范正文）。
- 服务：`electron/automation/` 下的 `service.ts`（读改写与命令分发）、`store.ts`（操作账本、实体版本、提交事件、番茄计划、修正审计）、`recordRepository.ts`（同一批 `focus_*` 表的裸写，事务由 store 统一开启）、`scheduler.ts`（按域的共享调度）、`auth.ts`（分 scope 凭据与发现配置）、`http.ts`（`/automation/v1` 路由）。
- 端口与命名空间：沿用 `127.0.0.1:18770`（`AUTOMATION_LISTEN_PORT` 为唯一数值来源）；新增 `/automation/v1`，原有 `/v1` 保持兼容，两者共用同一 listener 与同一业务服务。
- 计时域调度：自动化控制命令在 `runExclusive('timer')` 内执行并前后各校验一次 `controlVersion` 与后置状态；人工入口（按钮/快捷键/托盘）继续走 `FocusTimerController` 既有的 `pendingCommand` 串行闸门。两者叠加后的实际语义是「同一时刻只有一个控制意图被接受」，但版本校验与执行之间存在一个同步调用窗口，跨窗口的竞态由后置条件判为 `STATE_CONFLICT`，不会被记成 applied。
- 版本：`recordVersion` 按 `(连接 scope, session, id)` 单调存储于 `automation_entity_versions`，只在业务变更时推进；`controlVersion` = `会话 id:控制修订:连接代际`，每秒累计显示不推进。连接 scope 参与操作身份，切换账号后同一 operationId 会返回 `CONNECTION_CHANGED`。
- 幂等：`automation_operations` 先写 `accepted` 预留，事务内改为终态；同 ID 同文重放返回原结果并标 `duplicate`，同 ID 异文拒绝；保留期过后只清空结果正文并保留拒重 tombstone，旧 ID 只能得到 `OPERATION_EXPIRED`。
- 中止：本机模式没有独立中止出口，`focus.abort` = 结束计时 + 账本状态置为 `aborted`；实时模式走控制器新增的 `abortActive()` 下发真正的 abort。
- 番茄：`preview` 生成绑定会话版本与 payload 摘要的计划（TTL 5 分钟，持久化），`sync` 重新计算摘要，记录或版本变化即 `PLAN_STALE`；结果按 `localCommitted / focuslinkCloudState / tomatodoLocalWritten / uploadConfirmed / phoneDeliveryState / remoteReadbackSupported` 分阶段返回，`focuslinkCloudState` 在本轮缺省为 `unknown`（尚未接 V2 Outbox 投影）。
- 凭据：`business-api-tokens.json` 提供具名 token 与 `focus:read|focus:control|records:write|tomatodo:write`；旧 `business-api-token` 按兼容路径保留并默认拥有四个 scope，不静默轮换。发现配置 `automation-discovery.json` 只写端口与凭据文件位置，CLI 自行读取，密钥不出现在命令行。
- 未开放：删除、任意 SQL、通用脚本执行、批量扫描历史后上传、远端番茄记录删除与回读；`records.update` 拒绝对进行中的会话做时间覆盖。

### `/v1` 写接口（v1.10.2，外部助手免点界面）

只读的 `/v1` 此前没有会话字段写入口，外部助手要改标题、归类或关联任务只能点界面。v1.10.2 起在同一个回环端口补上写入口；它们只做输入翻译，最终调用既有的 `records.update` / `records.create` 命令，因此版本冲突、幂等回执、修正审计与界面刷新复用同一条管线，没有第二条写库路径。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| PATCH | `/v1/sessions/:id` | 改标题、备注、学科、番茄记录名、任务关联、无暂停会话的整场分钟数 |
| POST / DELETE | `/v1/sessions/:id/task` | 关联 / 取消关联任务（等价于 `defaultTask`） |
| GET | `/v1/tasks?q=&projectId=&status=&limit=` | 查本机任务缓存与所属清单名 |
| POST | `/v1/sessions` | 补录一次已结束专注（单段 focus） |
| POST | `/v1/sessions/batch-update` | 多条会话同一补丁；`atomic=true` 只在首个失败处停止 |

写入口要求 `records:write` scope（`business-api-tokens.json` 的 `local-default` 已含四个 scope）。前置条件支持 `If-Match: <recordVersion>`（接受 `"3"`、`W/"3"`，不接受 `*`）、正文 `expectedRecordVersion` 或 `expectedUpdatedAt`；请求头与正文同时出现且不一致返回 `400 INVALID_ARGUMENT`，与当前版本不一致返回 `409 VERSION_CONFLICT`，`expectedUpdatedAt` 不一致返回 `409 STALE_UPDATED_AT`。`operationId` 或 `Idempotency-Key` 头用于幂等重放，请求体里的 `operationId` 优先。

幂等语义：同一个 `operationId` + 同一请求正文先查已确认回执，命中直接返回原确认并带 `duplicate: true`，不重新做版本校验、不再写库；同 ID 换正文返回 `422 OPERATION_ID_REUSED`。因此「首次成功、版本推进后原样重放」必须返回首次结果（v1.10.3 起，FL-SYNC-038）。

字段语义：`title` 是会话标题；`tomatodoRecordName` 是番茄记录名（界面里的「番茄标题」）；`tomatodoSubject` 只能是七个学科之一或 `null`；`minutes` 只在会话没有暂停时接受，有暂停必须用 `/automation/v1/commands` 的 `records.update` + 完整 `timeline`，否则会把暂停算进有效时长（FL-SYNC-020 口径）。

返回体是紧凑会话摘要：`id / title / note / status / startedAt / endedAt / activeMinutes / defaultTask / tomatodoSubject / tomatodoRecordName / updatedAt / recordVersion`；`GET /v1/tasks` 返回 `id / externalId / title / projectId / projectName / status / source / tags / dueDate`。

批量入口不是数据库事务：逐条执行并逐条返回结果，响应固定 `atomic: false`。`atomic: true` 会在写入前被拒绝（`422 ATOMIC_NOT_SUPPORTED`），不会先写一部分再解释；`If-Match` 也不接受批量请求，需要条件写时逐条调用。需要全有全无时当前没有入口，逐条补偿不等价于数据库回滚。

2026-11-03 的隔离路由验收曾在 v1.10.2 发现 `If-Match` 未读取与成功请求重放冲突（FL-SYNC-038）；v1.10.3 已改为「重放判定先于 CAS」并补 9 个路由级用例，装机版另以陈旧 `If-Match` 只读验证返回 409。

## 当前三端同步修复需求（2026-07-22）

- 修复手机与平板在已配置连接后仍报告“同步中断 / 重试失败”的问题；必须分别验证实时控制长轮询与已结束账本同步，不能用其中一条链路成功代替另一条。
- 桌面、Web/PWA 与 Android 继续共享协议、幂等 command id、revision 冲突处理和 completed ledger；移动 renderer 不复制 Electron 业务服务。
- 移动端覆盖安装必须保留兼容的 endpoint、token 选择与本地账本缓存；协议或缓存升级只能做显式兼容迁移，不能靠清除应用数据恢复。
- Android 原生 Keystore 连接与 WebView 偏好必须执行同一旧默认端口迁移；WebView 会话令牌被系统回收不得隐式清空仍服务于活动通知的原生连接。
- 历史 v0.12.53 完成过 Windows 覆盖安装与双 Android 真实联调；当前生产入口已收口为 canonical `foxlink-cloud-mcp` HTTPS origin。本机 Node 服务只允许回环合同测试，Node/Docker production authority 已硬退役。
- v0.12.60 在 v1 实时控制面之外增加 Sync v2：三类实体独立 revision；SQLite/IndexedDB 租约 Outbox、base snapshot、显式 epoch、设备水位、tombstone/graveyard 和冲突中心共同保证本地修改不会被静默覆盖。

## Sync v2 不变量

- Account Durable Object 是唯一账户 authority；Windows、手机和平板都直接访问云端，Electron 不运行内嵌同步服务，不维护 ADB reverse，也不自动配对 Android。
- `focus_ledger_correction_v2` 的 logical identity、payload 时间戳与 opId 必须跨同步轮次稳定。历史缺陷修复只处理无 base 的 correction revision conflict；操作历史保留，真实 conflict 不自动关闭。
- 移动 App 打开并在线时立即拉取账本、任务与 live，并在前台长轮询。被系统结束后不终止云端 live，也不将缓存当成本地计时 authority；重新打开后从 Account DO 收敛。
- 离线移动会话只作为本机临时账本，完成后持久排队。联网时若存在不同 cloud live，状态固定为 `forked-local`，不得自动覆盖或合并。
- ChatGPT MCP 的状态、今日明细和记录列表直接读取私有 Account DO 记录 DTO；D1 只用于诊断。MCP 仅有 `focuslink:read`，不提供写工具或第二套 identity。
- Account DO 冷启动先读取单行 `account_schema_version`；已迁移账户不得在每次唤醒时重放全量 schema/index DDL。旧 `authority_observation_schema_version=2` 账户只补写新标记，避免大账户触发 Cloudflare 行读取上限。
- cloud live 结束必须在同一 authority 中写入 v1 兼容 bundle 与 v2 `focus_ledger_v2`/`focus_metadata_v2`。历史 v1-only 完成账本按有界批次补迁移；已有任一 v2 实体保持不变，不生成重复 ledger/metadata。

- 已结束时间账本不可直接覆盖；时间、segment 或 pause 修正都生成带原因的 correction。
- metadata 以 base/local/remote 三方比较；标题、学科、任务、备注双边异值进入冲突，标签以稳定 tagId 合并。
- 业务写入与 Outbox 同事务；`uploading` 持有有期限 lease；只有 `applied/duplicate` 原子更新 base 后删除 Outbox。
- Bootstrap 固定为 `uninitialized → inventory-uploaded → manifest-received → base-established → v2-active`。generation 或 epoch 改变时保留 Outbox 并重新建立 base。
- 设备 90 天未上线标 stale；tombstone 至少保留 180 天并等待全部活跃设备水位；graveyard 继续阻止旧副本复活。
- 设备令牌使用 `fl2_` 路由格式；账号 DO 只保存 pepper HMAC、scope、过期和撤销状态，token 正文不落日志。
- FocusLink 是单人本地产品，普通设备配对不经过 owner 登录。每台设备可匿名申请 8 位短码与本机 request token；任意另一台设备交换短码后获得独立 `fl2`，原设备随后用 request token 自动领取自己的 `fl2`，两台落入同一个固定同步空间。Account DO 按 `(accountId, installationId)` 的 HMAC 派生稳定 deviceId，并为 Windows、手机和平板分别签发独立凭据。Poyi owner/fia 路径只保留为后台维护兼容，不出现在正常客户端入口。
- 新设备入口固定为 `POST /account/v1/device/bootstrap` 的两阶段合同。`start` 携带严格设备 registration；gateway 返回 `flowId`、只供该流程使用的高熵 `flb_*` poll token 和 canonical `/owner/*` HTTPS 登录 URL。客户端只打开一次系统浏览器，随后用 `poll` 的 `flowId + pollToken` 领取结果；poll token 必须短期、单次消费，日志和诊断只能输出脱敏状态。未完成 owner 登录时直接返回 `authenticated`、轮询中更换 flow/credential、非 canonical 登录 origin 或回退到 installationId 领取凭据均为安全失败。
- endpoint、authority secret、owner subject 和配对兼容层都属于基础设施细节，不进入 renderer 表单。旧合法 `fl2` 原位迁移为已登录；退出只删除本机凭据，不删除账本。移动端必须把稳定 installationId 与 authority 分配的 deviceId 分开保存，重新登录不得制造幽灵设备。
- 推送只传 needSync hint，HTTPS/cursor 始终是数据真相。当前厂商凭据缺失，状态为 `credential-missing`。
- R2 恢复进入 maintenance 并切换 generation 与 epoch。当前账户未启用 R2，Wrangler API `10042` 代表真实备份门禁未通过。

## v1.5.7 实时会话片段级任务（live link-task）与进行中会话投影

- `LiveFocusTimelineSegment` 新增可选 `task`，三态语义固定：**字段不存在 = 继承会话默认任务**、`null` = 该片段被主动解除关联、对象 = 该片段的覆盖任务。`liveSegmentTask(segment, sessionTask)` 与 `liveSegmentTitle(segment, sessionTask, sessionTitle)` 是唯一解释点（`shared/sync/liveFocusProtocol.ts`），云端 DO 的完成包构建也必须走它，不得各写一份。
- live 协议新增动作 `link-task`（协议版本仍为 1，属于增量）：命令键集为 `{commandId, action, expectedRevision, sessionId, segmentId, task}`，`task` 只接受 `{taskId, taskSource ∈ local|ticktick, taskTitle}` 三键或显式 `null`；严格校验拒绝空 `segmentId`、缺 `taskSource`、`dida` 来源、额外键（如 `accountId`）以及非 link-task 动作携带 `segmentId`。
- Account DO 在 `validateLiveTransition` 里对 `link-task` 只做一件事：`session.segments.some(s => s.id === command.segmentId)` 为假即 `segment_not_found`（revision 不变）；通过后在该片段上写 `segment.task`（显式 null 原样写 null）。完成时 `buildCompletedLiveBundle` 用片段级任务产出每段的 `taskId/taskSource/title`，未被覆盖的片段回落会话默认任务。
- 桌面控制器：实时会话的 `linkSegmentTask` / `clearSegmentTask` 走 `relinkLiveSegment(segmentId, task)` → 云端命令，返回 `Promise<void>` 以保持 IPC 声明形状；`ensureNotLiveSession` 仍拦住「开始前选择默认任务」等语义，但**不再拦片段级改任务**。
- 进行中会话投影：`electron/sessions/liveSessionProjection.ts` 把 `TimerSnapshot` 只读投影成 `FocusSession/FocusSegment/PauseEvent`；`ipc.ts` 的 `sessions:list`（放最前 + 按 id 去重 + 截断 size）、`sessions:get`（命中投影 id 直接返回）、`sessions:analytics`（区间谓词与 `db/index.ts` 的 `listSessionsInRange` 对齐，且本地已有同一会话时不重复 push）使用它。投影不写库、不改计时 authority。
- 部署要求：DO 改动必须 `npx wrangler deploy` 后才生效；`npm run test:cloudflare` 已覆盖 link-task 的 applied / `segment_not_found` / 未点开片段不写覆盖三条实机断言。

## 1. 分层

```text
src/ renderer
  -> window.focuslink
shared/ipc/api.ts + shared/types.ts
  -> electron/preload.ts
  -> electron/ipc.ts
  -> timer / tasks / sync services
  -> db / integrations / OS
```

- `src/` 不导入 Electron 可执行模块，不读取 SQLite、文件系统或 shell。
- `preload.ts` 使用 `contextBridge` 暴露最小 API，并满足 `FocusLinkAPI`。
- `ipc.ts` 负责输入校验和分发，不复制 Provider、计时或同步算法。
- `shared/` 只保存跨进程类型、尺寸常量和无副作用纯策略。
- 外部集成放在 `electron/integrations/`；同一功能不得出现第二套 source tree。

## 2. 计时数据模型

| 实体/字段         | 语义                             |
| ----------------- | -------------------------------- |
| `FocusSession`    | 一次完整会话及默认任务           |
| `FocusSegment`    | 一段连续有效专注，可覆盖默认任务 |
| `PauseEvent`      | 独立暂停区间                     |
| `activeElapsedMs` | 有效专注，不含暂停               |
| `pauseElapsedMs`  | 暂停累计                         |
| `wallElapsedMs`   | 从开始到结束的自然跨度           |

核心不变量：

- `idle → running → paused → running → finished` 由主进程状态机驱动。
- 暂停会结束当前 segment；继续创建继承 session 默认任务的新 segment。
- 暂停、继续、结束和设置任务等关键边界立即持久化；周期快照只是补充。
- 崩溃恢复读取持久化快照，不通过伪造 UI 操作恢复。
- renderer 只消费 `TimerSnapshot`；显示累计复用 `shared/focus/` selector。
- 45 分专注 + 5 分暂停 + 45 分专注必须得到 90/5/95 分钟三种时间。

## 3. FocusLink 任务模型与可选外部连接

任务工作台的产品语义固定为 FocusLink 自有任务库。滴答 CLI / TickTick OAuth 是用户显式选择的导入/外部副作用连接，不自动成为主数据源。

| 字段/概念                | 取值                                        | 含义                                                                                   |
| ------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Task.source`            | `local` / `ticktick`                        | `local` 是 FocusLink 真实任务身份；外部读取只在导入前保留 `ticktick`                         |
| `Task.projectId`         | 一个真实清单 ID                         | 任务只归属一个普通清单；`local-inbox` 是系统收件箱，全部/完成只是聚合视图             |
| `task_projects.color`    | 受控颜色值                                | 每个清单独立保存；颜色不是身份，两清单可显式选同色，默认分配会避开收件箱色       |
| `AppSettings.taskSource` | `local` / `ticktick-cli` / `ticktick-oauth` | 默认 `local`；后两者只在用户选择导入时使用                                                   |

Provider 的稳定能力应包括：

- 列出项目与任务、按关键字搜索、按 id 回读。
- 创建或更新任务（Provider 支持时）。
- 以 `setTaskCompleted(task, completed)` 完成或恢复任务；IPC 返回规范化后的 Task，而不是仅返回模糊布尔值。
- 将专注记录写入任务或原生 focus；删除或重建错误记录。

任务工作台使用两个稳定 API：

- `window.focuslink.tasks.refresh(options?)` 返回 `IpcResult<TaskWorkspaceRefreshData>`，包含内部实际连接方式、清单、任务和 `refreshedAt`；失败保留精确连接错误。`provider` 仅用于诊断，renderer 不将它渲染成来源切换。
- `window.focuslink.tasks.setCompleted(task, completed)` 返回更新后的 Task。主进程在外部写入成功后更新缓存并广播；若 UI 采用乐观更新，失败必须恢复旧任务。
- `window.focuslink.tasks.updateProject(projectId, {name?, color?})` 只更新一个普通清单；收件箱名称固定。
- `window.focuslink.tasks.moveTask(taskId, projectId)` 移动任务子树；根若原有父任务在另一清单，必须解除根 `parentId`，不留跨清单父引用。

`Task` 的完成语义必须包含 `isCompleted` 和可空 `completedAt`；Provider 返回完成时间时必须规范化为 epoch milliseconds 并写入缓存，恢复未完成后 `completedAt=null`。`createdAt` / `updatedAt` 在 Provider 可用时同样保留，避免排序只能猜测。

工作台采用分阶段加载：

1. 默认 `includeCompleted=false`，dida CLI 仅执行 argv `task filter [--projects] --status 0 --json`，OAuth 仅列出活动任务。
2. 只有用户打开已完成视图时才传 `includeCompleted=true`与 `completedDays`；UI 只提供 30 / 90 / 365 天窗口，默认 90 天。
3. dida 0.1.10 的 filter 不可靠返回已完成普通任务，因此完成历史使用 argv `task completed [--projects] --start-date <iso> --end-date <iso> --json` 单独读取。
4. 活动任务先写入 id map，完成历史只补充缺失 id；历史端点不得用短暂旧状态覆盖已恢复任务。
5. renderer 以 request id 废弃过时刷新，并以 120 项为一批逐步渲染；该上限是渲染策略，不得丢弃已加载数据。

所有 CLI 读写不通过 shell 拼接，刷新或状态写入的 IPC 不得吞掉错误。

### dida checklist

- checklist item 不是普通任务。只持有 `parentId` 时要回读父任务并在父级 `items` 中定位目标。
- 完成子项：更新父任务 `items` 数组，只将目标 `status` 设为 `2`，保留兄弟项与未知字段。
- 取消完成子项：同样更新父任务完整 `items`，只将目标设置为 `status=0, completedTime=null`；兄弟项和未知字段原样保留，不得创建新普通任务代替。
- 原生专注只能关联 dida 接受的父任务身份；本地 segment 仍保留被用户选择的子项上下文。

## 4. IPC 契约

`shared/ipc/api.ts` 是 renderer API 的唯一类型真值。改变任何通道时必须原子更新：

1. `shared/types.ts` 的领域类型。
2. `shared/ipc/api.ts` 的参数、结果和事件。
3. `electron/preload.ts` 的桥接。
4. `electron/ipc.ts` 的校验与 handler。
5. renderer 调用端与测试。

要求：

- 设置更新采用局部对象并与完整设置递归合并；缺失字段表示不修改。
- 慢请求使用 request id 或版本防止旧响应覆盖新状态。
- `sessions.analytics(range)` 是严格只读、范围有界的统计接口。数据库必须选择与范围相交的会话，而不是只按 `started_at` 落点筛选；共享聚合器按自然日裁切 Session、Segment 与 PauseEvent，跨午夜/跨月/跨年数据不得整段归到开始日。该接口不得修改计时、同步队列或外部服务状态。
- 2026-09-10 观察区间收束（覆盖上一条的整日观察口径，但保留「整日累加不裁夜」）：`buildCalendarDayLedger` 现额外启用 `capObservationAtLastRecord`，观察区间 = 当日首条真实记录起点 → 当日末条真实记录终点（今天封顶 now，历史日封顶次日零点）。空档因此只反映**记录区间内部的空闲**，睡眠与未记录时段不再计入空档；`focus + pause + gap = observation` 不变量在收束后的区间内成立。产品统计的逐日总量仍按完整自然日累加（凌晨与深夜一律计入）。参数化 `buildDayLedger` 保持默认 `false` 以保留显式日间分析能力。实测后果：单会话日显示「空档 00:00:00 / 时间利用率 100%」；若需呈现「这一天有多少时间没在专注」，必须新增以有效时段为分母的独立指标，禁止回退整日空档口径。
- 2026-09-08 产品统计修正优先于下述旧默认有效日口径：desktop/mobile 均调用共享 `buildCalendarDayLedger`，显式窗口为本地 00:00–24:00，今天截至 now，包含凌晨与深夜。参数化 `buildDayLedger` 仍允许显式日间分析，但产品 Dashboard 不使用其 07:00–22:00 默认值。首个真实 focus 才建立观察起点，空白日不制造空档，estimated 不混入精确三分类。
- `shared/dayLedgerAnalytics.ts` 是有效日与空档分析的唯一纯函数真值，结果通过 `SessionAnalyticsResult.dayLedgers` 暴露给桌面与移动 renderer。默认有效日为 07:00–22:00；观察起点只认真实 segment 边界，pause 以真实 `PauseEvent` 为准并在重叠时优先分类，gap 只在内存中由观察区间内 focus/pause 并集的补集推导，禁止新增 gap 表或同步实体。三类精确时长必须满足 `focus + pause + gap = observation`。
- `DayLedgerAnalytics.tasks` 必须从同一批已裁切、pause 优先的 focus 区间聚合，任务总量与有效专注 KPI 使用同一窗口；缺少可定位 segment 的旧记录只能作为 `estimated` legacy 余量展示，不能把自然日整段时长重新混入任务分配。
- `DayLedgerAnalytics.sessionFocus` 提供同一有效日窗口内的逐会话 focus，供“最长一轮”等 KPI 跨日合并；精确行来自已分区 focus，旧会话只保留按有效窗口裁切的 estimated share。estimated 不得与精确 gap 相加后伪装成同一观察区间或三分类柱高。
- 当天 open segment 可在活动 Session 中延伸到 `min(now, 22:00)`，open PauseEvent 代表 paused 尾段；历史 open 行和缺少 Segment/PauseEvent 的旧会话不得伪造起止，只输出 `estimatedFocusMs/estimatedPauseMs` 与 `estimated=true`。跨午夜、重叠、DST 本地日、历史/今天均由共享纯函数裁切；00–07 与 22–24 不进入统计区间。
- 统计会话详情同时核对 request id 和当前展开 session id；路由卸载会使所有未完成详情请求失效。失败必须清理当前 loading 并保留行内可重试错误，不得产生 unhandled rejection。
- 统计 renderer 只订阅当前 session id 和 timer state 等原子值，不因 `activeElapsedMs` 每秒变化而重渲染整份历史列表。
- 主窗、小窗和托盘共享计时 tick、设置与任务变更广播。
- 外部命令退出码、超时、解析错误、空 id 和 `undefined` 输出都必须可观察且视为失败。
- 不暴露任意命令执行、任意文件读写或数据库句柄给 renderer。

当前任务相关通道为 `tasks:refresh` 与 `tasks:set-completed`。旧 `tasks:complete` 只能作为兼容入口，新的 UI 不得为“恢复未完成”复制另一套通道。

## 5. dida CLI

### 可执行入口

- 手动配置路径优先；其次解析用户 npm 全局目录中的 dida 真实 Node 入口；最后才使用 PATH。
- 安装版、便携版和开机启动环境必须分别验证，不能用开发终端 PATH 推断成功。
- 诊断记录结构化的命令类别、耗时、退出码和脱敏错误，不记录 token。

### 写入规则

- 中文、换行和 JSON 一律通过 `execFile`/argv 传递，不拼 shell 字符串。
- FocusLink 专注摘要优先写任务评论；评论失败才回读并保留原正文后追加。
- 每条 segment 带稳定 marker：`[FocusLink:segment:<id>]`。
- 写入前读取现有评论/正文；marker 已存在则跳过，保证幂等。
- `undefined`、空输出、缺少目标 id 或无法回读证明的写入都不算成功。
- 原生 focus 使用紧凑有效区间：`end = start + activeElapsedMs`，不能把暂停或隔夜 wall time 放大到云端。

### 普通任务完成与恢复

- 完成使用 argv `task complete <projectId> <taskId>`，并拒绝 `undefined` 输出。
- 恢复先尝试 argv `task update ... --status 0 --json`。若当前 dida CLI（已知 0.1.10）未暴露该参数，才使用最小 Open API bridge。
- bridge 只读取 `~/.config/dida-cli/config.json` 中已有 token，不修改配置，也绝不把 token 写入日志、IPC、诊断或错误。
- bridge 必须先 GET 完整任务，再 POST `/open/v1/task/{id}` 写 `status=0, completedTime=null`，最后 GET 二次验证；Dida 可能在恢复后保留历史 `completedTime`，因此回读的显式 `status=0` 才是未完成的权威依据。任一步失败都不能更新本地为未完成。
- TickTick OAuth 完成使用官方 `/project/{projectId}/task/{taskId}/complete`，恢复通过 `/task/{id}` 写 `status=0, completedTime=null` 并回读验证。

## 6. dida 同步队列

- SQLite 是本地事实；结束 segment 后先持久化，再进入异步队列。
- payload 固定记录入队时 Provider，用户之后切换来源不能改变旧项执行方。
- 队列单飞、小批量串行；普通失败有上限，429/限流进入持久化退避且不消耗永久重试次数。
- `synced` 只在外部写入得到可验证结果后设置；pending、failed 和 skipped 不得映射成成功。
- 重新关联、清除或删除时，与后台同步使用同一排他区：先清理旧云记录和相关队列，再修改本地关联。
- 应用退出等待在途写入完成可控交接，再关闭数据库。

## 7. 番茄 To-do

本地数据库写入与云桥是两个阶段：

1. 将带 `[FocusLink:tomatodo:segment:<id>]` marker 的 PCRecord 原子写入本地库，`isSynced=0`。
2. 已有可验证原生桥时，或用户手动同步触发按需桥接后，按会话批量调用 `cloudSyncUploadRecord`。
3. 只有上传接口明确返回 `success` 且本地状态成功持久化后才设置 `isSynced=1`。这叫“上传已确认”，不是独立云端回读。
4. 手机投递是独立阶段：电脑版只有在 `syncGetStatus().connectedCount > 0` 时才调用 `syncRecord`，并以该调用的结果记录 `phoneSyncConfirmed`。云上传成功不能清除手机投递 durable queue。

不变量：

- FocusLink 启动和后台周期重试只探测已存在的可验证桥；客户端关闭时保留本地待上传和持久 segment id，不得为后台补传擅自启动外部应用。
- 本地 JSON 写成功不能显示为云端已同步。
- 用户手动同步且番茄 To-do 未运行时，可以用 `spawn` / `execFile` 参数数组按需启动已知客户端，参数固定包含 `--remote-debugging-port=0`；不得拼接 shell 命令。只有发现实际端口且目标同时通过“番茄 ToDo 标题 + 特征 electronAPI 方法集”身份校验后才能上传；不得选择任意 `page` target。显式 `FOCUSLINK_TOMATODO_CDP_PORT` 失败时不得回退到通用 9222。
- 番茄 To-do 已以普通模式运行但没有可验证桥时，绝不自动结束或重启其进程；返回可操作诊断，要求用户完全退出客户端后再从 FocusLink 连接。
- 已核对番茄 ToDo 1.6.2：`cloudSyncFetchTodo` 只读取待办数据，CloudSyncService 只提供 `fetchTodoData` / `uploadRecordData`，没有专注 PCRecord 的独立云端回读或远端删除 API。因此 bridge 返回 `uploadConfirmed` 与 `cloudRecordReadbackSupported=false`；删除结果固定声明 `local-record-only` 与 `remoteDeleteSupported=false`。
- `isSynced=1` 是番茄 To-do 自有字段，不能同时被解释成 FocusLink 的“手机已显示”。云上传确认与手机 `syncRecord` 投递确认必须由独立状态表达；手机未连接时状态为 `phone-pending`，不能因云上传成功清除 durable queue。
- 已存在且云上传确认的 marker，在请求手机投递时仍必须调用 `syncRecord`；marker 幂等只禁止重复创建 PCRecord，不禁止向尚未确认的手机通道重试。
- 真实手机验证确认专注云投递只保留最近 7 天且按一次性批次消费。超窗记录返回 `tomatodo_record_outside_seven_day_window`，不得因上传 API 返回 success 改成已确认，也不得在未获用户授权时重写记录日期。
- 未识别学科统一归入“学习”；迁移只处理 FocusLink marker 记录，不碰用户其他数据。
- 写盘使用同目录临时文件、fsync、原子替换和备份；Windows `EACCES/EBUSY/EPERM` 做有界退避，持续失败保留旧库。
- 学科更改可请求重新上传；已有 marker 的单个/批量学科修改若因桥不可用或上传失败未写入外部记录，必须把 segment id 写入 durable queue。队列清空前，即使旧番茄记录仍为 `isSynced=1`，状态也必须显示“待上传”，不能把旧学科的成功与新本地选择拼成“上传已确认”。
- 删除只能确认本地 marker 清理。没有远端 API 时不得声称已回读或已清理云端记录，两个同步域互不冒充对方成功。

## 8. FocusLink 跨设备同步

跨设备同步是独立于 dida `sync_queue` 与番茄 To-do durable queue 的第三个同步域。它复制
FocusLink 自己的专注账本，不代表记录已经写入滴答或番茄 To-do，也不得复用后两者的状态文案。

已结束账本平面以完整会话包为原子单元：`FocusSession + FocusSegment[] + PauseEvent[]`。协议真值
位于 `shared/sync/deviceProtocol.ts`，固定包含 `protocolVersion`、设备 ID、幂等 `opId`、实体
revision、服务端单调 change sequence 与不透明 cursor。规则如下：

### Focus Guard V1 加密实体合同

`focus_guard_rule_v1`、`focus_guard_state_v1`、`focus_guard_completion_v1` 与
`focus_guard_config_v1` 复用同一个 Sync v2 change feed，但正文必须始终是
`EncryptedFocusGuardEnvelopeV1`。Account DO 只验证精确 envelope、entity type、revision、
fingerprint、tombstone 和 cursor，不持有或生成 32-byte account root，也不读取明文。

Envelope 固定且不允许额外字段：`version=1`、`algorithm=A256GCM`、
`product=focus-guard`、与 entity type 一致的 `entityKind`、96-bit base64url `nonce`、
base64url `ciphertext`、64 位十六进制 `aadHash`、`aadBaseRevision`、
`operation=put|restore`、`createdAt`。AAD 固定绑定
`product | entityType | entityId | aadBaseRevision | operation`；删除只使用 Sync v2 tombstone，
不伪造“加密空对象”。

解密后的 V1 明文字段冻结如下；这些字段只存在于受信客户端内存和设备安全存储，不进入
authority 日志或服务端索引：

| entity type                 | 稳定 entity id               | V1 明文字段                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `focus_guard_rule_v1`       | `guard-rule:<uuid>`          | `ruleId`、`ruleType=supervision \| sleep`、`name`、`enabled`、`priority`、`schedule{timeZone,weekdays,startMinute,endMinute}`、`limits{continuousUseMs,cumulativeUseMs,lockMs}`、`applicationPolicies[]`、`whitelistPackages[]`、`lockMode=normal \| strong \| brick`、`allowSkip`、`maxPauseMs`、`expiresAt`、`updatedAt` |
| `focus_guard_state_v1`      | `guard-state-focuslink-live` | `state=idle \| running \| paused`、`sessionId`、`revision`、`observedAt`、`expiresAt`；TTL 默认 90 秒、最大 300 秒，只供短期展示，永不作为永久锁机授权                                                                                                                                                                     |
| `focus_guard_completion_v1` | `guard-completion:<uuid>`    | `completionId`、`ruleId`、`ruleType`、`outcome=completed \| skipped \| interrupted`、`startedAt`、`endedAt`、`activeMs`、`lockedMs`、`sourceRevision`                                                                                                                                                                      |
| `focus_guard_config_v1`     | `guard-config:global`        | `supervisionEnabled`、`sleepEnabled`、`notificationsEnabled`、`ladder{enabled,thresholdMs,useMs,lockMs}`、`updatedAt`                                                                                                                                                                                                      |

字段级边界：`applicationPolicies` 只保存用户声明的可移植包名、模式和时长/次数阈值；
`whitelistPackages` 只保存用户选择的包名。Android UID、应用是否已安装、权限结果、ROM
能力、解析后的本机组件、Keystore 材料、token、root、当前锁机授权、日志和原数据库行均禁止
进入明文。跨设备恢复必须把包不存在或能力不匹配保留为本机待处理状态，不能改写云端规则。

阶段 B 的本地 root 实现另有独立合同：32-byte account root 由受信本地 provisioning 生成，
owner recovery 使用 HKDF-SHA256 recovery envelope，rotation 使用旧 root 加密的新 root，
二者都绑定 account、fromGeneration/generation、purpose、AAD 与 createdAt。Windows 只允许
Electron `safeStorage` 包裹 root material 并做 temp/fsync/rename/readback；Android 只允许独立
Keystore alias 包裹 root material，普通偏好仅存密文 envelope 与非敏感 metadata。root generation
或 rotation 字段不得添加到 V1 guard envelope；生产 publisher、解密桥、Worker/DO/gateway 和
schema 变更仍未接线，阶段 C/D 需单独批准。

Windows 的 root material 写入在同一 root 文件的进程内 mutex 下执行，并在落盘前复核记录
SHA-256 版本，避免两个 desktop store 实例互相覆盖。加密 material 与记录 metadata 必须同时
绑定 `accountPublicId + generation + keyId`；`revoked` 是不可逆终态，任何降级、恢复或旧 generation
写入都被拒绝。root writer 只在 Electron main 的本地 vault 中存在，不向 renderer/IPC 暴露，也不等同于
已批准的跨设备 Focus Guard publisher。

冲突和兼容规则：

- rule/config 使用 `expected baseRevision + baseFingerprint`；同字段双边变化在将来的解密桥中
  进入显式冲突，不允许 last-write-wins。state 使用固定 ID、严格 revision 与短 TTL；过期、
  rollback 或同 revision 异文全部 fail-closed。completion 以稳定 ID 幂等且写后不可覆盖。
- 四类实体沿用现有 180 天 tombstone、水位、graveyard 和 purge 门禁。restore 必须引用当前
  tombstone revision；旧副本不能复活已删除规则或配置。
- 能识别 V1 但尚未持有 root 的 Electron、Web/PWA/Android reader 必须验证并原样保存
  envelope，不得解密猜测或因 guard 类型拒绝整页；无效 envelope、未来未知 entity type、
  非单调 changeSeq/cursor 或 revision rollback 必须在提交 cursor 前隔离/失败。
- Android 原生 completed-ledger Worker 是 cursorless writer，不消费 change feed；它可以忽略
  响应中的 guard change，但不得复制、解密或写入第二份 guard 缓存。移动 renderer 仍是唯一
  Android Sync v2 reader。

- 账本平面仍只复制 `finished` / `aborted` 会话；活动快照和控制命令绝不塞进 completed bundle，也不改变现有桌面端已结束会话补传语义。
- `cloudFocusId`、第三方投递结果、CLI/OAuth 凭据、TomaToDo 路径、窗口/快捷键/小窗设置均不进入会话包。
- 服务端以 `(account, opId)` 去重；稳定 `opId` 同时包含实体、正文与 `baseRevision`，相同 op 重放返回 `duplicate`，`baseRevision` 过期返回 `conflict`，不使用客户端 `updatedAt` 静默覆盖。
- Electron 以 SQLite 完成会话为耐久事实源，网络失败后下次重新扫描补传；cursor、每个会话的已确认 revision/fingerprint 与未解决冲突写入同一个原子 `app_meta` 检查点。Sync v2 transport checkpoint 按“规范化 endpoint + 完整 device token 的不可逆摘要”分区；dida/TomaToDo provider queue 则使用独立 `providerScope`：canonical `fl2` 为 endpoint + accountPublicId 的匿名哈希，legacy loopback 才按凭据哈希。切换服务/账号不得复用旧状态；服务明确返回 `invalid_cursor` 时清理当前分区并完整重试一次。Web/PWA/Android 若从旧安装或旧账号缓存恢复出无效 cursor，也必须识别结构化 `invalid_cursor` 错误码，清空该设备的旧账本缓存并从空 cursor 重建一次；禁止保留旧账号会话或按错误文本无限重试。
- Android/Web 的本机离线会话使用同一 completed bundle 协议，不新增移动端业务服务。活动草稿和待上传 bundle 分开存入 IndexedDB；结束操作必须在一个事务中写入稳定 `opId` 的 pending 记录并删除活动草稿。每次在线账本拉取前先串行补传 pending，只有 `applied/duplicate` 删除，`conflict/rejected` 或网络失败保留；普通“清缓存”不得删除 pending。移动端应用沙箱保护账本，Android token 仍只存 Keystore，Electron token 仍只存 `safeStorage`，日志、overlay 和通知均不得输出令牌或 endpoint。
- Windows 登录项的有效策略为“用户显式自动启动”或“跨设备同步已启用且 autoSync 已启用”。后一种情况必须隐藏启动并常驻托盘；睡眠恢复后重新确认 canonical HTTPS 连接并立即跑一次同步。回环开发后端只允许测试进程显式启动并监听 `127.0.0.1:18787`，不得由 Electron 自动启动或开放 LAN。
- ADB 只用于显式构建、安装、版本回读和 instrumentation；Electron 运行期不得枚举设备、维护 `adb reverse`、自动配对或把手机流量中继到本机测试后端。生产移动端始终直连 canonical HTTPS authority。
- 拉回的全新会话在一个 SQLite 事务中插入 session/segments/pauses，并在同一事务写入按 `(connectionScope, sessionId, provider)` 唯一的 `dida` / `tomatodo` 回写意图；事务内绝不执行外部副作用。提交后 coordinator 才以 SQLite 原子 claim/lease 消费，两个 provider 分别完成或指数退避，过期 lease 可跨重启回收；滴答复用 marker 幂等的 `sync_queue`，番茄 To-do 复用 durable segment queue，后台不得启动外部客户端。同一次 cursor catch-up 的所有响应页先在内存按实体折叠到最新 revision，完整收敛后才写 SQLite 与原子检查点；中途断网不会暴露旧 revision。拉取完成后的既有记录或已改动的同 ID 正文写入耐久冲突箱。冲突未解决时界面不得清空错误或宣称完全收敛。
- 服务端对 cursor 之后同一实体的多次历史 revision 先折叠为最新状态，再按 change sequence、条数与响应字节预算分页；全新设备不得先导入旧 revision 再把同一批历史误判为本地冲突。
- 当前桌面端不执行远端删除，也不自动覆盖已有会话；删除/编辑冲突需要后续显式清理与合并流程。
- Electron 访问令牌只经 `safeStorage` 加密落盘，不进入 `AppSettings`、renderer 日志或多端 payload。
- 回环测试后端可生成 2 分钟一次性配对 offer；生产普通流程为设备 A `/pair/requests` 生成 8 位码与本机 request token，设备 B `/pair/exchange` 输入该码并获得自己的 `fl2`，设备 A 的 `/pair/claim` 随后自动获得自己的 `fl2`。码有效 10 分钟；同一 installation 重复 exchange/claim 幂等返回同一凭据，其他 installation 重用已占用码才返回 410。DO 对短码/token 分别保存域分离 HMAC，public edge 不做配对次数限流，日志不记录请求体、code、request token、nonce 或设备令牌。旧 `/pair/offers` 与 `/pair/approve` 只作已安装客户端兼容。Android 凭据进入 Keystore，Electron 进入 safeStorage。
- Electron 只有在首次 `GET /sync/v2/live` 成功并通过协议校验后才切换到实时事实源；握手失败时保持本机 idle/计时可用，并以 `2s → 4s → 8s … → 60s` 有界退避重连。已确认的 running/paused 实时会话断线时不得切回本机空闲状态或伪造云端确认。
- 生成 completed bundle 时，旧版本遗留的暂停孤立引用只在传输副本中归一为 `segmentId: null`，原始 SQLite 行不被静默删除；诊断必须记录会话 ID 和孤立数量。

`cloud/` 的默认开发入口仍是回环测试后端：默认监听 `127.0.0.1`，启动必须显式提供
`FOCUSLINK_CLOUD_TEST_TOKEN`，执行精确 CORS allowlist、Bearer 鉴权、512 KiB 单会话包上限与请求/响应各 1 MiB 字节预算；请求和响应都按序列化字节切页，可用
忽略目录中的单进程 JSON 文件持久化。

生产 Cloudflare Sync v2 的唯一数据 authority 是 `cloudflare/accountDurableObject.ts` 的 Account Durable Object。`cloudflare/worker.ts` 只作为私有 service-binding authority adapter：`wrangler.jsonc` 固定 `workers_dev=false`、`preview_urls=false`；不得创建未经登记的 `workers.dev`、preview 或任意用户自定义入口。生产客户端仍以 canonical `foxlink-cloud-mcp` HTTPS origin 作为身份与默认地址；为应对部分网络对 `workers.dev` 的 DNS/443 阻断，数据面额外允许固定的 `https://focuslink.pyzzgk.dpdns.org` failover，两个 origin 必须指向同一 adapter，且只在传输失败时按固定顺序重试。OAuth、owner session、CSRF、resource/audience 与登录 URL 仍只走 identity gateway；客户端不得接受任意用户域名、不得把 failover 当作登录域、不得改指向私有 Worker。

新设备登录的部署顺序不可交换：先在私有 FocusLink Worker 与 canonical gateway 分别配置同一代、独立于 device/OAuth/MCP 的 `fia_*` authority secret；再部署私有 `/sync/v1/devices/register` 与 Account DO migration；随后部署 gateway 的 bootstrap flow store、owner session/CSRF approval 和私有登记转发；最后运行 start/poll 正负测试并撤销旧 secret。回滚时先停止新 flow，再保留旧 `fl2` 数据面和已登录设备，不得撤销现有 device credential。仓库内合同通过或 dry-run 均不等于 gateway 已上线。

Node `cloud/server.ts` 仅保留显式 token 的 `127.0.0.1` 合同测试后端。`startPersonalCloud()` 与 `FOCUSLINK_CLOUD_MODE=production` 固定失败；`cloud/Dockerfile` 是不可启动 authority 的退役标记镜像，Compose 不再声明 Node cloud API、静态 bearer 账号或持久卷。Node 不能作为应急 production authority，也不能绕过设备撤销、scope、Account DO 事务或 MCP 投影。

canonical adapter 与私有 authority 的路由表如下。`/v1/*`、`/v2/*` 和 `/sync/push` 均为已退休外部路径，adapter 与私有 Worker 都不得回退：

| Canonical path                   | 方法       | 凭据 / scope                                                                               | 私有 Account DO 路径             |
| -------------------------------- | ---------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| `/sync/v2/status`                | GET        | device token · `sync:read`                                                                 | `/v2/sync/epoch`                 |
| `/sync/v2/exchange`              | POST       | device token · 无 mutation 时 `sync:read`，有 mutation 时 `sync:write`                     | `/v2/sync`                       |
| `/sync/v2/tasks`                 | GET / POST | device token · `sync:read` / `sync:write`                                                  | `/v1/tasks`（仅 DO 内部）        |
| `/sync/v2/live`                  | GET        | device token · `live:read`                                                                 | `/v1/live`（仅 DO 内部）         |
| `/sync/v2/live/wait`             | GET        | device token · `live:read`                                                                 | `/v1/live/wait`（仅 DO 内部）    |
| `/sync/v2/live/command`          | POST       | device token · `live:write`                                                                | `/v1/live/command`（仅 DO 内部） |
| `/sync/v1/pair/offers`           | POST       | 旧客户端兼容：pair-service authority 或已有 `fl2 + sync:write`                            | `/v2/pair/offers`                |
| `/sync/v1/pair/exchange`         | POST       | 8 位短码 + 完整 installation metadata；无 bearer、无次数限流、同 installation 幂等         | `/v2/pair/exchange`              |
| `/sync/v1/pair/requests`         | POST       | 无 bearer；完整 installation metadata；返回短码与仅本机保存的高强度 request token          | `/v2/pair/requests`              |
| `/sync/v1/pair/approve`          | POST       | 旧客户端兼容：已有 device token · `sync:write`                                            | `/v2/pair/approve`               |
| `/sync/v1/pair/claim`            | POST       | 无 bearer；request token + 与申请完全一致的 installation metadata                          | `/v2/pair/claim`                 |
| `/sync/v1/devices/register`      | POST       | 仅 identity gateway 的独立 `fia_*` + 精确 `poyi-owner`；公网客户端不得直连                 | `/v2/devices/register`           |
| `/internal/mcp/v1/focus/summary` | GET        | 仅 MCP service binding credential；公网 OAuth 由 `foxlink-cloud-mcp` 校验 `focuslink:read` | 同名内部投影                     |

Account DO 保存实体、revision、reservation/result、change feed、任务快照、实时会话、commandId 与设备 credential HMAC；每个请求在 DO 内执行真实 scope、过期、撤销、跨账号和 `deviceId` 绑定检查。任何日志、响应或同步实体都不得返回 token。`/healthz` 只证明进程存活；`/readyz` 必须验证必需 secrets 与 Account DO SQLite probe，不能把配置存在冒充 authority 可写。

### 同步健康与错误呈现合同

- canonical `foxlink-cloud-mcp` 公网 adapter 的匿名存活探针是 `GET /healthz`；本机 loopback 测试后端才使用 `GET /health`。`/healthz` 成功只证明当前 DNS/TCP/TLS/adapter 请求链可达，不证明设备 token、scope、Account DO 读写或历史同步已成功。
- `GET /sync/v2/status` 是只读 canonical 状态路由；无凭据返回 401 只能证明路由存在且鉴权 fail-closed，不能冒充已存凭据通过。bootstrap inventory/entities 是会创建或更新服务端 bootstrap 状态的 POST 路由，禁止作为 health probe。
- `deviceSync.lastErrorV2.<scope>` 保存的是最近一次结构化同步结果码，不是单一的连接布尔值。`network_error`、超时与 HTTP/credential 错误属于 transport/auth 失败；`conflict_present` 表示同步请求已完成但本机仍有耐久冲突，`rejected_operation` 表示操作被拒绝。后两者不得显示为“当前连接失败”。
- 一次成功同步可以同时留下 `lastSyncAt` 和 `conflict_present`。界面必须结合结构化 error code、`unresolvedConflicts`、最近一次已验证 transport 时间和 live telemetry 呈现；禁止依赖本地化错误文案的正则匹配，也禁止把任意非空 `lastError` 统一映射为 danger/“跨设备同步失败”。
- `conflict_present` 且 `unresolvedConflicts > 0` 的固定语义是 warning：“同步已连接，有记录待确认”；冲突记录继续安全保留，不自动覆盖。`network_error` 只有在最近一次真实请求失败且尚无更新的成功证据时才能呈现“同步服务未连接”。
- 诊断必须同时保留历史失败和当前探针事实：日志中的早先 `network_error` 不因当前 health 恢复而被改写；当前 health 恢复也不能清除尚未解决的冲突。不得通过清 token、清缓存、删数据库或重做 bootstrap 掩盖状态分类错误。

Cloudflare 外部协议 gate 是受限测试操作，不是部署入口：external run/verify 必须显式 opt-in，目标只能是 `127.0.0.1` 的 disposable Worker。`FOCUSLINK_TEST_STATE` 只能是项目 `.tmp` 或系统临时目录下允许名称的直系状态文件；父目录与文件均须拒绝 junction/symlink/非普通类型，创建使用 exclusive create，读取与删除前复核文件身份，序列化状态不得包含 credential。external verify 不自动删除外部状态文件，因为它没有可证明的所有权能力；只有 local 隔离 gate 在自建临时根内自动清理自己的状态与持久化目录。

中央 authority 读取 FocusLink 状态时只能绑定 named entrypoint `FocusLinkAuthorityObservation`，默认 Worker 对 `/internal/authority-observation/v1` 固定返回 `service_binding_required`。中央 canonical registry 将 FocusLink 固定映射为 `productId=identity-focus`；请求必须精确携带 vendor `Accept`、32–512 字符安全 token 形式的独立 `Capability` secret 和完整 HTTPS `/authority/identity-focus` audience，device/OAuth/MCP/pair 凭据均不能替代该 capability，产品不得另加中央不识别的前缀约束。Account DO 以真实 v2 change sequence、live revision、device watermark、generation、maintenance 与 conflict 状态生成 checkpoint fingerprint；fingerprint 改变时立即递增 observation revision。有效 TTL 内的 named GET 先在同一 DO SQLite 事务中探测 schema/meta/live 依赖，再原字节返回既有 snapshot；snapshot 缺失、损坏或到期时，只有依赖探测通过才推进新的 verification checkpoint revision 并持久化新 snapshot，相同业务 fingerprint 也不改写旧 revision。DO 内部 `authority_observation_schema_version=2` 移除旧 `state_hash` 唯一约束以保存这些续期 checkpoint。同一 revision 的 truth、`observedAt`、`expiresAt` 与序列化正文永不重写；缺配置、依赖失败、额外字段或不可用 revision 全部非 200，由中央 authority 在校验后另行计算 observation hash 和签名。

实时活动会话是独立控制平面，协议真值位于 `shared/sync/liveFocusProtocol.ts`。Web/PWA、Android
与显式开启实时控制的 Electron 同步同一账号下的唯一活动会话。Electron 由
`timer/focusTimerController.ts` 统一承接 IPC、托盘、快捷键和窗口快照；实时模式中本地
`TimerManager` 必须保持 idle，不得生成第二份活动账本。实时规则如下：

- 状态仅为 `idle / running / paused`，合法迁移是 `idle→running`、`running→paused`、`paused→running` 以及活动态经 `finish/abort` 回到 idle。服务端持有 revision 与时间边界，客户端只做显示外推。
- 每个命令含随机稳定 `commandId`、发起 `deviceId`、目标 `sessionId` 与 `expectedRevision`；相同正文重放返回 duplicate，同 id 不同正文被拒绝，旧 revision 返回 conflict 和最新快照。
- canonical HTTPS 下的 Electron live command、任务快照和 Sync v2 mutation 必须统一从 `fl2` 凭据解析 `device-<devicePublicId>`；不得把 legacy SQLite `deviceSync.deviceIdV1` UUID 填入受设备令牌绑定校验的写请求。回环合同测试允许继续使用本机 UUID。
- 云端快照已确认 idle 后，start 若因传输不可达或 HTTP 401/403 未被确认，Electron 必须先取消长轮询、退出 live fact source、记录分类诊断，再启动本地 TimerManager；本地开始不能被失效凭据卡死。若云端或本地任一侧已经 running/paused，则禁止该降级，继续保留权威/冲突保护。
- start 由客户端生成 session id，可携带有界标题与可选任务上下文；同一账号一次只能有一个活动会话。pause/resume/finish/abort 必须命中当前 session，陈旧通知或快捷设置动作不能作用于下一轮。
- `GET /sync/v2/live` 返回当前快照；`GET /sync/v2/live/wait` 只在 revision 前进或有界超时后返回，HTTP 断开必须释放 waiter；`POST /sync/v2/live/command` 处理幂等命令。三者都经 canonical adapter，私有 authority 复验 device credential 与 scope。
- 每个响应给出 `serverTime`，并把 active/pause/wall 三时间物化到该时刻。running 后只有 active 与 wall 增长，paused 后只有 pause 与 wall 增长；客户端从该基点逐秒显示，不能用本机时间改写云端事实。
- finish/abort 在同一次持久化提交中闭合当前 segment/pause、生成通过 completed-bundle 校验的完整 Session/Segment/Pause，并写入现有账本 change log；其他设备随后用原 cursor 协议拉回，不能观察半个会话。
- 实时快照携带 segment/pause 边界；Electron 以 `serverTime` 计算本机时钟偏移后投影 `TimerSnapshot`。由任一设备结束时，Electron 必须先运行账本拉取并确认完整 bundle 已进入 SQLite，再发出 `finished` 快照触发 dida/TomaToDo 副作用。
- 实时快照、命令幂等记录与 completed ledger 共用账号级原子 JSON 提交并向后兼容旧测试文件；进程重启后必须保留活动时间边界和命令去重。该 JSON 仍只允许单进程本地测试。
- dida 和番茄 To-do 始终是桌面副作用。移动命令与实时快照不携带凭据或伪造投递结果；结束会话进入 FocusLink 账本后，只有桌面端真实执行相应队列并得到可验证结果才能显示外部同步成功。
- Android 前台 Service、通知动作与 Quick Settings Tile 是薄传输层：只保存当前显示快照和至少一次 native command 队列，不自行推进业务计时，不在云端确认前乐观翻转。快照的 `localAuthority=true` 表示 WebView 正在运行本机离线会话；此时 Service 不上传 native 云端命令，迟到的云端响应也必须在 Store 原子门禁处被拒绝，不能覆盖本机通知或 overlay。待处理云端动作必须含 session/revision 并支持冷启动 drain/ack；只有匹配 command id 的 applied/duplicate/conflict/rejected 才能完成本地队列项。
- Android completed-ledger native mirror 由唯一 WorkManager work 承载，要求 `NetworkType.CONNECTED` 和指数退避；WorkManager 负责进程死亡、boot、网络恢复与 Doze 后续跑，boot/package-replaced receiver 只在 Keystore 身份仍有效且 native outbox 非空时补排。401/403、撤销和 revision rollback 写入固定诊断并停止自动重试，记录保留到显式凭据修复；不得退回 JobScheduler、明文 HTTP 或第二 cursor。
- Android 后台只读刷新采用自调度链而非周期 Future：主线程触发单线程 HTTP 请求，请求的 `finally` 安排下一次 20 秒刷新，任何异常不得永久取消后续轮询。最近尝试次数、成功时间、revision 与错误写入本机诊断状态。本机权威期间允许记录探测成功，但不得 `putSnapshot/applyCloudSnapshot`；其余云端快照写入按 revision 单调拒绝旧值，idle 必须保留 revision。
- Android 系统表面由 `SystemFocusSurfaceProvider` 选择，`StandardNotificationAdapter`、`XiaomiIslandAdapter` 与 `HuaweiCapsuleAdapter` 只共享脱敏 `FocusRuntimeSnapshot`，不共享厂商载荷。小米使用稳定业务 ID、通知 ID 与协议 3 start/running/pause/resume/finish 投影；能力证据依次为 `unsupported/protocol-selected/systemui-accepted/visually-verified`，最后一级只能由真机截图和人工矩阵写入。标准 ongoing notification 始终独立可用；华为既有 TIMER/capsule 字段与布局保持不变。
- Android 的沉浸系统栏与画中画由 `MainActivity` 通过公开 API 提供，Capacitor 插件只暴露能力、当前状态和显式用户动作。结束活动会话后 renderer 必须恢复系统栏；画中画不支持时返回结构化 `supported: false`。这些显示能力不得引入第二套计时器、kiosk/设备所有者权限或厂商私有 API 依赖。
- v1.3 的 Android root 权限批次只接受当前 `BuildConfig.APPLICATION_ID`，包名先过固定正则，再由 `RootPermissionPolicy` 生成通知、overlay、电池白名单和按 API 24/26/28 分支的后台 AppOps 命令；WebView 不传命令文本，native 也不把 root 输出回传。`su -c` 运行在单线程 executor，固定 5 秒超时、并行有界读取输出；最终结果必须分别用 `canPostNotification`、`Settings.canDrawOverlays`、`PowerManager.isIgnoringBatteryOptimizations` 和 AppOps/`isBackgroundRestricted` 回读。厂商自启动没有可靠公开查询，永远返回 `manual-required`。renderer 对矛盾的 `granted/verified` 数据按未确认处理，并允许后续系统状态刷新覆盖旧批次结果。
- Android 桌面后备计时使用 `TYPE_APPLICATION_OVERLAY` 和显式 `SYSTEM_ALERT_WINDOW` 特殊授权，默认关闭且不得因通知可用而自动显示。点按显示关闭按钮并在 3 秒无操作后收起；关闭持久禁用 overlay，但不结束会话或通知，重新启用只能来自应用设置。拖动目标坐标通过 `postOnAnimation` 每帧最多更新一次，拖动期间缓存安全区/尺寸，背景 drawable 按状态复用；位置继续归一化持久化并在配置变化后重新夹取。

云端任务清单使用独立的权威快照平面，协议真值位于 `shared/sync/taskSnapshotProtocol.ts`；其内容来源是 FocusLink 自有任务库或用户显式导入后归一化的本地副本：

- 电脑端每次成功读取或修改 FocusLink 任务工作台后自动发布清单与任务快照；发布失败只记诊断，本地任务仍可用。
- 项目 V1 未单独携带 `updatedAt`；合并时以快照 `publishedAt` 与 SQLite `task_projects.updated_at` 比较，旧快照不得回退刚在本机修改的名称/颜色。
- 快照只包含选择专注与任务调度所需的任务 ID、来源、标题、项目、优先级、开始/截止时间、标签、父子关系、完成状态和结构化循环；不包含任务正文、原始 JSON、CLI/OAuth 凭据或第三方写入能力。Checklist 子项在传输时展平并保留 `parentId`。循环定义含 IANA timezone、日/周/月/年频率、interval、ISO weekday/month day、endAt/count 与 rollover；`completedCount` 只由 authority 推进。
- 云端按账号保留最后一份完整快照，内容相同的同设备重放不增加 revision。Web/PWA/Android 使用 `GET /sync/v2/tasks` 读取并写入 IndexedDB；PC 关闭或任务服务暂时不可达时继续使用最后一次缓存。
- 任务快照 GET/POST 必须 `Cache-Control: no-store`；`publishedAt` 只是客户端排序提示，Account DO 与 loopback 必须只接受 `publishedAt <= serverTime + 5 分钟`，超限统一返回 HTTP `422` / `task_snapshot_timestamp_too_far_ahead`。已保存且超出该窗口的旧快照是 legacy far-future 状态，下一份合法快照可替换它；正常 register 保持相同 source/payload 幂等、较旧 timestamp 为 `409 stale_task_snapshot`、同 timestamp 异文为 `409 task_snapshot_conflict`。移动端前台每 5 秒自动拉取，并在恢复可见、窗口聚焦、pageshow、登录或连接 epoch 变化时立即拉取。revision 只能前进：低 revision 响应不得覆盖缓存；同 revision 若 source/payload 不同视为 authority 不一致并保留当前快照。移动端首次创建前必须确认最新 GET；`revision=0/snapshot=null` 才能建立稳定 `local-inbox` 首写，禁止空快照覆盖已有 register。桌面端强制 refresh 在当前 connection scope/generation 内等待 pending snapshot 发布尝试；成功回读同一 source device/payload 或 stale 才可清除 durable pending，conflict、第二次 422、GET/解析/重试失败或连接变化均必须保留 pending，不能递归重试。
- 移动端开始实时会话时可以携带快照中的任务上下文，也可以不关联任务自由开始。任务上下文最终进入 completed bundle，PC 拉回后仍由桌面端执行 dida/TomaToDo 副作用。
- 移动端不直连滴答，只读写同一 FocusLink 账号任务快照；任务创建、完成、清单改色/重命名与任务移动均是完整快照 mutation，成功回读后才更新 IndexedDB 缓存。
- 云端 MCP 的 FocusLink 自有任务工具直接读写同一 Account DO `task_state` 快照寄存器，不另建 MCP/D1 任务源。`focuslink_get_current_time` 以 Account DO `serverTime` 返回指定 IANA timezone 的 UTC/local 时间、offset 和当天边界；`focuslink_list_projects/get_project/list_tasks/get_task` 提供清单/任务读取与筛选。创建/更新/完成/恢复/删除/移动任务以及清单创建/更新/删除均要求 `operationId` 与 `expectedRevision`。Account DO 在同一持久化事务中执行 revision CAS、循环推进和 `task_operations` 幂等账本：旧 revision 返回冲突且不覆盖，重放返回 `duplicate`，清单删除始终将任务/子树移入 `local-inbox`，任务删除才永久删除目标子树。MCP 返回只含稳定 ID、revision、结果计数等脱敏确认；公网 MCP 继续遵守 2026-07-28 discovery，写调用需要 `focuslink:read focuslink:write`。
- `task-scheduling-v1` 通过 `x-focuslink-task-capabilities` 协商。新客户端读取 `startDate/recurrence`；无 capability 的 0.12.104 客户端得到严格旧 shape。旧整包写回由 authority 合并保留调度字段并拒绝无法一致合并的日期，防止旧设备静默抹掉循环。CLI 复用 canonical `/sync/v2/tasks{,/mutate}`，从 `fl2` 派生并校验 deviceId；OAuth access token 只供 MCP，不供 CLI。

## 9. 小窗与边缘状态

- 只有 `collapsed` 和 `expanded` 两种合法尺寸，数值唯一来自 `shared/miniWindowLayout.ts`。当前为 `184×44` 与 `256×70`，不引入第三尺寸；44px 收起高度避免 Windows 原生无框最小高度与 renderer 内容尺寸错位，常量变化必须同步更新前端规范。
- `MiniWindowDockPlacement` 在四条边之外区分四个 corner placement；角落收起/展开必须同时锚定 X/Y 两轴。主进程通过 `mini:dock-transition` 明确发送 `prepare / settled / cancel` 与 edge/placement，renderer 不得从 CSS 猜测原生屏幕位置。
- Windows 原生移动循环结束后才允许吸附与收起；纯展示进度轨必须保留 `-webkit-app-region: drag`。用户拖离 release hysteresis 后在新位置展开，任何 programmatic bounds 变化都不得被误判为新的用户拖动。
- collapsed renderer 契约仅允许进度/状态、当前时间、底部 2px 当前分钟秒级消逝轨和展开入口；该轨不是专注率。不传达任务详情、三组累计或其他控制。expanded 契约须在 74px 内容盒内完整呈现任务名、当前时间、累计专注/暂停/总历时与全部控制，时间与按钮分属独立网格行、结构上不重叠或换行。验收字号为 collapsed 25px、expanded 至少 21px。
- Electron 主进程持有真实 bounds、当前显示器 work area、吸附边缘和窗口状态。
- Windows 通过 `WM_ENTERSIZEMOVE` / `WM_EXITSIZEMOVE` 明确区分按住与释放；按住不动时不得用 move 事件静默时间猜测释放。真正结束后才计算最近合法边缘，使用进入 14px / 离开 30px 双阈值；先吸附并保持 expanded 尺寸，renderer 接收 `mini:dock-transition` 显示 320ms 收束反馈，之后才切换 collapsed；过渡中再次 native move 必须取消待折叠任务。程序化 bounds 允许 2px DPI 归一化误差。
- 展开必须向 work area 内部生长并校正坐标；多显示器、负坐标和不同缩放比均要覆盖。
- 拖离所有边缘 140ms 后自动展开；点击箭头立即展开并设置 900ms 防回弹。换尺寸时固定接触边并围绕视觉中心调整位置。
- 手动展开、显式收起、主题/状态变化和重启恢复通过稳定事件广播，不由 renderer 猜测 native resize。
- 不恢复 freeform resize。旧宽高在设置迁移时归一化到最近合法预设。

## 10. renderer 健康、日志与托盘生命周期

- 主窗和小窗都监听 `unresponsive`、`responsive`、`render-process-gone` 和 `did-finish-load`。短暂阻塞先给 5 秒恢复窗口；仍无响应时用 `reloadIgnoringCache()` 重建 renderer。
- 受控恢复每 60 秒最多 3 次，超限后等到时间窗重置，禁止无界重载循环。计时器、session 和 SQLite 事实留在主进程，renderer 恢复不能终止当前专注。
- 日志元数据序列化必须保留 `Error.name/message/stack/cause`，支持 bigint 与循环对象降级；不得再把未捕获异常记成无信息的 `{}`，日志失败也不得触发第二次异常。
- HTTP 错误必须先包装成 Error 再进入日志，至少保留 status、协议 code 与安全截断的 message；禁止 `throw { code, message }` 后退化为 `[object Object]`。实时 start 失败必须记录是否执行本地降级，且日志不得包含 bearer token。
- 托盘、快捷键与主 snapshot 广播的运行时初始化必须幂等。窗口 `ready-to-show` 与已加载回退竞态只能创建一个托盘和一份 snapshot 监听；设置更新不重建托盘。退出时解除可解除监听并销毁托盘。

## 11. 数据安全与迁移

- schema 迁移单调、幂等，在事务中执行；禁止无版本地重写用户数据库。
- 删除 session/segment 使用事务并协调两个外部同步域。外部清理失败时保留足够本地事实供重试。
- OAuth/token 使用系统安全存储或既有凭据层，日志和导出不得包含密钥。
- 回归/自测只使用隔离的 `test-data` 或临时目录，不打开用户真实 Electron/FocusLink 数据。
- 用户数据导出支持 JSON/CSV/Markdown，但导出不改变同步状态。

## 12. 状态文案契约

- `已关联 / 未关联`：本地 task id 是否存在。
- `已同步 / 未同步 / 同步失败`：dida 队列是否得到云端可验证结果。
- `已写入本地 / 待上传 / 上传已确认`：番茄 To-do 两阶段状态；“上传已确认”不得解释为独立云端回读或远端可删除。
- session 没有默认任务但存在已关联 segment 时，摘要不能显示“未关联”。
- 禁止“可同步”“应该成功”等无法证明结果的状态。

## 13. 变更规则

- 计时语义变化：更新状态机/manager、shared selector、数据库、恢复测试和 45+5+45 场景。
- 任务能力变化：更新 CLI 优先/OAuth 后备连接策略、IPC、`completedAt` 缓存、分阶段加载、任务页、6 秒撤销与失败回滚测试。
- dida 写入变化：保留 argv、comment-first、父 checklist、marker、undefined 失败，并执行真实临时任务验收。
- 番茄变化：分别验证后台不启动外部应用、手动同步在未运行时用参数数组和端口 0 按需启动、已普通运行时绝不杀进程、身份校验、上传接口确认、学科修改和本地 marker 删除；独立云端回读/远端删除只有 API 真正提供后才能加入门禁。
- 小窗变化：同步 shared 常量、settings 迁移、Electron bounds、CSS 和 smoke；不把数字复制到文档以外的多处代码。
- 统计/生命周期变化：覆盖详情 request id、tick 渲染边界、renderer 恢复预算、Error 序列化和托盘监听幂等性。
- 发布变化：执行 [TEST_AND_RELEASE.md](TEST_AND_RELEASE.md) 的全部门禁并推送 `main`；只有用户明确要求时才创建公开 tag 和 GitHub Release。

## v1.3.20 统计 renderer 读取与关联边界

v1.5.1：任务创建只传用户指定的选项；未传 dueDate/startDate 时 local provider 保持 null，不能从智能视图推导今天截止。主任务 renderer 将可见排序组插回完整根任务槽位，reorder 请求保留完整根 ID 顺序、不写 children/parentId/日期；跨完成组/跨父级拒绝。createProject/updateProject API 不变，表单只替代不受支持的 renderer prompt。

v1.5.0：列宽和显示排序存于各 renderer 的独立本机偏好，不声称跨设备同步；子任务自定义顺序复用 `tasks.reorder` 的 local provider 边界，提交同一父任务的 sibling ID 数组，保留 parentId/任务正文，失败后重新读取。不新增排序服务或 SQLite 表。版本下一步由 `releaseVersionPolicy.ts` 按 patch 0–9 计算，build guard 拒绝 patch≥10，Android versionCode 保持单调。

v1.3.21：已激活与初次建立的 Sync v2 checkpoint 都先无 mutation 拉取，再推送；旧待发操作仅在同连接 scope、deviceId 等于本机 legacy 安装 ID 时路由到当前已认证设备，opId/payload 保留。结束 ACK 与本机账本导入是独立事实；确认结束后的导入失败仅标记 ledgerImportPending，保留 authority 状态，不造本地记录，也不把导入异常改为结束命令失败。状态变更按实际状态广播，不能对每秒 tick 发统计重取。

统计详情复用 `sessions.get` / `sessions.export`，不修改计时、同步协议或数据库结构。详情 effect 以会话 ID 为依赖，清空旧 projection 并拒绝取消后的迟到响应。分类以 analytics task key/ID 与 timeline session ID 匹配，排行以任务 ID 寻找会话，不能把任务排行下标当成会话下标。

已结束会话 `linkSessionTask` 只写默认任务，不自动改片段。因此 renderer 显式随后调用 `linkSegmentsBatch(..., onlyUnlinked=true)`；已经关联的片段保持原任务。独立片段走 `timer.linkTask`。两个调用不是原子事务；任一步失败都重新读取真实状态并呈现失败，不宣称全量关联成功。未增加滴答写入路径。

## v1.5.2 任务页内存快照边界

任务页切换视图时会整体卸载，renderer 在模块作用域保留最近一次成功加载的 `{ tasks, projects, sessions, selectedTaskId }` 快照，用于重新挂载时的同步首帧渲染。

## v1.5.3 renderer 确认弹窗边界

删除确认从原生对话框改为应用内弹窗后语义不变：确认才调用一次 `tasks.remove` / `tasks.deleteProject` / `deviceSync.revokeDevice`，取消不发任何写请求；删除清单仍由主进程把关联任务移到收件箱。renderer 不新增 IPC 通道，也不改变失败重试与 toast 反馈。原生对话框禁令由 `tests/rendererNativeDialogGuard.test.ts` 固化，避免「删除即假死」这类只在打包环境出现的缺陷回归。
这是 renderer 表示层缓存：不落盘、不新增 IPC、不改变 `tasks.refresh` 的调用时机与返回结构，也不参与设备同步；后台刷新成功后照常覆盖快照，失败时保留快照并结束骨架态。自动选中任务从「refresh 以 selectedTaskId 为依赖」改为函数式更新，避免每次选择都重新拉取整棵任务树。展示层只新增清单标签与到期标签样式，任务、清单、日期写入口径与 v1.5.1 一致。

