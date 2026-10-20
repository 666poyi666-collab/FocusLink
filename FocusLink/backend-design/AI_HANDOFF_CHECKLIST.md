# 后端 AI 接手清单

> 所有 `npm` / `node` 命令默认从仓库内 `FocusLink/` 执行。
> 本文件是**唯一**的跨会话交接入口；不要另建一次性 handoff / 修复报告。

## 当前接手状态（2026-10-17，v1.6.6 进行中）

**一句话**：v1.6.6 是「交付管道修复 + 仓库打扫」，产品行为零改动。代码与文档改动已完成并在工作区，
尚未提交；剩 6 步收尾，全部门禁与 Windows 实装通过后才算交付。

### 已完成（工作区未提交，勿回退）

| 事项 | 结果 |
| --- | --- |
| 积压提交 | `git push origin main` 已把 15 个提交推上去，`origin/main` = `35eb3778817c96eac0cbc7bc64b1b2aefc2a1036` |
| 旧发布目录 | 删掉 `release-v1319/1321/155–162`，只留 `release-v163/164/165`（各 4 文件，约 409.7 MB） |
| 文档去重 | `git rm -r docs`（4 文件）；`CLOUD-SYNC.md` 顶部标「历史架构，仅存档」；`backend-design/README.md` 并入原 `PROJECT-STANDARDS.md` 的 5 条产品标准 |
| 根 README | 第 5 行改成 `> 当前版本：v1.6.6`；结构树根名 `time1/` → `focuslink/`；`## 发布资产` 与 `### 当前发布` 重写（只有 notes 入库、未创建公开 tag 或 Release） |
| 发布管线 | 新增 `scripts/release/verify-release-record.mjs`（纯函数 + CLI）与 `.d.mts`；`tests/releaseRecordContract.test.ts` 实测 **10/10 通过**；`.github/workflows/release.yml` 收敛为「发布记录 + 源码门禁」（不再发布）；新增 `scripts/release/publish.ps1`（tag → 推送 → `gh release create` → 回读） |
| 可见性验收 | 新增 `scripts/smoke/launch-and-verify-main-window.cjs`（自己拉起、只读枚举自己进程树、finally 回收并回读 pid 消失）；`main-window-visible.cjs` 加 `FL-INSTALL-012` 只读诊断块 |
| 规则改写 | `AGENTS.md`、`backend-design/TEST_AND_RELEASE.md`、`.gitignore`：安装包永不进 Git，`release-v*/` 只跟踪 `RELEASE_NOTES.md` |
| 版本 | 已同步 1.6.6：`package.json`、`package-lock.json`（两处）、`shared/version.ts`、`electron-builder.yml`（`../release-v166`）、`android/app/build.gradle`（`1.6.6` / `1342`）、`FocusLinkConfigTest.java`、根 README、两份设计文档（`frontend-design/README.md`、`FRONTEND_SPEC.md`） |

### 剩余步骤（按顺序做完即可交付）

1. 写根 `CHANGELOG.md` 的 v1.6.6 顶条、`frontend-design/USER_REQUIREMENTS.md` 的 `FL-REQ-20261017-CLEANUP`、`backend-design/IMPLEMENTATION_LOG.md` 的 2026-10-17 条目。
2. 跑门禁：`npm run format:check`、`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`。
3. `npm run dist` 生成 `release-v166/` 两个安装包 → 计算 SHA256 → 写 `release-v166/RELEASE_NOTES.md`（从 `.github/RELEASE_NOTES_TEMPLATE.md` 复制；本地候选写「候选补丁」+ 真实验证状态）。
4. Windows 实装：`release-v166\FocusLink-1.6.6-x64.exe /S` → 回读卸载注册表 `21cd4128-7715-582c-bf2a-6446eb8ab7a5` 的 `DisplayVersion` 与 `%LOCALAPPDATA%\Programs\FocusLink\FocusLink.exe` 的 `FileVersion` → `npm run smoke:window-visible` → `npm run smoke:window-visible:launch`（必须打印 `cleanup pid=… removed=true`）。
5. 回填 notes 与实施日志里的真实哈希；`npm run release:verify` 必须全绿；`git status --short` 只应剩预期改动。
6. 提交并推 `main`：`git add -A` 之后检查**不要**包含任何 exe/portable/SHA256SUMS；三个 `release-v*/RELEASE_NOTES.md` 要入库。

### 关键决策（接手时不要重新讨论）

- **安装包永不进 Git**（用户 2026-10-17 拍板）：Git 只保存源码与发布记录；安装包作为 GitHub Release 附件分发；CI 只做记录与源码门禁，正式发布由本机 `npm run release:publish` 完成。
- **报告格式**按 `AGENTS.md` 的 `Report Output Standard`：结论 / 事实 / 问题 / 改动，事实必须标 `实测` / `证据记录` / `推断`。
- **1.6.6 不做功能**：时间之带留给 1.6.8（草稿已在 `frontend-design/FRONTEND_SPEC.md` §6，原样保留）；番茄投递节流、132 条历史补传、132 条冲突收口留给 1.6.7。

### 已知坑（会浪费一小时的那种）

- `FL-INSTALL-012`：验收脚本必须回收自己拉起的实例。只读枚举通过、日志写着 `visible:true`，都不等于用户桌面可见；遗留实例占住单实例锁时，用户点图标「没反应」。
- `FocusLink/scripts/maintenance/focuslink-report.cjs` 有一处不属于本轮的合法改动（日报新增「待批准」列表），必须保留。
- 本机默认 Node 是 `24.19.0`，项目门禁基线是 Node 22.x；打包前先确认用的是 Node 22，否则包内元数据可能不符合门禁。
- 本轮的两个队友（pipeline / smokereap）中途失联，T4/T5 已由 Lead 亲自完成；不要再把同一任务派给它们。
- `.gitignore` 现在是 `release-v*/*` + `!release-v*/RELEASE_NOTES.md`。改回目录级 `release-v*/` 会重新吞掉 notes，导致发布记录无法入库。

### 接手时不要做

- 不要 `git checkout --`、`git reset --hard` 或覆盖工作区里的未提交改动；这些改动归用户。
- 不要新建平行交接文档、一次性修复报告或 `docs/` 目录。
- 不要在没跑测试的情况下改 `.github/workflows/release.yml` 或 `publish.ps1` 的门禁判据。

## 开始前

- [ ] 完整阅读 [BACKEND_SPEC.md](BACKEND_SPEC.md) 和 [TEST_AND_RELEASE.md](TEST_AND_RELEASE.md)。
- [ ] 阅读 [../frontend-design/FRONTEND_SPEC.md](../frontend-design/FRONTEND_SPEC.md) 的用户可见状态与交互。
- [ ] 查看 `git status --short`；不重置或覆盖用户已有变更。
- [ ] 用 `rg` 找到当前类型、IPC、Provider、数据库和测试，不创建平行实现。
- [ ] 确认测试使用隔离目录，不接触真实 FocusLink、滴答或番茄用户数据。

## 契约变更

- [ ] 类型、`shared/ipc/api.ts`、preload、IPC handler、调用端和测试一起更新。
- [ ] 设置局部更新不会覆盖其他设置域；异步旧响应不会覆盖新请求。
- [ ] 主窗、小窗和托盘收到同一事实广播。
- [ ] 托盘/快捷键/snapshot 监听初始化幂等；重复 ready 事件和设置变更不会累加监听。
- [ ] IPC 返回可证明的结果；空 id、`undefined` 和解析失败均为错误。
- [ ] 统计详情用 request id + 当前 session id 废弃旧响应；统计页不订阅会每秒变化的完整 snapshot。

## 计时与数据

- [ ] 专注/暂停/总历时三种时间没有混用。
- [ ] 暂停、继续、结束和崩溃恢复覆盖短专注及 45+5+45 场景。
- [ ] schema 迁移幂等且事务安全；删除协调队列和外部记录。
- [ ] 未经授权不读取或修改用户真实数据库。

## 任务与同步

- [ ] 任务工作台固定滴答语义，先探测 CLI、不可用时才回退已登录 OAuth；UI 不将连接方式冒充任务来源。
- [ ] 完成与取消完成可逆；checklist 只修改父任务目标 item。
- [ ] `tasks.refresh` 默认只读活动任务，完成历史按需限定 30/90/365 天；活动状态不被历史端点覆盖。
- [ ] `tasks.refresh` 保留实际连接方式与精确错误；`tasks.setCompleted` 返回回读后的规范 Task，并正确写入/清空 `completedAt`。
- [ ] dida Open API 恢复桥只在 CLI 不支持时使用，token 不进入日志、IPC 或诊断，并在写后 GET 验证。
- [ ] dida 写入继续使用 argv、comment-first、marker 幂等和空输出失败。
- [ ] 队列 payload 固定 Provider，限流退避不消耗永久重试次数。
- [ ] 番茄本地写入、上传接口确认与独立云端回读/远端删除没有混为一谈；未识别仍归入“学习”。
- [ ] 番茄手动同步仅在客户端未运行时使用参数数组和 `--remote-debugging-port=0` 按需启动，目标通过标题与特征 API 身份校验后才使用。
- [ ] 番茄已普通运行但无桥时绝不杀进程/重启；后台启动与周期重试绝不擅自启动外部应用。
- [ ] 番茄桥接启动/发现改动已运行无写入的 `npm run smoke:tomatodo:bridge`，验证标准路径、身份校验与不终止已运行普通实例。
- [ ] 真实外部验证使用临时任务/记录，并在结束后清理。
- [ ] FocusLink 跨设备账本与 dida/TomaToDo 队列保持独立；completed bundle 仍只发送已结束 session，不发送第三方凭据、`cloudFocusId` 或桌面本地设置。
- [ ] 实时控制平面以服务端 revision 为权威；command id 重放、id 复用、expected revision 冲突、错误 session、非法迁移和单账号隔离均有测试。
- [ ] finish/abort 原子闭合 segment/pause 并写入现有 completed ledger；进程重启保持活动时间边界与命令幂等，旧 v1 测试存储可迁移。
- [ ] 长轮询有上限，客户端断开会释放 waiter；移动端切账号/页面隐藏/卸载会取消旧请求，不让旧账号快照回填。
- [ ] Android 通知/Tile 只排队带 session/revision 的 native command，原生层不推进计时或在云端确认前翻转状态。
- [ ] 账本 `opId` 重放幂等、revision 冲突、cursor 分页、Bearer 鉴权、CORS 与 1 MiB 上限有契约测试；completed bundle 不携带活动会话字段。
- [ ] 拉回新会话使用单事务导入且不自动触发第三方副作用；远端更新/删除未有显式策略时报告冲突，不静默覆盖。
- [ ] 任务开始/截止/循环字段经 `task-scheduling-v1` capability 协商；旧客户端整包写入保留调度字段，循环完成由 authority mutation 推进，MCP/CLI 调用方不能写 `completedCount`。
- [ ] MCP 当前时间来自 Account DO `serverTime`；CLI 从 `fl2` 派生精确 deviceId，OAuth token 与 device token 不跨边界复用。

## 稳定性与诊断

- [ ] 主/小 renderer 的 `unresponsive`、`responsive`、`render-process-gone` 有受控恢复；5 秒 grace 与每 60 秒最多 3 次的预算有测试或可重复验证。
- [ ] renderer 重载时主进程计时和会话不丢失，不进入无界恢复循环。
- [ ] logger 能序列化 Error name/message/stack/cause、bigint 与循环对象，未捕获异常不再只留 `{}`。

## 交付前

- [ ] 本轮跨端 UI/行为候选已递增补丁版本，Windows、指定华为平板和指定小米手机均安装并回读到同一版本；任一端不一致时停止打包、tag 和发布。用户明确「只开发 PC」的迭代按 `TEST_AND_RELEASE.md` 的 PC 范围例外执行，并在矩阵里如实写 Android 未构建、未安装。
- [ ] 在 [IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md) 与前端 [USER_REQUIREMENTS.md](../frontend-design/USER_REQUIREMENTS.md) 给出 Windows、手机、平板实现/测试/部署矩阵；适用终端缺少结论时不得标记完成。
- [ ] 更新 `BACKEND_SPEC.md`、根 [CHANGELOG.md](../../CHANGELOG.md) 和当前 Release 正文源。
- [ ] 完成 [TEST_AND_RELEASE.md](TEST_AND_RELEASE.md) 全部门禁。
- [ ] 多端改动额外构建 Web/PWA 与测试云；Android 必须通过 Capacitor sync、unit/lint/assemble、前台通知/Tile instrumentation 与华为/小米双机 smoke。
- [ ] 真实 UI smoke 完成“完成 → 撤销 → 再完成 → 完成列表找回 → 恢复”并清理临时任务。
- [ ] release 目录只有安装版、便携版、`SHA256SUMS.txt` 与 `RELEASE_NOTES.md` 四个文件；其中**只有 `RELEASE_NOTES.md` 入库**，三个安装/校验资产只作 GitHub Release 附件。
- [ ] Git commit 元数据干净后重新构建正式包，校验 hash，并跑 `npm run release:verify`。
- [ ] 授权发布时用 `npm run release:publish` 创建 annotated tag、推送 `main` 与 tag、上传附件并回读核验。
- [ ] 未创建 GitHub Release 时，版本不得宣告“已发布”。
