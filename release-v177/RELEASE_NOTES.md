# FocusLink v1.7.7

> 发布日期：2026-10-28
>
> 对应提交：`<COMMIT>`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁与 Windows / Xiaomi 安装回读通过；Huawei 平板按用户指令不安装；小米超级岛仍未渲染（本版不宣称可用）

## 主要变化

- **底部导航按滴答清单收口**：导航高度改为 `68px + 安全区`，激活项只显示图标方块与蓝字，未激活项不再漏出淡色标签，最后一行任务不会被导航盖住。
- **任务页保持 1.7.6 的复刻结果**：浅灰底 + 白色圆角面板、圆形优先级复选框（高/中/低/无）、44px 行高、右侧红色延期天数、父任务展开箭头与子任务缩进、按清单分组、蓝色新建按钮、清单抽屉。
- **任务面板间距**：列表底部留白按导航与安全区重算，新建 / 详情面板与悬浮按钮位置同步修正。
- 承接 v1.7.4 的本机通知链路与 v1.7.6 的 root 顶部胶囊，行为不变。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **165 文件 / 1420 用例全绿**；`build`、`build:web`、`dist` 成功；`verify:packaged` PASS；`verify:budget` PASS。
- 真机核对（Xiaomi 22041216C / HyperOS 3）：任务页导航仅激活项显示“任务”与蓝底图标，其余三项只有图标；列表最后一行（循环7）完整可见。
- 安装矩阵（本版实测）：Windows 静默覆盖安装 `installer /S` → 卸载注册表 `DisplayVersion=1.7.7`、已装 `FocusLink.exe` 文件版本 `1.7.7`、`smoke:window-visible:launch` 主窗口可见并回收实例；Xiaomi `adb install -r` → 设备回读 `versionName=1.7.7`、`versionCode=1353`。Huawei 本轮未安装。

## 升级提示

- Windows 使用安装器静默覆盖后必须回读卸载注册表与已安装 EXE 版本，并重新启动应用。
- Android 使用同一 APK 执行 `adb install -r`，保留应用数据并逐台回读 `versionName/versionCode`。

## 已知限制

- **小米超级岛仍未渲染**：焦点通知载荷已被 SystemUI 接收（v1.7.4 记录），主屏不出现岛上区域；当前替代是顶部胶囊。
- 任务页只复刻任务主路径（列表 / 抽屉 / 新建 / 详情）；搜索、批量操作、清单改名删除仍是旧逻辑。
- 统计页「有数据」的看板仍只按本地样本会话核对。
- 旧样式层迁移期仍被导入（工程债）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.7.7-x64.exe` | `b33e9e555552573a00c092ba4a41822321c4c0e506b93e14abe97766082b9532` |
| `FocusLink-1.7.7-x64-portable.exe` | `fef6d0198675c78aacac0783c08385cfe4df5b1ab3c12ac05de5bca06d41fe6d` |

同时提供 `SHA256SUMS.txt`。
