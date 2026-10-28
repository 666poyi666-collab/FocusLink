# FocusLink v1.8.7

> 发布日期：2026-10-29
>
> 对应提交：`57a416d`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁、Windows 与 Xiaomi 安装回读通过；**超级岛参数已按官方 schema 重写，但尚未取得真机“岛上可见”截图**

## 主要变化

- **按小米官方 schema 重写超级岛载荷**（`param_v2`）：
  - 补齐必填项 `business`、`aodTitle`、`ticker`，以及 `tickerPic` / `aodPic` / `shareData` / `islandFirstFloat`。
  - 键名改为官方的 `miui.focus.paramtextInfo`（此前用自造的 `textInfo`）。
  - 新增 `miui.focus.pics` Bundles，`picInfo.pic` 引用的 `miui.focus.pic_ticker` / `pic_aod` / `pic_imageText` 都有真实图标，避免系统整段丢弃岛数据。
  - 协议号不再写死 3，改为跟随系统 `notification_focus_protocol`。
- 结论依据：公开文档确认「收下通知但不渲染」的典型原因是参数不符合模板 schema（缺必填键或图片键悬空）。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **166 文件 / 1424 用例全绿**；`build`、`build:web`、`dist` 成功。
- Windows：静默覆盖安装 → `DisplayVersion=1.8.7`、EXE `1.8.7.0`；`verify:packaged`、`verify:budget`、`smoke:window-visible:launch` 全 PASS。
- Xiaomi：`adb install -r` → 回读 `versionName=1.8.7`、`versionCode=1363`。
- 真机环境取证：`if_allow_focus_notification=1`、`notification_focus_protocol=3`、`support_dynamic_island=1`、`updatable_focus_notifs=[]`；系统已装 KernelSU，且存在 `/data/adb/lspd`（LSPosed 数据目录）。

## 升级提示

- 本次只改通知载荷，不改专注逻辑；升级后开一次专注即可观察岛是否出现。
- 若岛仍不出现，下一手段是 HyperIsland（LSPosed 模块，需要重启并授权 SystemUI 作用域）。

## 已知限制

- **岛上可见未验证**：真机当时正被使用，未启动专注会话观察。
- **官方接入仍需资质**：正式上架场景需在小米开放平台开通超级岛服务并申请焦点通知权限；当前为自用调试路径。
- **HyperIsland 方案未实施**：属 LSPosed 模块，需安装、勾选作用域并重启。
- 旧样式层迁移期仍被导入（工程债）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.8.7-x64.exe` | `d1a90292a14d7e4c144d9223b2abc2fcdde9938308a3fd75b7b84715d1443abc` |
| `FocusLink-1.8.7-x64-portable.exe` | `5c4ec8287478e62ac145c1637ea9d338dabfebacfe1aa67c2d8a6dd312ee8070` |

同时提供 `SHA256SUMS.txt`。
