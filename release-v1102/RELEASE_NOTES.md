# FocusLink v1.10.2

> 发布日期：2026-11-03
>
> 对应提交：`cc8cc09`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 构建说明：包内 `APP_COMMIT` 为 `cc8cc09`，不含 `-dirty`；安装版 `app.asar` 与便携版启动回读一致。
>
> 验证状态：源码门禁、打包启动自检、Windows 静默覆盖安装与可见性回读、小米同版安装回读、本地 `/v1` 读写回环验证均已实测；华为平板本轮不在线

## 主要变化

- **本地 `/v1` 补上会话写接口**：`PATCH /v1/sessions/:id` 可改标题、备注、学科、番茄记录名、任务关联与会话分钟数；`POST /v1/sessions` 补录一段已结束专注。写入不再需要点界面。
- **能按名字找任务**：`GET /v1/tasks?q=&projectId=&status=&limit=` 返回本机任务缓存、`externalId` 与所属清单名。
- **任务关联有独立入口**：`POST /v1/sessions/:id/task` 关联、`DELETE` 取消关联；`POST /v1/sessions/batch-update` 一次处理多条会话并逐条返回结果。
- **写入仍走同一条管线**：所有写接口翻译成既有 `records.update` / `records.create` 命令，保留 `409` 版本冲突、`operationId` 幂等回执与修正审计；没有第二条写库路径。
- 仅新增 PC 端本地接口；桌面界面、同步协议与移动端不变，番茄同步仍走批准闸门。

## 验证

- 源码：`format:check`、`typecheck`、`lint` 退出码均为 0；`npm test` 178 个文件 / 1563 个用例全部通过；`npm run dist` 在本干净提交上产出安装版与便携版。
- 打包自检：`npm run verify:packaged` 退出 0，便携版回读 `version=1.10.2`、`commit=cc8cc09`。
- 包内元数据：安装版 `app.asar` 的 `dist-electron/main-BtNfTe0q.js:987` 为 `cc8cc09`、版本 `1.10.2`，全部 `dist-electron` 文件 `-dirty` 出现 0 次。
- Windows：`installer /S` 退出 0；注册表 `DisplayVersion=1.10.2`，已装 `FocusLink.exe` 文件版本 `1.10.2`；`smoke:window-visible` 通过（pid 36032 / handle 796266）。
- **本地 `/v1` 回环实测**（安装后真实进程，凭据自带 `records:write`）：
  1. `GET /v1/capabilities` 返回 `patch-session` / `link-task` / `unlink-task` / `create-session` / `batch-update-sessions` / `list-tasks`。
  2. `GET /v1/tasks?q=第二章` 返回 5 条，含 `第二章第六节`（`9a3be372-…`，清单「数学一本通选必一」）。
  3. 用陈旧 `expectedRecordVersion=999999` 调用 `PATCH /v1/sessions/46e7ed51-…`：返回 `409 VERSION_CONFLICT`（实际 `recordVersion=2`），会话标题与 `updatedAt` 均未改变。
- 小米 22041216C（`192.168.1.5:5555`）：`adb install -r` 退出 0，回读 `versionName=1.10.2` / `versionCode=1378`，`lastUpdateTime=2026-11-03 07:51:31`，`firstInstallTime` 保留 `2026-09-10 16:56:24`。
- Android 单测：`:app:testDebugUnitTest` 41 个用例 / 0 失败（含 `FocusLinkConfigTest` 断言 `1.10.2`）；APK 备份 `33,901,012` 字节，SHA256 `1f20df04bc38aca46f1462795dde64f997fe01461f566adf48dc8e2d39612118`。
- 华为平板：`adb devices -l` 中未出现；按 2026-10-29 用户指令本轮只要求 Windows + 小米同版，平板未安装，不声称已安装。

## 升级提示

- Windows 直接覆盖安装；安装后回读卸载注册表与已安装 EXE 版本，再重启应用。
- 从 v1.10.1 升级只新增本地接口；账本数据、界面行为、番茄同步与移动端均不变。
- 小米使用同一 APK `adb install -r` 原位升级，配对与账号数据保留。

## 已知限制

- **批量不是数据库事务**：`batch-update` 逐条执行、逐条返回；`atomic=true` 只是遇到首个失败就停止，已成功的条目会保留。
- `PATCH` 的 `minutes` 只接受没有暂停的会话；有暂停的修正必须走 `/automation/v1/commands` 的 `records.update` + 完整 `timeline`，否则会把暂停算进有效时长。
- 仍未开放删除、任意 SQL 与远端番茄删除/回读；`remoteDeleteSupported=false`。
- 华为平板本轮未参与同版门禁；恢复华为门禁前需要用户明确要求。
- `focuslinkCloudState` 仍返回 `unknown`（未接 V2 Outbox 投影）。
- 仓库路径含中文时，Android 单测需要进程级 `JAVA_TOOL_OPTIONS=-Dfile.encoding=GBK`，否则测试 argfile 解码失败报 `ClassNotFoundException`；这是环境绕行，不是产品缺陷。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.10.2-x64.exe` | `18b1038b80315a22f1e2e7be71534d5cc646e1dd518a429e475d065b4f273177` |
| `FocusLink-1.10.2-x64-portable.exe` | `f558176e7e5a71a3d75f01858242ee9c1e22d11a05a61b417892fc3b912b271a` |

同时提供 `SHA256SUMS.txt`。
