# FocusLink v1.8.8

> 发布日期：2026-10-29
>
> 对应提交：`c4cebad`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与双端安装回读通过；**超级岛仍未显示**，本轮定位到「前台通知根本没发出去」这一层，并修了导致通知被判过期的两处逻辑

## 主要变化

- **原生判定过期就停服务**：`FocusRuntimeSnapshot.isFresh` 用 `validUntilEpochMs` 判新鲜，而本机会话只在开始时报一次 30 分钟有效期；一过期 `synchronize` 就不再启动前台服务，通知随之消失。现在本机权威会话改为按「收到时间 ≤30 分钟」判新鲜。
- **JS 补心跳**：会话进行中每 60 秒重推一次原生快照，顺带续上有效期；此前只在快照变化时推一次。
- 超级岛载荷沿用 v1.8.7 的官方 schema 重写结果（`business`/`aodTitle`/`paramtextInfo`/`miui.focus.pics`）。
- 调试包新增 `DebugIslandReceiver`（仅 debug 清单注册），用于从 adb 触发一条岛通知；实测被 HyperOS 的 `Greezer Denial` 拦截，暂不可用。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **166 文件 / 1424 用例全绿**；`build`、`build:web`、`dist` 成功。
- Windows：静默覆盖安装 → `DisplayVersion=1.8.8`、EXE `1.8.8.0`。
- Xiaomi：`adb install -r` → 回读 `versionName=1.8.8`、`versionCode=1364`。
- **未通过**：装上 1.8.8 后重新开始专注会话（03:38），系统通知列表里 `pkg=app.focuslink.mobile` 仍为 0，原生 `FocusLinkRuntime` 日志缺失——说明 JS→原生这一跳当前没有发生，需要继续查插件注册/前端包是否被 Service Worker 缓存。

## 升级提示

- 本轮只改通知链路判定，不影响计时与账本。
- 若升级后仍无通知，说明问题在 WebView 前端包缓存或插件注册，而非载荷。

## 已知限制

- **超级岛仍未显示**：当前卡在「前台通知没有发出去」这一层，岛无从渲染。
- **调试广播不可用**：HyperOS `Greezer` 拒绝后台广播投递，只能走真实会话或前台操作。
- **官方资质**：正式接入需在小米开放平台开通超级岛服务。
- 旧样式层迁移期仍被导入（工程债）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.8.8-x64.exe` | `09ac2906a1dfe4ba32ae1d5d45f7dd635e313cc9d9d980f73e2221854ad6a1c6` |
| `FocusLink-1.8.8-x64-portable.exe` | `53edf3a25751a4c3e066b9c107eeba6fa7c93b3417429ddf1bdc15d745123f2a` |

同时提供 `SHA256SUMS.txt`。
