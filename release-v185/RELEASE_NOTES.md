# FocusLink v1.8.5

> 发布日期：2026-10-29
>
> 对应提交：`<COMMIT>`
>
> 发布类型：候选补丁
>
> 验证状态：源码门禁通过；Windows 与 Xiaomi 同版安装回读通过；Huawei 按用户指令「先只弄小米」不纳入本轮门禁；任务编辑仍缺真机点按核验

## 主要变化

- **离线任务修改闭环**：编辑（标题/优先级/起止日期/标签）与删除先落本机耐久队列，界面立刻显示结果；联网后按任务顺序补发，云端确认后才删队列记录。
- **同一任务多次修改自动合并**：离线期间连续改同一任务只保留最后一次意图；删除优先于字段修改，不会出现「先改后删」又被改回来的情况。
- **失败可见**：4xx 记 `http_<status>` 并把记录标记为阻塞（停止自动重试），网络错误按指数退避重试；命令条分别提示「已保存在本机」「已同步到云端」「服务端拒绝后需你确认」。
- **设备门禁按用户指令收窄**：2026-10-29 起只要求 Windows + 小米同版；华为离线不阻塞，也不写成已安装。

## 验证

- 源码门禁：`format:check`、`typecheck`、`lint` 均 exit 0；`npx vitest run` **166 文件 / 1424 用例全绿**（新增 `tests/localTaskEdits.test.ts` 4 条：合并意图、离线叠加、退避与阻塞、非法输入与级联删除）；`build`、`build:web`、`dist` 成功。
- Windows：静默覆盖安装 → `DisplayVersion=1.8.5`、EXE `1.8.5.0`；`verify:packaged`、`verify:budget`、`smoke:window-visible:launch` 全 PASS。
- Xiaomi：`adb install -r` → 回读 `versionName=1.8.5`、`versionCode=1361`（安装时设备锁屏，未做界面点按）。
- **未完成**：任务编辑与离线队列的真机端到端演练（需要解锁手机后在一次断网/恢复过程中观察三条记录状态）。

## 升级提示

- Windows 静默覆盖安装后必须回读卸载注册表与已安装 EXE 版本并重启应用。
- Android `adb install -r` 保留数据，逐台回读 `versionName/versionCode`。

## 已知限制

- **真机未演练**：队列逻辑只有单测覆盖，缺一次真实断网编辑 → 恢复联网 → 云端确认的观察。
- **第三方任务仍只读**：编辑/删除只对本机（`source==='local'`）任务开放。
- **超级岛仍未打通**：`/data/system` 无可写白名单入口；替代是默认开启的顶部胶囊，画面仍未核验。
- 旧样式层迁移期仍被导入（工程债）。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-1.8.5-x64.exe` | `2c9bfdd79ec522ace0173ce25c4634b2d2061d589aedfcaf66776d9d8702d95c` |
| `FocusLink-1.8.5-x64-portable.exe` | `61413c44cb8fc7c90dc45f7e4cf1032d3ed0a1d8b401a8477afdb4a9a113fe4e` |

同时提供 `SHA256SUMS.txt`。
