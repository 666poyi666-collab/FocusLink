# FocusLink v1.8.4

> 发布日期：2026-10-29
>
> 对应提交：`<COMMIT>`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁、Windows 与 Xiaomi 安装回读通过；**Huawei 平板本轮不可达，三设备同版门禁未通过**；任务编辑界面未做真机点按核验

## 主要变化

- **自有任务可编辑**：详情页标题、优先级（无/低/中/高）、截止日期（无日期/今天/明天）、标签改为直接编辑，保存走既有 `publishTaskSnapshot` 全量发布通道，失败在面板内显示原因。
- **任务可删除**：详情页两步确认后删除任务，连同其子任务一起移除，回执提示删除数量。
- **只改本机（FocusLink 自带）任务**：导入任务仍只读，`updateTaskSnapshotTask` / `deleteTaskSnapshotTask` 对 `source !== 'local'` 直接报错，不产生假按钮。
- **REA 工具链固定版本**：`rea-agents` 从 `@latest` 改为固定 `6.8.0`；`decode` 真正把 apktool 解到 `-OutDir` 并打印 APK sha256 与三件工具版本；每次调用追加一行 `evidence.jsonl` 指纹。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **165 文件 / 1420 用例全绿**（新增两条写入门禁断言已同步计数）；`build`、`build:web`、`dist` 成功。
- Windows：静默覆盖安装 → `DisplayVersion=1.8.4`、EXE `1.8.4.0`；`verify:packaged`、`verify:budget`、`smoke:window-visible:launch` 全 PASS。
- Xiaomi：`adb install -r` → 回读 `versionName=1.8.4`、`versionCode=1360`。
- **Huawei：未安装**。`192.168.1.6/7/8/9:5555` 全部 `10060` 超时，设备不在线，三设备门禁按失败处理。
- 工具链：`npm run re:decode` 实测输出 `sha256=c4717291556fa2dac99632a2313e7b785792eb77292cd985e9a21870ffa010e1`、`apktool 2.10.0 / jadx-headless-mcp 0.7.1 / rea-agents 6.8.0`，解码目录含 `res/`、`assets/`、`AndroidManifest.xml`。

## 升级提示

- Windows 静默覆盖安装后必须回读卸载注册表与已安装 EXE 版本并重启应用。
- Android `adb install -r` 保留数据，逐台回读 `versionName/versionCode`。

## 已知限制

- **Huawei 未更新到 1.8.4**：设备离线，需重新联机后补装并回读，才能视为同版。
- **任务编辑未真机点按核验**：标题/优先级/日期/标签/删除只有类型检查与单测覆盖，缺一次真实点击与云端回执观察。
- **编辑范围仅本机任务**：第三方导入任务仍只读。
- **超级岛仍未打通**：`/data/system` 无可写白名单入口；替代是默认开启的顶部胶囊，胶囊画面本轮仍未核验。
- 旧样式层迁移期仍被导入（工程债）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.8.4-x64.exe` | `e6e61c665406a6b0f853c17867c002712383de325f4329a045040f5755b8647c` |
| `FocusLink-1.8.4-x64-portable.exe` | `a0390851ded3bcce277411436c20d4bd07ef1fbad2a245d716888cbdeedc026f` |

同时提供 `SHA256SUMS.txt`。
