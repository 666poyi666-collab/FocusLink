# FocusLink v1.7.8

> 发布日期：2026-10-28
>
> 对应提交：`ff95a7a`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与 Windows / Xiaomi 安装回读通过；Huawei 平板按用户指令不安装

## 主要变化

- **设计值改为从滴答清单 APK 资源里取**：用 apktool 解码 `cn.ticktick.task`（46.6MB base.apk）的 `res/values/colors.xml` 与 `dimens.xml`，把上一版按截图估算的颜色与尺寸全部替换为资源里的真值——强调蓝 `617FDE`（旧值 3D6EE8）、高优先级红 `E13E39`、中优先级橙 `F2B04B`、无优先级灰 `A3A3A3`、正文 `262626`、次要文字 `757575`、页面底 `F5F5F5`、暗色卡片 `1C1C1C`；行高 42dp（旧的 44px）、标题 16sp、勾选圈 20dp、底部导航 58dp 且激活标签 14sp、图标 24dp。
- **滑动操作**：按滴答清单的手势补上右滑「完成」（强调蓝，`swipe_task_wont_do` 同族色）、左滑「移到清单」（`4C52E4`），阈值 72px，纵向滑动仍交给页面滚动；行文本禁用长按选中，避免手势被文本选择抢走。
- 其余沿用 v1.7.6/v1.7.7：滴答清单式任务列表、清单抽屉、新建与详情面板、root 顶部胶囊、本机通知链路。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **165 文件 / 1420 用例全绿**；`build`、`build:web`、`dist` 成功；`verify:packaged` PASS；`verify:budget` PASS。
- 真机核对（Xiaomi 22041216C / HyperOS 3）：列表行距、勾选圈大小、优先级配色与滴答清单截图对齐；`input motionevent` 拉到 300 设备 px 时「完成」蓝块完整显示，松手后不误改任务状态（复核节点树无 `取消完成 第二章直线部分回顾复盘`）。
- 安装矩阵（本版实测）：Windows 静默覆盖安装 → `DisplayVersion=1.7.8`、EXE `1.7.8.0`、`smoke:window-visible:launch` 通过；Xiaomi `adb install -r` → `versionName=1.7.8`、`versionCode=1354`。Huawei 未安装。

## 升级提示

- Windows 静默覆盖安装后必须回读卸载注册表与已安装 EXE 版本并重启应用。
- Android `adb install -r` 保留数据，逐台回读 `versionName/versionCode`。

## 已知限制

- **超级岛仍未渲染**：焦点通知载荷已被 SystemUI 接收（v1.7.4 记录），主屏不出现岛上区域；替代是顶部胶囊。
- **滑动只做两条**：完成与移到清单；滴答清单的改期、置顶、删除、番茄跳转依赖我们任务协议不支持的写入，不能假装实现。
- 任务页仍未迁入搜索、批量操作、清单改名/删除。
- 旧样式层迁移期仍被导入（工程债）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.7.8-x64.exe` | `f423beddde012e184f616e90ed57a7585b1339fd1fa8f69bd26ad77774279e7d` |
| `FocusLink-1.7.8-x64-portable.exe` | `68461208d1ed677c49136311508d669bc7c3934d1e7ed33622160edb7d1c2baa` |

同时提供 `SHA256SUMS.txt`。
