# FocusLink v1.6.9

> 发布日期：2026-10-26
>
> 对应提交：`56db405`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与 Windows / Xiaomi 安装回读通过；Huawei 平板按用户指令本轮不安装（未授权），不计入本版矩阵

## 主要变化

- 手机/平板四页按 2026-10-26 设计板重做：`src/mobile/` 收敛到一张设计语言总纲样式层，统一 4px 步长间距、8/12/16/24 圆角、28/18/16/13/12px 文字层级与 56px 主控件、48px 触控命中；颜色全部沿用既有 `--app-*` 语义 token，跟随浅/深主题与五种强调色。
- 外壳：底部导航从浮动胶囊改为通铺条（72px + 安全区、四项等分、常驻中文标签、当前项强调底），「我的任务」改名「任务」，非专注页新增 64px 活动专注条；新增 `src/mobile/systemInsets.ts` 原生安全区桥（Android 15 edge-to-edge）。
- 专注页首屏收敛为「当前任务 → 大读数 → 单主操作 → 时间之带 → 三时间」，修掉旧版粘性操作条压住「给这次专注起个名字」输入框的层级问题；360×800 与 412×915 下主操作与三时间均在首屏内。
- 任务页改扁平任务行（行首 48×48 勾选区、行高 72、子级缩进 24）与详情 sheet，创建表单不再常驻；统计页主数字只出现一次并改用中文时/分；设置页首屏收敛为「外观 / 同步与设备 / 系统显示 / 关于」四组行，412×915 下页面高度 2610 → 1004px、DOM 节点 978 → 99。
- 桌面 Windows 表现层、Electron 主进程、IPC、账本、dida / TomaToDo 同步与同步协议零改动，本轮只改 `src/mobile/` 与其测试。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` 162 文件 / 1399 用例全绿；`build`、`build:web` 成功；`verify:packaged` PASS（便携版冷启动页面就绪 7.7s、实例已回收）；`verify:budget` PASS（安装包 119.87MB ≤130MB、运行时依赖 3 个、导航点击 p75 64ms、长任务 2 个、DOM 1004 节点、JS 堆 8.1MB）。
- 整页渲染核对：6 视口（360×800 / 412×915 / 640×1024 / 760×1024 / 915×412 / 1040×760）× 亮暗两主题 × 四页共 48 张真实 renderer 截图，全部 `overflowX=0`；导航为通铺实色条（暗色压回实色，不再透底）。
- 安装矩阵（本版实测）：Windows 静默覆盖安装 `installer /S` → 卸载注册表 `DisplayVersion=1.6.9`、已装 `FocusLink.exe` 文件版本 `1.6.9`、`smoke:window-visible:launch` 通过（主窗口句柄可见、实例已回收）；Xiaomi 22041216C `adb install -r` 同版 APK → `versionName=1.6.9`、`versionCode=1345`（设备回读与 `aapt2 dump badging` 一致）。Huawei DBY-W09 本轮未授权、未安装，不作为本版通过项。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并逐台回读 `versionName/versionCode`；生产连接只允许 canonical HTTPS authority，不配置 ADB reverse。
- 既有合法 `fl2` 凭据原位升级；如新设备登录 probe 返回 `not-deployed`，应保留旧设备在线并等待 canonical gateway 部署，不清除应用数据。

## 已知限制

- 旧样式层迁移期仍被导入（工程债）：历史 6928 行 `mobile.css` 已改名 `mobile-parity-base.css`，与 `focuslink-2-mobile.css`、`mobile-1-3.css`、`mobile-2-0.css`、`mobile-confirm.css` 仍由 `main.tsx` 导入，新表最后加载并含两段局部 `!important` 覆盖；下个补丁删除旧表时必须同时补 CORE 自己的 `.mobile-topbar` 52px 紧凑下限，并把契约测试从双轨降为单轨。
- 时间之带刻度文字与「待机/现在」游标文字在窄容器里可能同基线贴近：根因在共享的 `src/features/focus/TemporalRibbon.tsx`，桌面侧本轮零改动，记为本版 P1 已知限制。
- 915×412 短横屏为守住垂直预算，左侧任务块隐藏了「当前任务」标签、任务副行与「起个名字」入口；三时间落到首屏之下（滚动可见），主读数与主操作均在导航之上。
- 统计页 24 小时车道的时长小标签仍用 `3.3h / 12m` 英文写法；日期范围在范围说明、账本标题、页脚三处重复出现。均为 P2 文案/冗余问题。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.6.9-x64.exe` | `c7f7676a1d605dc8516a4d58144d1096de8586da7b79dda47dba85779af5543b` |
| `FocusLink-1.6.9-x64-portable.exe` | `8cae57f42f23ba49d00cad15eb3fc93ee360fd08f9acae5bb84fad59b399dbca` |

同时提供 `SHA256SUMS.txt`。
