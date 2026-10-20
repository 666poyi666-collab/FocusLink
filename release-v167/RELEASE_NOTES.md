# FocusLink v1.6.7

> 发布日期：2026-10-20
>
> 对应提交：`4b522f8`
>
> 发布类型：候选补丁（未创建公开 tag / GitHub Release）
>
> 验证状态：Windows 门禁全部通过（自动化 + 打包启动 + 静默覆盖安装 + 主窗口可见性）

## 主要变化

- **安装包 204.95 → 119.87 MiB（−85.08 MiB，−41.5%）**，便携版 204.73 → 119.66 MiB，`app.asar` 109.51 → 31.41 MiB，安装后占用 492.76 → 345.00 MiB。砍掉的全是运行期从不读取的东西：13 个纯构建期依赖移出 `dependencies`（只剩 `better-sqlite3` / `undici` / `ws`）、better-sqlite3 只保留 Windows x64 的 prebuild 并排除 sqlite3 C 源码、`electronLanguages` 收到 `zh-CN` + `en-US`（55 个语言包 → 2 个）。
- **专注小窗不再加载整副字体表**：字体声明按渲染入口拆成 `font-faces.css`（主窗/移动端）与 `mini-font-faces.css`（小窗）。小窗 CSS 362,233 → **324,564 B（−10.4%）**、`@font-face` 236 → **212 条**。小窗 8 档界面字体的首选族逐档核对后全部保留，剔除的只有确实不可达的三处，**看不到任何字形变化**。
- **暂停时不再满帧重绘**：时间之带在暂停且过渡收敛后按 32ms 限频连续补帧（约 30 次/秒，原 60 次/秒，每帧位移 0.27px），长暂停不再持续占满一个 CPU 核。running 与暂停过渡期保持满帧，reduced-motion 仍按秒唤醒，镜头投影口径未动。
- **专注页每秒只重绘该重绘的部分**：`TimerPanel` 从整仓订阅改成 7 个逐字段订阅，计时 tick、toast 与同步队列写入不再重建整个专注页。
- **样式层去重（视觉零改动）**：删除 13 个 `html[data-theme='dark']` 死色块与 `titanium` 皮肤集群共 197 行；`--radius-*` 从两套并存收敛为唯一来源，桌面档 4/7/10/14/18/22/26、移动与小窗档 2/3/4/6/6/8/16，逐个 token 实测三端渲染值前后一致，同时消掉 2xl(22px) > 3xl(16px) 的倒挂。用户可切换的三套 `data-pal` 配色保留。
- **新增打包产品启动门禁 `npm run verify:packaged`**：自动发现发布目录的 `win-unpacked` 与 portable，隔离拉起并回读版本 / commit / 外壳 / 导航 / 专注仪表 / 暂停色，失败 12 秒内变红，`finally` 回收自己拉起的实例。

## 验证

- 自动化门禁：`format:check`、`typecheck`（含 Worker）、`lint`、`npm test`（**150 文件 / 1271 项**）、`npm run build` 全部通过。
- 打包启动门禁：`npm run verify:packaged` PASS 2/2（`version=1.6.7`、`commit=4b522f8`、页面已回读、实例已回收）。
- 安装门禁：静默覆盖安装退出码 0；卸载注册表回读 `DisplayName=FocusLink 1.6.7` / `DisplayVersion=1.6.7`；已安装 EXE 回读 `FileVersion=1.6.7` / `ProductVersion=1.6.7.0`；安装目录 345.00 MiB。
- 主窗口可见性：`npm run smoke:window-visible` 退出码 0（pid 76492，主窗口 handle 6167576，标题「FocusLink」）。
- 本轮顺带修掉 1.6.6 遗留的 `releaseRecordContract.test.ts` 12 个 TypeScript 错误与两个 smoke 脚本格式问题——它们此前会让 `typecheck` / `format:check` 直接失败。

## 升级提示

- Windows 使用安装器静默覆盖安装后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- 本轮只开发 PC（Windows）。Android 仅同步版本元数据（`1.6.7 / 1343`），未构建、未安装，不得宣称 Android 端已验证。
- 既有本地数据库与设置原位保留；本轮不改数据库结构、IPC 语义与同步协议。
- 打包产物**从本仓库那条长中文路径直接拉起会崩溃**（`0x80000003`），这是拉起位置的环境效应、不是产物缺陷：想手动双击验证，请先把产物复制到短 ASCII 路径。详见 `FL-INSTALL-016`。安装器也请从短路径复制后执行。

## 已知限制

- 本轮不动任何可见视觉。真正的一体化（字号与间距刻度、合并任务/统计两套工作台样式）与长列表虚拟化属于下一轮设计改版，需单独确认。
- 任务页与账本仍无虚拟化，240 行任务从本地缓存打开实测约 162 ms；本轮未改。
- `hm-stagger-in` 交错入场类名仍输出在历史时间轴 DOM 上，其样式文件已删；该动效从未真正生效，处置留待下一轮。
- `html[data-density='compact']` 系列 8 处同样可证明永不匹配，本轮只记录未删。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.6.7-x64.exe` | `3D26632FFB4BC65972D16411D9EF1D1D9734E148F469EE7CFAE1436EB001F6CC` |
| `FocusLink-1.6.7-x64-portable.exe` | `9F4BF8DFD0284D520E6BC698B3CE5BFFADB7675930A968DCC870BC56551A02E2` |

同时提供 `SHA256SUMS.txt`。
