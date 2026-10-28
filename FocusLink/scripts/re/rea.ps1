# FocusLink 逆向分析工具链（REA）
#
# 用途：用 REA（morluto/rea，npm 包 rea-agents）反查第三方 App 的界面与实现，
# 给移动端复刻或协议对照提供可复现的证据（每次调用都会返回 evidence_id）。
#
# 依赖的第三方二进制（脚本会在首次运行时自动下载到 $env:REA_TOOLS_DIR）：
#   - apktool 2.10.0 jar + 包装脚本 -> rea 的 apktool provider（解包资源/清单）
#   - jadx-headless-mcp 0.7.1 all.jar -> rea 的 jadx provider（类/方法反编译）
# 说明：0.7.1 的 jar 只在 1013503897/jadx-headless-mcp 的 release 里，Samael-Z 仓库没有该版本。
#
# 用法：
#   pwsh scripts/re/rea.ps1 package <apk>                 # APK 声明/清单
#   pwsh scripts/re/rea.ps1 decode  <apk> [-OutDir dir]   # 资源解码（apktool）
#   pwsh scripts/re/rea.ps1 class   <apk> <className>     # 类成员清单
#   pwsh scripts/re/rea.ps1 method  <apk> <className> <method> [--overload 0]
#   pwsh scripts/re/rea.ps1 sign    <apk>                 # 签名信息
#   pwsh scripts/re/rea.ps1 screen  <adbSerial>           # 抓一张真机屏幕
#   pwsh scripts/re/rea.ps1 doctor                        # 检查工具与版本
#
# 环境变量：
#   REA_TOOLS_DIR       工具缓存目录（默认 $env:LOCALAPPDATA\focuslink-re-tools）
#   REA_APKTOOL_JAR     已有 apktool jar 时直接指定，跳过下载
#   REA_JADX_MCP_JAR    已有 jadx-headless-mcp 0.7.1 jar 时直接指定，跳过下载
#   REA_ADB_PATH        adb 路径（默认取 Android SDK 的 platform-tools\adb.exe）

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('package', 'decode', 'class', 'method', 'sign', 'screen', 'doctor')]
  [string]$Command,
  [Parameter(Position = 1)][string]$Target,
  [Parameter(Position = 2)][string]$Arg1,
  [Parameter(Position = 3)][string]$Arg2,
  [string]$OutDir,
  [int]$Overload = 0
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ToolsDir = if ($env:REA_TOOLS_DIR) { $env:REA_TOOLS_DIR } else { Join-Path $env:LOCALAPPDATA 'focuslink-re-tools' }
New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null

function Write-Step([string]$message) { Write-Host "[re] $message" }

function Get-FileWithRetry([string]$uri, [string]$outFile, [int]$attempts = 3) {
  for ($i = 1; $i -le $attempts; $i++) {
    try {
      Invoke-WebRequest -Uri $uri -OutFile $outFile -UseBasicParsing -TimeoutSec 300
      if ((Get-Item $outFile).Length -gt 0) { return }
    } catch {
      Write-Step "下载失败（第 $i 次）：$($_.Exception.Message)"
      if ($i -eq $attempts) {
        Write-Step '改用 curl.exe 重试'
        & curl.exe -L --fail --retry 2 --silent --show-error -o $outFile $uri
        if ($LASTEXITCODE -eq 0 -and (Test-Path $outFile) -and (Get-Item $outFile).Length -gt 0) { return }
        throw "下载失败：$uri"
      }
      Start-Sleep -Seconds 2
    }
  }
}

function Ensure-Apktool {
  $jar = if ($env:REA_APKTOOL_JAR) { $env:REA_APKTOOL_JAR } else { Join-Path $ToolsDir 'apktool_2.10.0.jar' }
  if (-not (Test-Path $jar)) {
    Write-Step '下载 apktool 2.10.0'
    Get-FileWithRetry 'https://github.com/iBotPeaches/Apktool/releases/download/v2.10.0/apktool_2.10.0.jar' $jar
  }
  $bat = Join-Path $ToolsDir 'apktool.bat'
  if (-not (Test-Path $bat)) {
    "@echo off`r`njava -jar `"$jar`" %*`r`n" | Set-Content -Path $bat -Encoding ascii
  }
  $env:REA_APKTOOL_COMMAND = $bat
  return $bat
}

function Ensure-Jadx {
  $jar = if ($env:REA_JADX_MCP_JAR) { $env:REA_JADX_MCP_JAR } else { Join-Path $ToolsDir 'jadx-headless-mcp-0.7.1-all.jar' }
  if (-not (Test-Path $jar)) {
    Write-Step '下载 jadx-headless-mcp 0.7.1'
    Get-FileWithRetry 'https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar' $jar
  }
  $env:REA_JADX_MCP_JAR = $jar
  return $jar
}

function Ensure-Adb {
  if ($env:REA_ADB_PATH -and (Test-Path $env:REA_ADB_PATH)) { return $env:REA_ADB_PATH }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'),
    (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'),
    (Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe')
  ) | Where-Object { $_ -and (Test-Path $_) }
  if ($candidates.Count -eq 0) { throw '找不到 adb，请设置 REA_ADB_PATH' }
  $env:REA_ADB_PATH = $candidates[0]
  return $candidates[0]
}

function Invoke-Rea([string[]]$reaArgs) {
  $env:npm_config_yes = 'true'
  Push-Location $RepoRoot
  try {
    & npx --yes rea-agents@latest @reaArgs
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($code -ne 0) { throw "rea 退出码 $code" }
}

switch ($Command) {
  'doctor' {
    Ensure-Apktool | Out-Null
    Ensure-Jadx | Out-Null
    Ensure-Adb | Out-Null
    Write-Step "apktool   = $env:REA_APKTOOL_COMMAND"
    Write-Step "jadx-mcp  = $env:REA_JADX_MCP_JAR"
    Write-Step "adb       = $env:REA_ADB_PATH"
    Invoke-Rea @('inspect-apk-signature', '--help')
  }
  'package' {
    if (-not $Target) { throw '用法: rea.ps1 package <apk>' }
    Ensure-Jadx | Out-Null
    Invoke-Rea @('inspect-android-package', $Target, '--format', 'md')
  }
  'decode' {
    if (-not $Target) { throw '用法: rea.ps1 decode <apk> [-OutDir dir]' }
    Ensure-Apktool | Out-Null
    $dir = if ($OutDir) { $OutDir } else { Join-Path $ToolsDir ("decoded-" + [IO.Path]::GetFileNameWithoutExtension($Target)) }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Invoke-Rea @('decode-android-resources', $Target, '--format', 'md')
    Write-Step "解码目录由 rea 临时落盘；需要长期保存请用 apktool 直接解包到 $dir"
  }
  'class' {
    if (-not $Target -or -not $Arg1) { throw '用法: rea.ps1 class <apk> <className>' }
    Ensure-Jadx | Out-Null
    Invoke-Rea @('inspect-android-class', $Target, $Arg1, '--format', 'md')
  }
  'method' {
    if (-not $Target -or -not $Arg1 -or -not $Arg2) { throw '用法: rea.ps1 method <apk> <className> <method> [--overload n]' }
    Ensure-Jadx | Out-Null
    Invoke-Rea @('inspect-android-method', $Target, $Arg1, $Arg2, '--overload', "$Overload", '--format', 'md')
  }
  'sign' {
    if (-not $Target) { throw '用法: rea.ps1 sign <apk>' }
    Invoke-Rea @('inspect-apk-signature', $Target, '--format', 'md')
  }
  'screen' {
    if (-not $Target) { throw '用法: rea.ps1 screen <adbSerial>' }
    Ensure-Adb | Out-Null
    $dir = if ($OutDir) { $OutDir } else { Join-Path $ToolsDir 'screens' }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Invoke-Rea @('capture-adb-screen', $Target, '--output-directory', $dir, '--format', 'json')
  }
}
