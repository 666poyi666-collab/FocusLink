# FocusLink v1.10.5

> 发布日期：2026-11-04
>
> 对应提交：`f590e4d`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 构建说明：包内 `APP_COMMIT` 为 `f590e4d`，不含 `-dirty`；安装版 `app.asar` 与便携版启动回读一致。
>
> 验证状态：源码门禁、打包启动自检、Windows 静默覆盖安装与可见性回读、小米同版安装回读、`/v1` 建清单/建任务真实写入与幂等重放均已实测；华为平板本轮不在线

## 主要变化

- **能建清单了**：新增 `POST /v1/projects`（`name` 必填，`color`/`icon` 可选）与 `GET /v1/projects`，返回真实 `id`。
- **能建任务了**：新增 `POST /v1/tasks`（`title` 必填，`projectId` 省略时落到收件箱），返回 `id`、清单名与状态，可直接用于 `POST /v1/sessions/:id/task` 关联会话。
- **复用现有任务模型**：写入走 `electron/tasks/localProvider.ts` 的 `createProject` / `create`，并执行与 IPC 相同的任务工作区提交与 `tasks:changed` 广播；创建类请求支持 `operationId` 幂等，重放返回首次结果并带 `duplicate: true`。
- 仅新增本地 `/v1` 接口；桌面界面、同步协议、番茄同步与移动端不变。

## 验证

- 源码：`format:check`、`typecheck`、`lint` 退出码均为 0；`npm test` 181 个文件 / 1580 个用例全部通过；`npm run dist` 在本干净提交上产出安装版与便携版。
- 打包自检：`npm run verify:packaged` 退出 0，便携版回读 `version=1.10.5`、`commit=f590e4d`。
- 包内元数据：安装版 `app.asar` 的 `dist-electron/main-BdSr6gl9.js:987` 为 `f590e4d`、版本 `1.10.5`，全部 `dist-electron` 文件 `-dirty` 出现 0 次。
- **`/v1` 真实写入实测**（安装后真实进程）：
  1. `GET /v1/projects` 返回 200，6 个清单；
  2. `POST /v1/projects {"name":"数心一轮","color":"#2f6fed"}` 返回 201，`id=ac575052-92f8-4abd-88a4-f4928df1d163`；
  3. 同一 `operationId` 重放返回 201、同一 `id`、`duplicate=true`，没有新建第二个清单；
  4. `POST /v1/tasks {"projectId":"ac575052…","title":"第三节 函数值域"}` 返回 201，`id=9f9f67e1-c34f-4d3d-b8aa-67af3c0a109a`、`projectName=数心一轮`、`status=incomplete`；
  5. 同一 `operationId` 重放同样返回同一 `id`、`duplicate=true`。
- Windows：`installer /S` 退出 0；注册表 `DisplayVersion=1.10.5`，已装 `FocusLink.exe` 文件版本 `1.10.5`；可见性冒烟通过（pid 19440 / handle 992946）。
- 小米 22041216C：设备 IP 从 `192.168.1.5` 变为 `192.168.1.4`（serial `D68P65855TPBHYWS`，`firstInstallTime` 与上版一致，确认为同一台），`adb install -r` 退出 0，回读 `versionName=1.10.5` / `versionCode=1381`，`lastUpdateTime=2026-11-04 05:51:24`，`firstInstallTime` 保留 `2026-09-10 16:56:24`。
- Android 单测：`:app:testDebugUnitTest` 41 个用例 / 0 失败（含 `FocusLinkConfigTest` 断言 `1.10.5`）；APK 备份 `33,901,008` 字节，SHA256 `6ed95bd8548b02e7c9bb75d0d518bc5f65da947e7d550daa43f730818d29c544`。
- 华为平板：`adb devices -l` 中未出现；按 2026-10-29 用户指令本轮只要求 Windows + 小米同版，平板未安装，不声称已安装。

## 升级提示

- Windows 直接覆盖安装；安装后回读卸载注册表与已安装 EXE 版本，再重启应用。
- 从 v1.10.4 升级只新增清单/任务创建接口；账本数据、界面行为与移动端不变。
- 小米设备 IP 可能变化：安装前先用 `firstInstallTime` 确认是同一台，再显式 `-s <serial>` 安装。

## 已知限制

- 创建的清单/任务没有删除接口；需要删除时请走界面。
- `POST /v1/tasks` 只接受平铺字段（`title` / `projectId` / `parentId` / `dueDate` / `priority`），不接受标签、循环等完整任务字段。
- 批量 `/v1/sessions/batch-update` 仍无全有全无：`atomic: true` 直接拒绝，逐条失败不回滚。
- 华为平板本轮未参与同版门禁；恢复华为门禁前需要用户明确要求。
- 仓库路径含中文时，Android 单测需要进程级 `JAVA_TOOL_OPTIONS=-Dfile.encoding=GBK`，否则测试 argfile 解码失败报 `ClassNotFoundException`。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.10.5-x64.exe` | `3c4cdd87ae2d5042aecea089dac5fde3fa3bc20dbd4c5ad85c50634ee5cbe9d3` |
| `FocusLink-1.10.5-x64-portable.exe` | `ef1719c397c9ac50eae472e9432d448105b0694c40d0ad2645432b4af6010081` |

同时提供 `SHA256SUMS.txt`。
