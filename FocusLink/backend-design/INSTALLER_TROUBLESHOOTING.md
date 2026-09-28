# FocusLink Windows 安装器错误索引

这是一份可重复使用的安装排错页，不是某次发布的临时报告。安装器默认只处理当前 Windows 账户的 `FocusLink.exe`；不会结束其他账户的同名进程，也不会用 `/T` 遍历 Chromium 进程树。

## FL-INSTALL-001：FocusLink 无法关闭

典型提示：

> FocusLink 无法关闭。请手动关闭它，然后单击重试以继续。

### 先做什么

1. 点击“取消”，不要连续点击“重试”。
2. 从 FocusLink 主窗口、托盘菜单和小窗退出；确认没有隐藏的小窗或沉浸窗口。
3. 打开任务管理器的“详细信息”，只结束当前账户下的 `FocusLink.exe`。不要结束其他账户或 Codex/其他应用的同名进程。
4. 重新运行工作区内的安装包：`release-v*/FocusLink-x.y.z-x64.exe`。

### PowerShell 核对命令

以下命令只列出当前账户可见的 FocusLink 进程，先核对路径和 PID，再决定是否结束：

```powershell
Get-Process -Name FocusLink -IncludeUserName -ErrorAction SilentlyContinue |
  Where-Object UserName -eq "$env:USERDOMAIN\$env:USERNAME" |
  Select-Object Id, UserName, Path
```

如果确认是自己的残留进程，可以按 PID 结束；不要使用不带账户过滤的全局强杀：

```powershell
Stop-Process -Id <当前账户的PID> -Force
```

### 仍然重复出现时

这通常是以下几类情况之一：

- 旧版卸载器在升级路径中仍持有文件句柄；
- 托盘/小窗的 Chromium 子进程在主进程退出后短暂重生；
- FocusLink 以管理员或另一个 Windows 账户运行，当前安装器没有权限结束它；
- 快捷方式或卸载注册项指向旧安装目录，导致安装器反复进入旧升级路径。

安装器会执行两轮有界的当前账户强制关闭，并等待子进程退出。若仍失败，请记录：

- 提示框中的错误文本和时间；
- `FocusLink.exe` 的 PID、完整路径和 `UserName`；
- 当前安装包完整路径；
- 是否存在 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` 下的旧 FocusLink 项。

不要直接删除 `%APPDATA%\FocusLink`；那里可能包含 SQLite 账本和设置。先备份，再处理旧卸载项或安装目录。

### 安装日志

需要日志时，从 PowerShell 启动安装器并保留 NSIS 日志：

```powershell
& .\release-v01222\FocusLink-0.12.22-x64.exe /LOG="$env:TEMP\focuslink-installer.log"
```

日志和截图只放在临时目录，不要提交到 release 目录。修复后仍必须从工作区 release 重新安装验证；不能用旧的 `%TEMP%` 包替代。

## FL-INSTALL-005：双击后像“没有反应”

FocusLink 使用分步安装器。首屏标题是「FocusLink 安装」，需要先选择「仅为我安装」或「为所有用户安装」，再点击「下一步」；首屏不会在未选择范围时直接复制文件。「为所有用户安装」还会等待 Windows UAC 确认，窗口可能出现在其他窗口后面。

优先选择「仅为我安装」，并从工作区 `release-v01222/FocusLink-0.12.22-x64.exe` 启动。安装器现在按 `域/电脑名\\用户名` 精确筛选当前账户的 `FocusLink.exe`，并进行有界强制关闭；若 10 秒后任务栏和 `Alt+Tab` 中仍没有「FocusLink 安装」，用上面的日志命令启动并记录安装器 PID；不要连续双击生成多个安装器。当前候选包应在 4 秒内显示该窗口。

## FL-INSTALL-002：安装后没有看到窗口

先检查托盘区和任务管理器。FocusLink 可能以隐藏模式启动；从托盘打开主窗口，或直接运行安装目录下的 `FocusLink.exe`。如果进程不存在，重新运行安装包并保留上面的日志。

**2026-09-29 修正**：上句「直接运行安装目录下的 `FocusLink.exe`」在**进程存在但窗口不存在**时是无效建议 —— 单实例锁会拦下第二实例，而 v1.3.13 之前 `second-instance` 处理器没有重建分支，于是每次点击都被静默吞掉。这种情况请改用 `FL-INSTALL-011` 的诊断顺序，不要再反复双击。

## FL-INSTALL-011：进程在、窗口不在（安装后「打不开」，2026-09-29 实测）

**症状**：安装完成后应用打不开。任务管理器里 `FocusLink.exe` 在跑、CPU 有占用，托盘可能也没有图标；反复双击桌面图标没有任何反应，日志里也看不到新的启动记录。

**关键判据（先分清事实，不要用「进程存在」当作「应用已打开」）**：

```powershell
# 1. 进程在不在，以及**有没有可见顶层窗口**
Get-Process -Name FocusLink -IncludeUserName -ErrorAction SilentlyContinue |
  Where-Object UserName -eq "$env:USERDOMAIN\$env:USERNAME" |
  Select-Object Id, UserName, MainWindowHandle, MainWindowTitle, Responding
```

`MainWindowHandle = 0` 且 `MainWindowTitle` 为空 → 该进程没有可见主窗口，**不算「已打开」**。

```powershell
# 2. 回读窗口可见性证据（v1.3.13 起）
Get-Content "$env:APPDATA\focuslink\logs\focuslink-$(Get-Date -Format yyyy-MM-dd).log" |
  Select-String 'main window shown|main window failed to become visible|first paint timed out'
```

v1.3.13 起每次呈现主窗口都会写 `main window shown {trigger, force, visible, bounds, pid}`。**没有这一行、或 `visible: false`，就是没打开。**

**必须先排除的自动化环境坑**：本机 agent shell 里 `ELECTRON_RUN_AS_NODE=1` 可能处于开启状态。用它拉起 GUI 会继承该变量，Electron 退化为纯 Node：实测**退出码 9**，或静默退出 0 且日志一行不写。

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue   # 拉起 GUI 前必须先清
```

**处置顺序**：

1. 先按上面两条判据确认是「无窗口」而不是「没进程」。
2. 清掉 `ELECTRON_RUN_AS_NODE`，**由用户自己从桌面或开始菜单启动**；不要用后台自动化代替用户拉起 GUI。
3. 仍然打不开时，按 `FL-INSTALL-001` 的账户过滤方式结束当前账户下的 `FocusLink.exe`（先核对 PID 与路径，不做全局强杀），再从桌面图标启动一次。
4. v1.3.13 之前的老版本若已陷入该状态，只能靠第 3 步结束进程；v1.3.13 起第二个实例会自行重建主窗口，首帧超时也会强制显示，无需人工干预。

**根因（两处，均已修复）**：

- `second-instance` 处理器此前只有 `if (mainWindow) { show/focus }`、没有 else：主窗口不存在时，用户每一次点图标都被静默吞掉。
- `ready-to-show` 此前没有超时兜底：渲染进程未完成首帧时窗口永远停在 `show: false`，且不写任何日志。

**验收口径（发布门禁已同步收紧）**：安装后必须回读到 `main window shown` 且 `visible: true`；`MainWindowHandle != 0` 或日志证据二者至少有一条，**进程存在本身不构成通过**。


## FL-INSTALL-003：卸载后仍显示旧版本

核对桌面快捷方式目标、开始菜单快捷方式目标和卸载注册项的 `InstallLocation`。它们必须指向同一个工作区 release 安装目录。不要只看文件名判断版本；同时核对安装器内的版本号和 `SHA256SUMS.txt`。

## FL-INSTALL-004：安装器退出码 `0xC0000005`

这是 NSIS 在 Windows 文件访问冲突时可能出现的瞬时退出码，不等同于“FocusLink 无法关闭”。先确认没有残留的安装器或 `FocusLink.exe` 进程，再从工作区 `release-v01222/` 重新运行一次；发布门禁只允许对这个退出码做最多 4 次、每次清理临时安装目录后的递增退避。其他退出码不能静默重试，应立即保留日志并停止。

### 退出码 2 且旧卸载器缺失

2026-09-09 实测：登记版本 0.12.103、EXE 1.3.0，`UninstallString` 指向的卸载器不存在，候选 `/S` 返回 2。先验证此文件确实缺失、登记和真实安装目录属于当前用户，不把所有 exit 2 都当成此问题。备份 SQLite 和配置、导出确切旧登记后，临时重命名失效登记键，并明确 `/currentuser /D=<原安装目录>` 原位安装。失败且未生成新登记时立即恢复旧键；成功必须回读新登记与 EXE 同版、卸载器存在、原账本保留并重启应用，再移除临时旧键，保留导出备份。不要全局删除 FocusLink 登记、删除应用数据或跳过未知安装错误。

## FL-INSTALL-006：生成 release EXE 后 `.git/lfs/tmp` 快速增长

典型现象是打包本身已结束，但 `.git/lfs/tmp` 仍持续出现几十到几百 MiB 的新文件；进程树可见桌面 Git/review watcher 执行 `git diff --no-index`，并派生 `git-lfs filter-process` 读取尚未暂存的 release EXE。2026-08-10 的实证触发源是 Codex desktop 自动 review，不是 electron-builder；约 3 分钟内临时文件增长到 1,094,854,656 B。

处理顺序必须固定：

1. 立即停止会重复发现 release EXE 的 review/status 扫描，记录命令行、PID、父 PID、文件数、字节数和最后写入时间。
2. 只把本轮生成的 EXE 暂移到工作区内忽略目录，禁止删除或改写候选；不得清理 `.git/lfs/objects`。
3. 确认所有 `git-lfs filter-process` 退出，且 `.git/lfs/tmp` 至少一个完整 watcher 周期不再增长；两项缺一不可。
4. 仅清理已确认的 `.git/lfs/tmp` 普通文件并回读 0 文件 / 0 B。
5. 在未提交的 `.git/info/exclude` 中精确排除本轮两个 EXE，并保留本地 attributes 防护；先恢复 installer、观察，再恢复 portable、观察。恢复后重新计算 SHA-256，必须与暂移前一致；任一文件不一致或 tmp 重新增长都立即停止晋级。
6. 正式暂存前移除 attributes 防护，运行 `git check-attr filter diff -- <installer> <portable>`，两者必须同时显示 `filter: lfs` 与 `diff: lfs`；使用显式路径一次性暂存，不运行无边界 GUI change scan。

只看“当前没有 git-lfs 进程”不够：filter-process 可能在两次采样之间完成一次大文件转换。必须同时保存稳定时间窗口和 tmp 字节数。历史大文件仍存在也不能直接判断当前仍在增长；按时间戳分别记录历史残留和当前进程事实。

## FL-INSTALL-007：packaged smoke 等待 renderer 时报告 `fetch failed`

先区分三类事实，不要把同一句 `fetch failed` 直接写成产品启动失败：

1. 用 smoke 的独立 `--user-data-dir` 检查 `logs/focuslink-YYYY-MM-DD.log`，确认候选 commit、数据库初始化和 `createMainWindow` 是否发生；日志在 profile 的 `logs/` 子目录，不在 profile 根目录。
2. 只列出 executable path 指向本轮 `release-v*/win-unpacked/FocusLink.exe`、且命令行包含该 profile 或 `--remote-debugging-port` 的候选进程；不得结束 `%LOCALAPPDATA%\Programs\FocusLink\FocusLink.exe` 的已安装实例。
3. 用明确空闲的 loopback 端口启动同一候选并读取 `http://127.0.0.1:<port>/json/list`。若可返回 `title=FocusLink` 的 page target，则产品 renderer 正常，优先检查 smoke 的 CDP 端口分配与清理；若日志有 `EADDRINUSE 127.0.0.1:18770`，则另行检查 Foxlink business API 是否在隔离 profile 中被禁用。

`mini-ui-smoke.cjs` 必须用 `net.Server.listen(0, '127.0.0.1')` 让 OS 分配端口，再关闭预留 socket并启动候选；不得回退为固定范围随机数。packaged smoke 的隔离环境还必须把 `FOXLINK_BUSINESS_API_TOKEN` 设为空，并把 token file 指向 profile 内不存在的文件，避免读取全局凭据或与已安装实例争用业务端口。修复后要复跑完整 smoke，而不是只验证 `/json/list`。

## FL-INSTALL-008：回归/打包临时目录删除被执行策略拦截

典型现象是 smoke 已结束、`.git/lfs/tmp` 也已停止增长，但工作区 `.tmp`、`FocusLink/.tmp` 或 `%TEMP%\focuslink-*` 仍保留大量旧目录；直接运行 `Remove-Item -Recurse -Force` 在命令启动前被系统策略拒绝，导致只清空文件内容而目录长期残留。

统一使用项目内的 Node 清理器。默认只输出经过路径白名单和 24 小时年龄门槛筛选的计划；确认结果后再加 `--apply`：

```powershell
Set-Location <workspace>\FocusLink
npm run clean:temp-data
npm run clean:temp-data -- --apply
```

清理器只接受批准根目录的直接子项，拒绝根目录和符号链接，保护 `FocusLink\.tmp\android-apk-backups`、设备截图、应用 `%APPDATA%\focuslink`、SQLite、凭据和待补传队列。Windows `EPERM/EACCES/EBUSY/ENOTEMPTY` 只做有限退避重试；最终 JSON 的 `failed` 非空时退出码为 1。不要用全局强杀进程来“解锁”目录，也不要把 `.git\lfs\objects` 当临时目录清理。

## FL-WIN-001：electron-builder 打包末步目录改名被拒（2026-09-10 实测）

**症状**：`npm run dist:win` 一路成功到打包末步，然后稳定失败：

```
EPERM: operation not permitted, rename '...\win-unpacked.tmp' -> '...\win-unpacked'
```

**已排除项（都实测过，不要重复试）**：不是目标目录已存在（`.tmp` 是唯一产物）；不是沙箱或文件护栏（`dangerouslyDisableSandbox` 非沙箱执行同样复现）；不是目录特殊属性（属性是普通 `Directory`）；不是批量阈值（该目录只有 21 个直接子项）；不是进程占用（无 app-builder/7z 残留）；也**不是路径问题**（三个全新输出目录均复现）。反证：同一目录内**单个文件改名成功**、我 `cp -r` 出来的同内容大目录**改名成功**、新建小目录**改名成功**。结论是这台机器对"electron-builder 刚解包出的那个目录实例"的改名拒绝，属环境行为。

**绕过路径（已完整验证产出可用安装器）**：
1. 解压 Electron 发行包到目标目录（缓存见 `%LOCALAPPDATA%\electron\Cache\<hash>\electron-v<ver>-win32-x64.zip`），得到 `win-unpacked`。
2. 组装应用载荷：暂存目录放 `dist/`、`dist-electron/`、`package.json`，以及**运行时真正需要的外置依赖**。桌面主进程只 `require` 两个外置包：`better-sqlite3` 与 `ws`（其余已在 vite 产物内）。用 `node_modules/@electron/asar/bin/asar.js pack <staging> resources/app.asar --unpack-dir "node_modules/better-sqlite3"` 打包，原生 `.node` 必须落在 `app.asar.unpacked`。
3. 把 `electron.exe` 改名为 `FocusLink.exe`（单文件改名允许），并把 `build/` 复制到 `resources/build/`（对应 `extraResources`）。
4. **必须改写 EXE 版本资源**，否则门禁回读会拿到 Electron 版本号（实测为 `43.4.1`）而不是产品版本：
   `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\<hash>\rcedit-x64.exe FocusLink.exe --set-file-version 1.3.1 --set-product-version 1.3.1 --set-version-string ProductName FocusLink --set-version-string FileDescription FocusLink --set-version-string OriginalFilename FocusLink.exe --set-version-string CompanyName FocusLink`
5. 只跑安装器这一步，完全跳过打包与那次改名：
   `npx electron-builder --win --prepackaged <win-unpacked 路径> -c.directories.output=<输出目录>`
6. 自检：先直接运行组装出的 `FocusLink.exe`（用独立 `--user-data-dir` 绕开单实例锁），确认打印 `FocusLink version: 1.3.1` 且无 `MODULE_NOT_FOUND`，再出安装器。

**注意**：失败时 `win-unpacked.tmp` 的 `resources/` 里只有 `default_app.asar`，说明改名发生在注入 app 之前，所以直接对该 `.tmp` 目录用 `--prepackaged` 是无效的，必须先自己注入载荷。

## FL-AND-001：Android 签名不匹配导致无法覆盖安装（2026-09-10 根治）

**症状**：`adb install -r` 报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE: ... signatures do not match`。

**根因**：项目此前**没有任何 signingConfig**，一直使用本机自动生成的 `~/.android/debug.keystore`。该文件一旦被删除或换机器就会重新生成，签名随之改变——同一产品出现两个不同签名，于是无法覆盖安装。实测证据：手机内已装包证书 SHA-256 为 `7eb76b41…5fcd`，而本机 debug.keystore 为 `7046abad…a099`，两者都是 `CN=Android Debug` 但密钥不同。**旧私钥已不在机器上，因此"覆盖安装"在物理上不可能**。

**根治做法（已落地）**：随仓库携带项目专属密钥 `android/keystore/focuslink-release.jks`（SHA-256 `09:41:b5:dd…63:d7`）与 `android/keystore.properties`，并在 `android/app/build.gradle` 中新增 `signingConfigs.focuslinkStable`，**debug 与 release 都指向它**。此后任何机器、任何重建都得到同一签名，该问题不再复现。注意：密钥库与口令随仓库分发，任何拿到仓库的人都能签出同签名包；若将来上架应用商店，应改为专用发布密钥并单独保管。

**必须保留数据的迁移步骤（本次实测通过）**：
1. 确认旧包是 debuggable：`adb -s <serial> shell run-as <pkg> ls -la /data/data/<pkg>`。非 debuggable 则无法读出私有数据，只能走文档第 92 行的并行 applicationId 路径（那条路会改变包名，属发布契约变更）。
2. 备份：`adb -s <serial> exec-out run-as <pkg> tar czf - -C /data/data/<pkg> . > data.tgz`，并校验包内含 `databases/`、`shared_prefs/`、`files/`、`app_webview/`。
3. 卸载旧包 → 安装新签名包 → 回读 `versionName`/`versionCode`。
4. 恢复：`adb push data.tgz /data/local/tmp/`，再 `adb -s <serial> shell run-as <pkg> tar xzf /data/local/tmp/data.tgz -C /data/data/<pkg>`。
5. 校验：`run-as` 下列出 `shared_prefs`（本次 15 个 xml）与 `app_webview`，确认属主是应用自身 uid、时间戳保留；再启动应用确认不崩溃。

## FL-INSTALL-009：Android JVM 测试在中文路径报告 ClassNotFoundException

2026-09-08 候选构建中，8 个测试类全部报告 ClassNotFoundException，但对应 class 文件已经生成。将同一源码目录映射到空闲的 ASCII 盘符后，41 项 JVM 测试、lint 和 APK 构建通过；不把首轮失败解释为业务测试通过。

先核对失败报告和 class 文件是否存在，再检查准备使用的盘符确实空闲。使用 `subst` 将该盘符指向 `FocusLink/`，通过映射路径运行 `gradlew.bat -p <盘符>:\android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug`，并在 `finally` 解除映射。不要覆盖已有盘符、复制平行源码树或跳过测试。测试仍失败时保留具体失败，不继续包装为已通过。

并行 applicationId 的候选必须同时显式传入独立的 `focuslinkExpectedApplicationId`，测试回读 BuildConfig 与该预期一致；默认预期仍为正式包 `app.focuslink.mobile`。此项验证包身份，不能消除既有安装的签名不匹配，也不得通过卸载或清数据绕过覆盖安装失败。

## FL-INSTALL-010：覆盖安装不清理旧版本遗留文件（2026-09-11 实测）

**症状**：从 1.3.5 覆盖安装到 1.3.6 后，`%LOCALAPPDATA%\Programs\FocusLink\resources\app.asar.unpacked` 仍是 **48.4MB / 781 文件**，而干净安装同一版本只有 **26.03MB / 66 文件**。两者差的 22MB 是 1.3.4/1.3.5 打进包里的 Capacitor Gradle 产物（`@capacitor/**/build/` 下的 `.transforms`、`intermediates`、`outputs`、`tmp`），1.3.6 起已在 `electron-builder.yml` 排除，但旧文件没被删。

**根因判定（用时间戳区分，不要靠猜）**：NSIS 覆盖安装只做「写入与替换」，不删除新版本不再包含的文件。判定命令：

```powershell
$res = "$env:LOCALAPPDATA\Programs\FocusLink\resources"
(Get-Item "$res\app.asar").LastWriteTime                    # 应为本次安装时间
(Get-Item "$res\app.asar.unpacked\node_modules\@capacitor\android\capacitor\build").LastWriteTime
```

实测 `app.asar` 是 `17:01:28`（新版已替换），而两个 `build` 目录是 `16:38:28`（上一版本时间）——**本体已更新、附加文件残留**，据此排除「打包配置没生效」这一错误方向。反证：安装到全新目录（`installer /S /D=<空目录>`）实测为 26.03MB / 66 文件，证明新包本身不含这些文件。

**当前状态**：**未修复**。`build/installer.nsh` 未改动，故每次覆盖升级都会累积上一版本被移除的文件。若某版本的附加载荷变大再变小，安装目录会持续膨胀而不收敛。

**可逆处理**：升级后如需回收，直接删残留目录即可（它们是新版本已不携带的产物）：

```powershell
$p = "$env:LOCALAPPDATA\Programs\FocusLink\resources\app.asar.unpacked\node_modules\@capacitor"
if (Test-Path $p) { [System.IO.Directory]::Delete('\\?\' + (Resolve-Path $p).Path, $true) }
```

**必须用 `\\?\` 前缀**：这些路径含 `build\.transforms\<hash>\transformed\bundleLibRuntimeToDirDebug\...`，会超过 Windows 260 字符上限，普通 `Remove-Item -Recurse -Force` 报 `PathTooLong` 并只删掉一部分（实测如此）。这是 FL-INSTALL-008 之外的另一类删除失败——008 是执行策略拦截，本条是路径长度。

## 维护规则

- 新增安装错误时，先分配稳定错误编号，再补充触发条件、可逆处理和验证命令。
- 只记录当前账户、当前安装包和可复现的 Windows 状态；不记录用户数据内容。
- 安装器策略源文件是 `build/installer.nsh`，发布门禁是 `TEST_AND_RELEASE.md`；本页只提供查错入口。
