# FocusLink v1.8.2

> 发布日期：2026-10-28
>
> 对应提交：`<COMMIT>`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与 Windows / Xiaomi 安装回读通过；任务详情面板的整屏改造未取得真机截图（手机在使用中，自动化点击落到了浏览器）；Huawei 平板按用户指令不安装

## 主要变化

- **详情面板改成整屏**：按滴答清单 `activity_task.xml` 的 `ActivityPopupLayout` 整屏语义，把详情从「内容自适应高度」改成固定 `92vh` 的面板，顶部保留返回/标题/完成，下方依次是所属清单行、日期行、标题、标签、子任务、开始专注。
- **所属清单行按 `detail_list_header_info.xml`**：`14sp`、次要色、左边距 `10dp`、上下 `7dp / 8dp`，行尾 12dp 右箭头（点开可移动清单）。
- **标签行按 `detail_list_item_tags.xml`**：左边距 `6dp`、内边距 `2dp`、上边距 `8dp`、自动换行。
- 其余沿用 v1.8.1：圆角方形勾选框、任务行按 `standard_task_list_item` 直译、资源真值配色、滑动完成/移清单、清单抽屉、root 顶部胶囊。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **165 文件 / 1420 用例全绿**；`build`、`build:web`、`dist` 成功。
- 安装矩阵（本版实测）：Windows 静默覆盖安装 → `DisplayVersion=1.8.2`、EXE `1.8.2.0`；Xiaomi `adb install -r` → 回读 `versionName=1.8.2`、`versionCode=1358`。Huawei 未安装。
- **未完成**：详情面板整屏改动的真机截图。安装后自动化点击落到了浏览器界面，说明手机当时在被使用，因此停止操作，没有把该改动标记为肉眼验收。

## 升级提示

- Windows 静默覆盖安装后必须回读卸载注册表与已安装 EXE 版本并重启应用。
- Android `adb install -r` 保留数据，逐台回读 `versionName/versionCode`。

## 已知限制

- **详情面板未真机核验**：整屏高度与新增的清单行/标签行只有代码与布局依据，缺截图。
- **超级岛仍未渲染**：焦点通知载荷已被 SystemUI 接收，主屏无岛上区域；替代是顶部胶囊。
- **编辑类交互仍缺**：任务协议只有创建/完成/移动三种写入。
- 任务页未迁入搜索、批量操作、清单改名/删除。
- 旧样式层迁移期仍被导入（工程债）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.8.2-x64.exe` | `cba52a461b98acab0542323dd5f8c5019dc5380f9d7a7d84cefe4157341bcdfc` |
| `FocusLink-1.8.2-x64-portable.exe` | `bb052776405cf0582d42ee3132257431cd370434a6b5efc19d8efeedcaf50d43` |

同时提供 `SHA256SUMS.txt`。
