# FocusLink v1.8.0

> 发布日期：2026-10-28
>
> 对应提交：`<COMMIT>`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与 Windows / Xiaomi 安装回读通过；任务详情面板的真机截图核验未完成（手机被本人占用时做了安装，未再操作界面）；Huawei 平板按用户指令不安装

## 主要变化

- **详情面板按滴答清单详情布局重排**：读 `res/layout/detail_list_date_info.xml`、`detail_list_item_title.xml`、`detail_subtask_list_item.xml` 后，把任务详情改成滴答的结构——日期行用 32dp 勾选框（可见圈 24dp，`padding 4dp`）、日期 16sp、副标题 11sp；标题加粗、左边距 10dp、上下各 7dp；标签 12sp；子任务行复用列表行（24dp 勾选框、16sp 标题、13sp 日期，右端 10dp 余量）。
- **详情内边距按资源**：`task_detail_padding_left 14dp`、`task_detail_padding_right 24dp`。
- **本机保存状态**从底部挪到日期行副标题，避免与「开始专注」抢视线。
- 其余沿用 v1.7.9：布局直译的任务行、APK 资源真值配色、滑动完成/移清单、清单抽屉、新建面板、root 顶部胶囊。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **165 文件 / 1420 用例全绿**；`build`、`build:web`、`dist` 成功；`verify:packaged` PASS；`verify:budget` PASS。
- 安装矩阵（本版实测）：Windows 静默覆盖安装 → `DisplayVersion=1.8.0`、EXE `1.8.0.0`、`smoke:window-visible:launch` 通过；Xiaomi `adb install -r` → 回读 `versionName=1.8.0`、`versionCode=1356`。Huawei 未安装。
- **未完成**：详情面板改动没有真机截图核验。安装时手机正被本人使用（自动化点击落到了另一个应用），因此停止了对手机的界面操作，不宣称该面板已肉眼验证。

## 升级提示

- Windows 静默覆盖安装后必须回读卸载注册表与已安装 EXE 版本并重启应用。
- Android `adb install -r` 保留数据，逐台回读 `versionName/versionCode`。

## 已知限制

- **超级岛仍未渲染**：焦点通知载荷已被 SystemUI 接收，主屏无岛上区域；替代是顶部胶囊。
- **详情面板缺真机核验**：结构按 XML 改完，但截图证据缺失。
- **编辑类交互仍缺**：任务协议只有创建/完成/移动三种写入，滴答的改期、优先级、标签、提醒、重复、子任务编辑没有写入通道。
- 任务页未迁入搜索、批量操作、清单改名/删除。
- 旧样式层迁移期仍被导入（工程债）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.8.0-x64.exe` | `afe9fd99b41507625abd277d2badf78ac698f9afbd21fc91b3dd76051f6f7839` |
| `FocusLink-1.8.0-x64-portable.exe` | `b22c668e67d708875fffeb9229fd38d3961246701c0cdbadcb6f74b0b7ebeccb` |

同时提供 `SHA256SUMS.txt`。
