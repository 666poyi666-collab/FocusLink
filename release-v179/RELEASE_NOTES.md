# FocusLink v1.7.9

> 发布日期：2026-10-28
>
> 对应提交：`<COMMIT>`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与 Windows / Xiaomi 安装回读通过；Huawei 平板按用户指令不安装

## 主要变化

- **改为直接翻译滴答清单的布局源码**：apktool 解码后读 `res/layout/standard_task_list_item.xml`、`res/layout/detail_task_list_item.xml`、`res/layout/task_item_indicators_layout.xml`、`res/values/styles.xml` 的 `taskItemCheckbox` 与 `task_list_indicator_style`，按 XML 里的真实 dp/sp 重排任务行——勾选区 `paddingStart 15dp / paddingEnd 8dp / paddingVertical 10dp`、勾选框 24dp（图标 1dp 内边距）、标题 16sp 且 `marginVertical 10dp` 与 `paddingEnd 8dp`、日期 13sp `marginEnd 2dp`、子任务等指示图标 14dp、展开箭头改成**向右的 18dp 箭头**（展开后旋转 90°）、右侧预留 14dp。
- **行高按真实结构**：勾选框 24dp + 上下各 10dp = 44dp（上一版误用 checklist 的 42dp）。
- **子任务指示器**：父任务行在有子任务时显示 14dp 指示图标，与滴答的 `icon_subtasks` 位置一致（放在日期左侧）。
- 其余沿用 v1.7.8：APK 资源真值配色、滑动完成/移清单、清单抽屉、新建与详情面板、root 顶部胶囊。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **165 文件 / 1420 用例全绿**；`build`、`build:web`、`dist` 成功。
- 真机核对（Xiaomi 22041216C / HyperOS 3）：勾选框 24dp、行高 44dp、向右箭头展开后转向下、父任务出现子任务指示图标、日期 13sp，均与解码布局一致。
- 安装矩阵（本版实测）：Windows 静默覆盖安装 → `DisplayVersion=1.7.9`、EXE `1.7.9.0`；Xiaomi `adb install -r` → 回读 `versionName=1.7.9`、`versionCode=1355`。Huawei 未安装。

## 升级提示

- Windows 静默覆盖安装后必须回读卸载注册表与已安装 EXE 版本并重启应用。
- Android `adb install -r` 保留数据，逐台回读 `versionName/versionCode`。

## 已知限制

- **超级岛仍未渲染**：焦点通知载荷已被 SystemUI 接收，主屏无岛上区域；替代是顶部胶囊。
- **编辑类交互仍缺**：任务协议只有创建/完成/移动三种写入，改期、优先级、标签、提醒、重复、子任务编辑没有写入通道。
- 任务页未迁入搜索、批量操作、清单改名/删除。
- 旧样式层迁移期仍被导入（工程债）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.7.9-x64.exe` | `e227b3b1113748bdce5795f12812f6d39f53d361aaef03b9108ea2c6d73e9da0` |
| `FocusLink-1.7.9-x64-portable.exe` | `cc7f09ed1a9fb37a23ae30c4b6e1173ca5fa4546e1f3a33fb5ac28abe47fc251` |

同时提供 `SHA256SUMS.txt`。
