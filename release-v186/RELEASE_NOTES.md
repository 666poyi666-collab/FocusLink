# FocusLink v1.8.6

> 发布日期：2026-10-29
>
> 对应提交：`49d4705`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁通过；Windows 与 Xiaomi 同版安装回读通过；离线冷启动与离线改任务已在小米真机端到端演练通过

## 主要变化

- **修复离线冷启动空列表**：`mobileAccountId` 只认 `fl2_` 前缀令牌，旧版配对令牌解析不出账号段，导致任务缓存**从未写入**，离线重开显示「还没有任务」。现在另存一份与账号无关的兜底快照（`taskSnapshot.legacy.v1`），冷启动时优先读账号快照、读不到再读兜底。
- **修复离线修改永不补发**：编辑/删除入队后若当时失败，记录进入退避，但没有任何事件会再次触发补发；现在按最早的 `nextRetryAt` 自唤醒重试。
- **冷启动缓存守卫放宽**：refresh 在离线时已推进 generation，原守卫会丢掉缓存；当前无快照时允许缓存顶上。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **166 文件 / 1424 用例全绿**；`build`、`build:web`、`dist` 成功。
- Windows：静默覆盖安装 → `DisplayVersion=1.8.6`、EXE `1.8.6.0`；`verify:packaged`、`verify:budget`、`smoke:window-visible:launch` 全 PASS。
- Xiaomi：`adb install -r` → 回读 `versionName=1.8.6`、`versionCode=1362`。
- 真机离线链路（同一台小米，按应用 UID 用 iptables 断网）：
  1. 断网冷启动：缓存快照 restore 成功，列表显示 60 条任务（`revision 724`）。
  2. 断网把「循环10」优先级改为「高」：队列记录数 `edits=1`，界面立即变红。
  3. 强杀进程、仍断网冷启动：`edits=1` 仍在，面板仍显示「高」。
  4. 恢复联网约十余秒：`edits=0`、`revision 724 → 725`，云端已接收「高」。

## 升级提示

- Windows 静默覆盖安装后必须回读卸载注册表与已安装 EXE 版本并重启应用。
- Android `adb install -r` 保留数据，逐台回读 `versionName/versionCode`。

## 已知限制

- **旧版令牌的缓存是“兜底”而非账号隔离**：同一设备换账号时兜底快照会被覆盖；正式隔离仍依赖 `fl2_` 令牌。
- **Huawei 未纳入门禁**：按用户指令「先只弄小米」，平板离线不阻塞本轮。
- **超级岛仍未打通**：`/data/system` 无可写白名单入口；替代是默认开启的顶部胶囊。
- 旧样式层迁移期仍被导入（工程债）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.8.6-x64.exe` | `75e4cacbf924fe5096a08caaaaac33b2bb50b47bdb933ab92cb870f7af228956` |
| `FocusLink-1.8.6-x64-portable.exe` | `a82ec7e0ba8fc57fd879c42a793c4b23d061fb01e21163a711f4f2d75ff42707` |

同时提供 `SHA256SUMS.txt`。
