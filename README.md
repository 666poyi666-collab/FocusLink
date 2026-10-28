# FocusLink

FocusLink 是一个本地优先的专注与任务工作台：主进程精确记录专注、暂停与自然跨度，任务、清单和层级由 FocusLink 自己管理；第三方任务服务只在你主动选择导入或同步时出现。

> 当前版本：v1.8.7
>
> 1.7.6 用 REA（morluto/rea）反查滴答清单真机界面后，把移动端任务页按滴答清单复刻：浅灰底 + 白色圆角面板、圆形优先级复选框、44px 行高、右侧红色延期天数、父任务展开箭头、蓝色新建按钮、清单抽屉与底部四项导航；另有 root 一键授权并把悬浮计时改成顶部胶囊（长按可拖、点按回应用）。数据与同步语义全程未改。
>
> 版本主题：本地优先的专注账本 · 三端同一套界面 · 交付管线可验证

## 产品边界

- 专注计时与崩溃恢复。
- Session / Segment / PauseEvent 三层时间账本。
- FocusLink 自有任务、清单、父子层级、完成记录与专注关联。
- 第三方任务导入/专注同步与番茄 To-do 本地优先云补传（均为显式可选能力）。
- 实验性的 FocusLink 跨设备账本同步，以及共用一套界面的 Web/PWA/Android 实时专注控制台。
- 主窗口、托盘、全局快捷键和固定两态小窗。

FocusLink 不是聊天应用、营销页或通用仪表盘。界面和实现规范分别以 [前端设计](FocusLink/frontend-design/README.md) 与 [后端设计](FocusLink/backend-design/README.md) 为准。

## 三时间模型

| 字段              | 含义                     |
| ----------------- | ------------------------ |
| `activeElapsedMs` | 真正专注时长，不含暂停   |
| `pauseElapsedMs`  | 暂停累计                 |
| `wallElapsedMs`   | 会话开始到结束的自然跨度 |

例如 45 分钟专注、5 分钟暂停、45 分钟专注，结果固定为 90 分钟有效专注、5 分钟暂停、95 分钟总历时。暂停后继续会创建新 Segment，并继承会话默认任务。

## 快速开始

环境：Windows 10/11、Node.js 22.x、npm 10.x（当前门禁基线为 Node 22.22.2 / npm 10.9.9）。SQLite 原生依赖按 Node 22 与 Electron ABI 构建，不要使用 Node 24 安装依赖。

```bash
cd FocusLink
npm install
npm run dev
```

常用命令：

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run dist
```

多端纵向切片的开发命令：

```bash
npm run dev:cloud   # 需先设置 FOCUSLINK_CLOUD_TEST_TOKEN
npm run dev:web
npm run build:web
npm run build:cloud
npm run android:sync
```

完整测试、真实外部服务和发布门禁见 [FocusLink/backend-design/TEST_AND_RELEASE.md](FocusLink/backend-design/TEST_AND_RELEASE.md)。

## 任务与同步

### 滴答清单 / dida CLI

FocusLink 的任务页固定表达“滴答清单”，不再把本地、CLI 和 OAuth 显示成并列的任务来源。CLI 与 OAuth 只是连接方式：刷新时先探测 dida CLI，不可用时才使用已登录 OAuth。CLI 按以下顺序解析：

1. 设置中的手动 executable。
2. 用户 npm 全局目录内 dida 的真实 Node 入口。
3. 当前环境 PATH。

写操作使用参数数组，不把中文、换行或 JSON 拼入 shell。专注摘要优先写任务评论，失败才回退到任务正文；每个片段使用 `[FocusLink:segment:<id>]` marker 去重。checklist 子项通过父任务 `items` 更新，不伪装成普通任务。

任务工作台首次只加载活动任务；已完成历史按需读取近 30 / 90 / 365 天并以 `completedAt` 稳定排序。完成后有 6 秒一键撤销，之后仍可在已完成列表找到并恢复；超长列表以每批最多 120 项逐步显示。

FocusLink 自有普通清单可在电脑、手机和平板确认后删除；任务和子任务会原子迁入不可删除的收件箱，不会静默丢失。云端 `foxlink-cloud-mcp` 也直接管理同一任务快照，支持清单/任务读取、创建、更新、完成、恢复、删除和移动，以及开始/截止时间、优先级、标签、父子关系和结构化循环；写入使用 `operationId` + `expectedRevision`，冲突不覆盖。循环支持日/周/月/年、间隔、星期/月日、结束时间、总次数、按计划或按实际完成时间顺延，完成次数由云端权威维护。

### FocusLink MCP / CLI

ChatGPT 网页端连接 canonical `/mcp` 后，可调用 `focuslink_get_current_time` 获取指定 IANA 时区的云端时间、UTC 偏移和当天边界；清单与任务工具支持查询、增删改、移动、完成/恢复、优先级、开始/截止日期、标签、子任务与循环规则。MCP 读取需要 `focuslink:read`，写入同时需要 `focuslink:write`；每次写入仍需稳定 `operationId` 和刚读取到的 `expectedRevision`。

本机脚本使用同一 mutation 合同，但凭据边界不同：CLI 只接受绑定设备的 `fl2` 凭据，不接受 OAuth access token。先设置 `FOCUSLINK_ENDPOINT` 与 `FOCUSLINK_DEVICE_TOKEN`，再运行：

```bash
npm run focuslink -- time --timezone Asia/Shanghai
npm run focuslink -- projects list
npm run focuslink -- tasks list --project-id inbox --include-completed
npm run focuslink -- tasks create --title "每周复盘" --priority 5 --due "2026-09-04T20:00:00+08:00" --frequency weekly --weekdays 5 --repeat-count 8
```

CLI 输出 JSON；写入会先读取 revision，并允许用 `--operation-id` / `--expected-revision` 显式固定幂等与 CAS。完整参数运行 `npm run focuslink -- --help` 查看。

### 番茄 To-do

FocusLink 先以稳定 marker 原子写入本地 PCRecord，再通过经过身份校验的原生桥批量上传。用户手动同步时，若番茄 To-do 未运行，FocusLink 可以使用参数数组按需启动客户端并指定 `--remote-debugging-port=0`，只在标题与特征 API 都通过后连接。若客户端已以普通模式运行却没有可验证桥接，FocusLink 绝不自动杀进程或重启，界面会要求完全退出番茄 To-do 后再连接。FocusLink 启动和后台周期重试只会使用已存在的可验证桥，不会擅自启动外部应用。

只有 `cloudSyncUploadRecord` 明确返回 success 且本地同步状态持久化后才记为“上传已确认”。已有 marker 的学科修改若暂时无法写入番茄桥，会进入持久补传队列，旧学科的 `isSynced=1` 不会冒充新学科已上传。当前番茄 To-do 1.6.2 不提供专注记录的独立云端回读或远端删除接口，诊断会明确区分“上传已确认”和“本地 marker 已清理”；清理结果固定为 `local-record-only`，不会虚报云端回读/删除。无法识别学科的 FocusLink 记录归入“学习”，不会迁移用户的其他记录。

### FocusLink 跨设备同步（单账号 · 设备授权绑定）

FocusLink 使用**一个账号、多台设备**的模型：账号就是你的 FocusLink 账号（`Poyi`），数据在所有设备间通用。
已绑定的设备包括这台 Windows 电脑、华为平板与小米手机。OPPO 手表已退役，不再开发或纳入新版本绑定/发布验证。绑定的含义是：每台设备
用自己的安装身份（installationId，重启、重装 App 后不变；恢复出厂或换机后需重新授权）向云端登记，获得各自的
`fl2` 设备凭据，之后这台设备就固定属于该账号。

**登录 = 设备授权，不是输入账号密码。** 手机/平板上点「登录」后，设备会打开云端授权页面
（`/owner/device-registrations`，需要主人用一次性验证码在网页上确认），你在网页上点「允许」，云端就给这台
设备签发凭据并开始自动同步；同一账号的数据（专注账本、任务关联）在所有已绑定设备间通用。

桌面端可把已结束的 Session / Segment / PauseEvent 原子账本上传到云端，Web/PWA 与
Capacitor Android 使用同一界面按服务端 cursor 增量拉取，并在 IndexedDB 保留离线缓存。
同一账号仍只有一个云端活动会话；Web/Android 在电脑或服务不可达时也可新建独立 UUID 的
本机会话并完整暂停、继续和结束。重连发现不同云端活动 UUID 时，本机会话进入 `forked-local`：
本地与云端分别保持自己的控制域、结束并入账，不互相覆盖或拼接。结束的本机会话先原子写入
IndexedDB 队列，只有 `applied/duplicate` 才出队；冲突和拒绝保留为可诊断记录。

Cloudflare Sync v2 的 Account DO 是跨设备数据事实源。电脑任务快照以 `publishedAt` 作为单调
register：同一来源/内容可幂等重放，较旧时间戳或同时间的不同内容均被拒绝，移动端只接受更高
revision。传输 checkpoint 继续按 endpoint + device token 隔离；dida/TomaToDo 回写队列在 canonical
`fl2` 下按 endpoint + accountPublicId 的匿名 scope 分桶，以便同账号轮换 Windows device token 后
继续消费原有工作；legacy loopback 仍按凭据分桶。

Android 壳只提供可见前台通知、暂停/继续/结束动作、快捷设置 Tile 与至少一次原生命令队列；业务
状态机仍在共享协议和 Web 层，陈旧 session/revision 动作不会作用于下一轮。移动端不直接执行 dida
或番茄 To-do 投递，也没有接管 Electron 桌面计时；结束账本同步回桌面后，第三方投递仍需在桌面端
真实操作并确认。

`FocusLink/cloud/` 只保留 loopback-first 合同测试后端，启动必须显式设置测试 token，禁止公开部署。
生产客户端固定访问 canonical HTTPS gateway 与私有 Account DO authority，不运行内嵌同步服务、ADB
reverse 或 LAN bearer。现有 `fl2` 设备凭据可继续同步；全新设备的公网账号 bootstrap 由
`foxlink-cloud-mcp` gateway 提供（owner 批准后才签发凭据），云端未部署时会明确报告 `not-deployed`，
不能把本地合同测试冒充为已经上线。

如果安装后看到 `timer:start-with-task` / `TypeError: fetch failed`，应先确认设备仍登录同一 FocusLink
账号并运行 `npm run probe:account-bootstrap` 区分连接故障与 gateway 未部署。首次实时握手成功前
桌面计时保持本地可用；已确认云端为空闲而后续传输失败时也会自动回到本机计时，活动云端会话则继续
锁定云端事实源。状态、健康检查和错误编号见 [同步错误索引](FocusLink/backend-design/SYNC_TROUBLESHOOTING.md)。

三个同步域互相独立。本地任务关联、FocusLink 多端账本、滴答投递和番茄上传在界面上使用不同状态文案。

## 界面与稳定性基线

- 默认亮色为「时间仪器」单一工作面：连续浅色画布、1px 发丝线分区，无圆角卡片墙、玻璃拟态与环境动效层；暗色为同一 token 体系映射，主题仅明亮/深色/跟随系统。
- 五种强调色会同时驱动导航、按钮、任务选中态、统计图、专注读数与时间之带；暂停红和危险深红保持独立，不再出现跨页面蓝绿割裂。
- 界面提供 Noto Sans SC、思源宋体、霞鹜文楷、霞鹜新致宋、霞鹜漫黑、霞鹜新晰黑、得意黑与站酷快乐体八套本地字体；选择态、导航与仪表统一跟随全局强调色。
- 翻页机械从零改为 `steady → fold → unfold → commit` 状态机，动画中只保留最新目标，idle/finished 与 reduced-motion 静态提交；像素点阵升级为高对比 7×9 整数网格，标准仪表改成固定数字槽工业读数。
- 时间之带是单一 canvas：专注秒级近景、暂停远景都按秒更新，状态转换使用 720ms 变焦；暂停边界以分批碎片、尘点、短火花和余烬光层表达时间消散，孔洞只保留为低密度痕迹，idle/finished 在最后记录锚点冻结并停止持续重绘。
- 统计页重构为顺读日报：结论与四项 KPI、深夜/上午/下午/晚间五时段的 24 小时三轨地图、当前时刻、每轨累计、多日专注/暂停堆叠日柱、百分比守恒的任务构成带和暂停损耗；最近会话只保留下方唯一账本。
- 沉浸模式以原生全屏呈现当前任务、仪表、累计三项、控制与占屏 36% 的时间之带，进入使用 520ms 收束展开过渡，Esc 退出。
- renderer 无响应时在有界预算内受控重载，主进程计时不中断；日志保留 Error 的 name/message/stack/cause，托盘与 snapshot 监听只初始化一次。
- 小窗尺寸保持收起 `184×44`、展开 `256×70`；展开态以主时间/60 格秒轨和三项累计/控制组成紧密双区，完整任务与窗口操作保留在上栏。暂停粒子复用主时间之带的确定性消散模型，从真实秒轨前沿分批漂移、缩小并熄灭；长任务名在字体切换后重新测量。拖拽释放后先吸附，再播放 320ms 收束过渡后折叠。

## 项目结构

```text
focuslink/                  # 仓库根
├── FocusLink/              # 唯一源码工作区
│   ├── src/                # renderer：app / features / ui / styles
│   ├── electron/           # 主进程、SQLite、计时、Provider、同步和系统能力
│   ├── shared/             # 跨进程类型、IPC API、尺寸常量和纯策略
│   ├── cloud/              # FocusLink 跨设备同步测试后端
│   ├── mobile/             # PWA 入口、manifest、service worker 与静态图标
│   ├── android/            # Capacitor Android 壳，不复制 TypeScript 业务逻辑
│   ├── tests/              # 自动化回归
│   ├── scripts/            # build / regression / smoke
│   ├── frontend-design/    # 唯一前端设计与交接规范
│   └── backend-design/     # 唯一后端、测试与发布规范
├── .github/                # Issue 表单、Release notes 模板与发布记录校验 workflow
├── release-v*/             # 最近三个版本的本地正式资产（只有 RELEASE_NOTES.md 入库）
├── AGENTS.md               # AI 必须遵守的仓库规则
└── CHANGELOG.md            # 全版本变化历史
```

不要重新创建 `docs/`、`backend/`、`shared-contract/`、设计归档或一次性修复报告。可再生成的 `dist/`、`dist-electron/`、`dist-selftest/`、`test-data/` 和结果 JSON 不属于项目结构。

## 架构摘要

```text
React renderer
  -> window.focuslink
  -> context-isolated preload
  -> validated IPC
  -> timer / task / sync services
  -> SQLite / dida / TickTick / 番茄 To-do / Windows
```

- renderer 不直接访问 Node、数据库、文件系统或 shell。
- Electron 主进程持有计时、窗口和外部副作用事实。
- `FocusLink/shared/ipc/api.ts` 是 renderer API 的唯一类型真值。
- dida 队列与番茄补传先保证本地持久化，再异步收敛云端。
- `FocusLink/shared/sync/deviceProtocol.ts` 是 Web/Android/桌面跨设备传输契约；它与 Electron IPC、dida 队列分开。

## 数据与日志

| 类型          | 默认位置                             |
| ------------- | ------------------------------------ |
| 安装版 SQLite | `%APPDATA%/FocusLink/focuslink.db`   |
| 安装版设置    | `%APPDATA%/FocusLink/settings.json`  |
| 日志          | `%APPDATA%/FocusLink/logs/`          |
| 便携版数据    | 可执行文件同目录的 `focuslink-data/` |

回归和自测必须使用隔离目录，不得读取或修改真实用户数据。凭据不写入日志或导出。

## 发布资产

安装包永远不进入 Git。Git 只保存源码与可核对的发布记录（`RELEASE_NOTES.md`、CHANGELOG、版本源），安装包只作为 GitHub Release 附件分发，所以仓库不会每发一版就增重 800 MB。

每个本地 `release-vXYZ/` 目录只保留四类文件；目录整体被 `.gitignore` 忽略，只有 `RELEASE_NOTES.md` 会被跟踪：

```text
FocusLink-x.y.z-x64.exe
FocusLink-x.y.z-x64-portable.exe
SHA256SUMS.txt
RELEASE_NOTES.md
```

本地只保留最新三个版本目录：

| 版本  | 状态                                   | 版本说明                                                       |
| ----- | -------------------------------------- | -------------------------------------------------------------- |
| 1.6.8 | 当前：切页不卡（仅 Windows）           | [release-v168/RELEASE_NOTES.md](release-v168/RELEASE_NOTES.md) |
| 1.6.7 | 前版：去重减负                         | [release-v167/RELEASE_NOTES.md](release-v167/RELEASE_NOTES.md) |
| 1.6.5 | 前版：小窗真实双列架构精工             | [release-v165/RELEASE_NOTES.md](release-v165/RELEASE_NOTES.md) |

1.6.6 是只改交付管道与仓库清理的补丁，没有产生安装产物，记录只保留在 `CHANGELOG.md`。

这些版本尚未创建公开 tag 或 GitHub Release（公开发布需要用户明确授权），因此没有下载链接。授权后按 [测试与发布门禁](FocusLink/backend-design/TEST_AND_RELEASE.md) §5 执行 `npm run release:publish`，由它创建 tag、上传三个附件并回读核对；只推送代码或 tag 不算发布完成。

每次版本迭代必须同步更新 `CHANGELOG.md`、本地 `RELEASE_NOTES.md`、四文件发布目录、版本源与 Android 版本元数据，并推送 GitHub `main`。
## 文档入口

### 前端档案

- [前端分类入口](FocusLink/frontend-design/README.md)
- [界面与交互单一真相](FocusLink/frontend-design/FRONTEND_SPEC.md)
- [前端实现与视觉验收清单](FocusLink/frontend-design/AI_HANDOFF_CHECKLIST.md)

### 后端档案

- [后端分类入口](FocusLink/backend-design/README.md)
- [架构、数据与同步单一真相](FocusLink/backend-design/BACKEND_SPEC.md)
- [测试与发布门禁](FocusLink/backend-design/TEST_AND_RELEASE.md)
- [后端实现与交付清单](FocusLink/backend-design/AI_HANDOFF_CHECKLIST.md)
- [完整版本历史](CHANGELOG.md)

### 当前发布

- 本地 1.6.6 资产：[release-v166/RELEASE_NOTES.md](release-v166/RELEASE_NOTES.md)（未创建公开 tag 或 GitHub Release）
- 历史下载入口：[GitHub Releases](https://github.com/666poyi666-collab/FocusLink/releases)
- [完整版本历史](CHANGELOG.md)
## License

[MIT](LICENSE)
