# FocusLink v1.10.3

> 发布日期：2026-11-03
>
> 对应提交：`1d81a59`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 构建说明：包内 `APP_COMMIT` 为 `1d81a59`，不含 `-dirty`；安装版 `app.asar` 与便携版启动回读一致。
>
> 验证状态：源码门禁、打包启动自检、Windows 静默覆盖安装与可见性回读、小米同版安装回读、路由级前置条件/重放用例与装机版陈旧 If-Match 回环均已实测；华为平板本轮不在线

## 主要变化

- **`If-Match` 真正生效**：`PATCH /v1/sessions/:id` 与任务关联接口现在读取 `If-Match` 请求头（接受 `"3"`、`W/"3"`，不接受 `*`）；陈旧版本返回 `409 VERSION_CONFLICT`，请求头与正文版本不一致返回 `400 INVALID_ARGUMENT`。v1.10.2 只检查正文版本，带上请求头也挡不住旧写。
- **重放返回原确认**：同一个 `operationId` + 同一正文再次请求时，先命中已确认回执并返回首次结果（带 `duplicate: true`），不再因为记录版本已推进而被 409/422 拒绝；同 ID 换正文仍返回 `422 OPERATION_ID_REUSED`。
- **批量不再假装原子**：`atomic: true` 在写入前直接拒绝（`422 ATOMIC_NOT_SUPPORTED`），响应固定 `atomic: false`，不会先写一部分再解释；`If-Match` 也不接受批量请求。
- 仅影响本地 `/v1` 写接口；桌面界面、同步协议、番茄同步与移动端不变。

## 验证

- 源码：`format:check`、`typecheck`、`lint` 退出码均为 0；`npm test` 179 个文件 / 1572 个用例全部通过；`npm run dist` 在本干净提交上产出安装版与便携版。
- 路由级用例：`tests/sessionPatchService.test.ts` 9 个用例覆盖陈旧 `If-Match`、弱 ETag、头体冲突、非整数头、同文重放、无显式版本重放、同 ID 异文拒绝、无前置条件回退当前版本、陈旧 `expectedUpdatedAt`。
- 打包自检：`npm run verify:packaged` 退出 0，便携版回读 `version=1.10.3`、`commit=1d81a59`。
- 包内元数据：安装版 `app.asar` 的 `dist-electron/main-CelBHGWH.js:987` 为 `1d81a59`、版本 `1.10.3`，全部 `dist-electron` 文件 `-dirty` 出现 0 次。
- Windows：`installer /S` 退出 0；注册表 `DisplayVersion=1.10.3`，已装 `FocusLink.exe` 文件版本 `1.10.3`；可见性冒烟通过（pid 72396 / handle 992960）。
- **装机版 `/v1` 回环实测**（真实进程，未写用户数据）：
  1. 仅携带陈旧 `If-Match: "999999"` 的 PATCH 返回 `409 VERSION_CONFLICT`（此前 v1.10.2 返回 200 并写入）；
  2. `If-Match: 1` 与正文 `expectedRecordVersion: 2` 同时出现返回 `400 INVALID_ARGUMENT`；
  3. `atomic: true` 的批量请求返回 `422 ATOMIC_NOT_SUPPORTED`；
  4. 三次被拒请求后会话标题与 `updatedAt` 均未改变。
- 小米 22041216C（`192.168.1.5:5555`）：`adb install -r` 退出 0，回读 `versionName=1.10.3` / `versionCode=1379`，`lastUpdateTime=2026-11-03 08:21:03`，`firstInstallTime` 保留 `2026-09-10 16:56:24`。
- Android 单测：`:app:testDebugUnitTest` 41 个用例 / 0 失败（含 `FocusLinkConfigTest` 断言 `1.10.3`）；APK 备份 `33,901,016` 字节，SHA256 `0610ed846f5aa1de48ee06a15b820aaf8534f77295dd1980876601ee90959132`。
- 华为平板：`adb devices -l` 中未出现；按 2026-10-29 用户指令本轮只要求 Windows + 小米同版，平板未安装，不声称已安装。

## 升级提示

- Windows 直接覆盖安装；安装后回读卸载注册表与已安装 EXE 版本，再重启应用。
- 从 v1.10.2 升级只修正本地 `/v1` 写接口的前置条件与重放语义；账本数据、界面行为、番茄同步与移动端均不变。
- 自动化调用建议在每次读取会话后把返回的 `recordVersion` 放进 `If-Match`，并用稳定的 `operationId`；失败重试复用同一个 `operationId`。

## 已知限制

- **批量仍不是数据库事务**：`atomic: true` 现在会被拒绝；不带 atomic 时逐条执行、逐条返回，失败条目不影响已成功条目，全有全无没有入口。
- `PATCH` 的 `minutes` 只接受没有暂停的会话；有暂停的修正必须走 `/automation/v1/commands` 的 `records.update` + 完整 `timeline`。
- 仍未开放删除、任意 SQL 与远端番茄删除/回读；`remoteDeleteSupported=false`。
- 华为平板本轮未参与同版门禁；恢复华为门禁前需要用户明确要求。
- `focuslinkCloudState` 仍返回 `unknown`（未接 V2 Outbox 投影）。
- 仓库路径含中文时，Android 单测需要进程级 `JAVA_TOOL_OPTIONS=-Dfile.encoding=GBK`，否则测试 argfile 解码失败报 `ClassNotFoundException`；这是环境绕行，不是产品缺陷。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.10.3-x64.exe` | `11d063209e4823045bf791d658e76cf04067065f68a697675c9cc7ec774e9efd` |
| `FocusLink-1.10.3-x64-portable.exe` | `4939ff38de2b16acd7a6d36cb26ceb8bceb569408ba90eee83b12ed3b2b60dfc` |

同时提供 `SHA256SUMS.txt`。
