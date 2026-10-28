# FocusLink v1.8.1

> 发布日期：2026-10-28
>
> 对应提交：`<COMMIT>`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与 Windows / Xiaomi 安装回读通过；Huawei 平板按用户指令不安装

## 主要变化

- **勾选框改成圆角方形**：读滴答清单的矢量资源 `res/drawable/ic_svg_tasklist_checkbox_unchecked_v8.xml`（24dp、`viewport 24×24`、圆角半径 5、描边 1.5dp、白底）后，把上一版按截图猜成圆形的勾选框改成 `border-radius: 5px` + 1.5px 描边；已完成状态保持灰底白勾。真机截图裁切放大核对：原版确实是红色圆角方形描边，不是圆形。
- 其余沿用 v1.8.0：详情面板按 `detail_*` 布局重排、任务行按 `standard_task_list_item` 直译、APK 资源真值配色、滑动完成/移清单、清单抽屉、root 顶部胶囊。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **165 文件 / 1420 用例全绿**；`build`、`build:web`、`dist` 成功；`verify:packaged` PASS；`verify:budget` PASS。
- 资源证据：`ic_svg_tasklist_checkbox_unchecked_v8.xml` 路径与参数见上；真机截图 6 倍放大裁切确认形状。
- 安装矩阵（本版实测）：Windows 静默覆盖安装 → `DisplayVersion=1.8.1`、EXE `1.8.1.0`、`smoke:window-visible:launch` 通过；Xiaomi `adb install -r` → 回读 `versionName=1.8.1`、`versionCode=1357`。Huawei 未安装。

## 升级提示

- Windows 静默覆盖安装后必须回读卸载注册表与已安装 EXE 版本并重启应用。
- Android `adb install -r` 保留数据，逐台回读 `versionName/versionCode`。

## 已知限制

- **超级岛仍未渲染**：焦点通知载荷已被 SystemUI 接收，主屏无岛上区域；替代是顶部胶囊。
- **编辑类交互仍缺**：任务协议只有创建/完成/移动三种写入。
- 任务页未迁入搜索、批量操作、清单改名/删除。
- 旧样式层迁移期仍被导入（工程债）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.8.1-x64.exe` | `04f8132c5914afc6db60fbd0615944dde471c81fa0557cc7d4d59e173745472e` |
| `FocusLink-1.8.1-x64-portable.exe` | `cf0a39133bc7eaa268b1a1ed7cf878796094e04c273049398ae57d1fce1fee57` |

同时提供 `SHA256SUMS.txt`。
