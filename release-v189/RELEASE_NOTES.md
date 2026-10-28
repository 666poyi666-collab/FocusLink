# FocusLink v1.8.9

> 发布日期：2026-10-29
>
> 对应提交：`0ca0e3c`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁、Windows 与 Xiaomi 安装回读通过；账户卡片与勾选动效已在小米真机确认渲染

## 主要变化

- **账户入口对齐滴答清单**：设置页顶部新增账户卡片——头像首字母、账号名（如 `Poyi`）、一行同步状态（`已连接 · 上次同步 刚刚 / N 分钟前`、未配对时显示「本机使用 · 任务只保存在本机」），点整卡进入账号与同步面板。
- **打勾动效**：勾选框完成时按完成态重新挂载并播放一次 `tt-check-pop`（0.78 → 1.08 → 1），对勾用 `tt-check-tick` 淡入放大；只动 `transform`/`opacity`，并带 `prefers-reduced-motion` 降级。
- **移除超级岛**：小米岛表面固定不再选择（此前被 SystemUI `onAuthFailed` 拒绝），顶部悬浮胶囊开关恒为关闭、不再绘制；通知回归普通常驻样式。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **166 文件 / 1424 用例全绿**；`build`、`build:web`、`dist` 成功。
- Windows：静默覆盖安装 → `DisplayVersion=1.8.9`、EXE `1.8.9.0`。
- Xiaomi：`adb install -r` → 回读 `versionName=1.8.9`、`versionCode=1365`。
- 真机确认：设置页账户卡片渲染为「P / Poyi / 已连接 · 上次同步…」；DOM 计算样式 `animationName=tt-check-pop` 出现在已完成勾选框上；悬浮窗计数为 0（胶囊已移除）。

## 升级提示

- 本轮移除岛与胶囊，不影响计时、任务与账本。
- 若之后要恢复原生岛，唯一路径仍是拿到小米焦点通知白名单（官方申请或系统侧绕过），不是参数问题。

## 已知限制

- **原生超级岛不可用**：SystemUI 在鉴权阶段拒绝本应用（`onAuthFailed`），冰环等能显示是因为在白名单内或带模块。
- **勾选动效只有一次性播放**：无回弹/粒子等更复杂效果，符合合成器属性约束。
- 旧样式层迁移期仍被导入（工程债）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.8.9-x64.exe` | `06cc1278c746d52c5131b2fa34c1b3c2734c09764d7bd4acd7744887cbf0ebbd` |
| `FocusLink-1.8.9-x64-portable.exe` | `60392bf7477bbaa7419b85f199a1c6b8bf90591e17c2db6766acb3705125f849` |

同时提供 `SHA256SUMS.txt`。
