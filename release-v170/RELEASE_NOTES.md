# FocusLink v1.7.0

> 发布日期：2026-10-27
>
> 对应提交：`<COMMIT>`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与 Windows / Xiaomi 安装回读通过；Huawei 平板按用户指令本轮不安装（未授权），不计入本版矩阵

## 主要变化

- **专注页更简单**：首屏只剩一行任务入口、状态行、大读数、单个主操作、时间之带和一行三时间。任务入口点开底部弹层三选一——最近任务（最多 5 条）/ 输入这次专注的名字 / 直接开始不写名字；顶栏去掉重复的齿轮，右上角只剩同步状态；时间之带首屏不再显示实时时钟与刻度说明，近景/远景改成文字 + 底线分段。
- **任务页去卡片化**：搜索框与「新建」并成一行，待办/已完成改成文字分段（字重 + 底线，不只靠颜色），任务行 64px + 1px 低对比分隔线，空态收敛成一行说明加一个文字动作，页脚只留本机 revision。
- **统计页重做**：删除环形图、四宫格 KPI 与满屏胶囊；改成「一句话范围 + 唯一大数字（中文时/分）+ 三项摘要（次数/平均/最长）+ 7 根细柱 + 最近记录」，24 小时时间轴与账本明细收进次级入口。
- **同步说人话**：设置里的「同步与设备」改成先回答四个问题——离线可用（一条 56px 状态条说明任务与专注记录都存在本机）、现在同步吗、同步的是什么（只有任务与专注记录会同步，外观偏好只在本机）、怎么配对设备（三步说明 + 不配对也完全可用）。原有发件箱、游标、第三方投递、冲突处理全部保留。
- **视觉语言**：内容区不再堆叠卡片与胶囊，改用 1px 低对比分隔线分区；强调色只出现在主操作、当前选中态、状态点与图里有数据的柱；分组标签 12px 加字距；数字统一等宽。
- 桌面 Windows 表现层、Electron 主进程、IPC、账本与 dida / TomaToDo 同步零改动，本轮只改 `src/mobile/` 与其测试。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **162 文件 / 1399 用例全绿**；`build`、`build:web` 成功；`dist` 产出安装包与便携版；`verify:packaged` 便携版启动页面就绪、实例已回收；`verify:budget` 安装包 119.87MB ≤130MB、运行时依赖 3 个。
- 整页渲染核对：412×915 亮/暗四页真实 renderer 截图；360×800、915×412、1040×760 同轮核对，全部 `overflowX=0`。
- 安装矩阵（本版实测）：Windows 静默覆盖安装 `installer /S` → 卸载注册表 `DisplayVersion=1.7.0`、已装 `FocusLink.exe` 文件版本 `1.7.0`、`smoke:window-visible:launch` 主窗口句柄可见并回收实例；Xiaomi 22041216C `adb install -r` 同版 APK → 设备回读 `versionName=1.7.0`、`versionCode=1346`。Huawei DBY-W09 本轮未授权、未安装，不作为本版通过项。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并逐台回读 `versionName/versionCode`；生产连接只允许 canonical HTTPS authority，不配置 ADB reverse。
- 既有合法 `fl2` 凭据原位升级；如新设备登录 probe 返回 `not-deployed`，应保留旧设备在线并等待 canonical gateway 部署，不清除应用数据。

## 已知限制

- 旧样式层迁移期仍被导入（工程债）：历史 6928 行 `mobile.css` 现名 `mobile-parity-base.css`，与 `focuslink-2-mobile.css`、`mobile-1-3.css`、`mobile-2-0.css`、`mobile-confirm.css` 仍由 `main.tsx` 导入；删除前需先把 `.sr-only`、`.mobile-topbar` 52px 紧凑下限等搬进 CORE，并把契约测试从双轨降为单轨。
- 时间之带刻度文字与「待机/现在」游标文字在窄容器可能贴近：根因在共享的 `src/features/focus/TemporalRibbon.tsx`，桌面侧零改动约束下未修。
- 「多端同步设置」按钮位于读屏摘要（`sr-only`）内，视觉上只能通过顶栏同步状态入口进入同步设置；键盘与读屏可达。
- `npm audit --omit=dev` 在本机镜像（npmmirror）返回 `[NOT_IMPLEMENTED] /-/npm/v1/security/*`，属环境限制，未获得审计结果。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.7.0-x64.exe` | `0afa81dc1eadc7e3c2f3e08d3583e485b0ba2b2ad587b54860609ebd5fabe7f4` |
| `FocusLink-1.7.0-x64-portable.exe` | `ca5efeb1a18b5e330a89948287342382ece5f4a6dd1d5808b9709ea218e094dc` |

同时提供 `SHA256SUMS.txt`。
