# admin-selfcheck.ps1 — 管理后台：等服务器起来 → 逐条自检接口 → 打开「已自动登录」的面板（本机测试用）。
#
# 由 开始游戏-0.3.0-管理后台.bat 自动调用；也可以手动跑（不给 -Token 就从固定口令文件里读）：
#   powershell -ExecutionPolicy Bypass -File admin-selfcheck.ps1 -Port 3000
#   powershell -ExecutionPolicy Bypass -File admin-selfcheck.ps1 -Port 3000 -Token <ADMIN_SECRET>
# 可选开关：-NoBrowser 只自检、不开浏览器；-Announce "文本" 顺便测一次发布公告；-Withdraw 顺便测一次撤回。
# 注意：Windows PowerShell 5.1 传参的编码会把 -Announce 里的中文变成「?」——中文公告请在面板里发。
#
# 只探测一次「不带口令」（期望 401）：服务器对同一来源地址连续 10 次失败会锁 60 秒，
# 这里紧接着就用正确口令请求一次（成功会清掉失败计数），不会把本机自己锁在门外。
param(
  [int]$Port = 3000,
  [string]$Token = '',
  [string]$TokenFile = "$PSScriptRoot\admin-secret.local.txt",
  [switch]$NoBrowser,
  [int]$OpenDelaySec = 4,
  [string]$Announce = '',
  [switch]$Withdraw
)

$ErrorActionPreference = 'Stop'

# 没给 -Token 就退回到固定口令文件（和 开始游戏-0.3.0-管理后台.bat 用的是同一份）
if (-not $Token -and $TokenFile -and (Test-Path -LiteralPath $TokenFile)) {
  $Token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
}
if (-not $Token) {
  Write-Host "没有口令：用 -Token 传一个，或把口令单独一行写进 $TokenFile。" -ForegroundColor Red
  return
}

$base = "http://127.0.0.1:$Port"
$auth = @{ Authorization = "Bearer $Token" }

function Get-Status($url, $headers) {
  try {
    return [int](Invoke-WebRequest -Uri $url -Headers $headers -UseBasicParsing -TimeoutSec 8).StatusCode
  } catch {
    $resp = $_.Exception.Response
    if ($resp) { return [int]$resp.StatusCode }
    return -1   # 连不上：服务器没起来 / 端口不对
  }
}

Write-Host ''
Write-Host "==== 管理接口自检 · $base ====" -ForegroundColor Cyan
Write-Host '等待服务器启动…' -NoNewline
$up = $false
for ($i = 0; $i -lt 90; $i++) {
  if ((Get-Status "$base/healthz" @{}) -eq 200) { $up = $true; break }
  Start-Sleep -Milliseconds 700
}
if (-not $up) {
  Write-Host ''
  Write-Host '没等到服务器（看主窗口的报错，或 -Port 是不是填错了）。' -ForegroundColor Red
  return
}
Write-Host ' 就绪'
Write-Host ''

$checks = @(
  @{ Name = '面板 /admin/（静态页）'; Url = "$base/admin/";                  Headers = @{};   Expect = 200 },
  @{ Name = '不带口令（应 401）';     Url = "$base/api/admin/overview";      Headers = @{};   Expect = 401 },
  @{ Name = 'overview 总览';          Url = "$base/api/admin/overview";      Headers = $auth; Expect = 200 },
  @{ Name = 'rooms 房间';             Url = "$base/api/admin/rooms";         Headers = $auth; Expect = 200 },
  @{ Name = 'logs 实时日志';          Url = "$base/api/admin/logs?since=0";  Headers = $auth; Expect = 200 },
  @{ Name = 'feedback 玩家反馈';      Url = "$base/api/admin/feedback";      Headers = $auth; Expect = 200 },
  @{ Name = 'announcements 公告历史'; Url = "$base/api/admin/announcements"; Headers = $auth; Expect = 200 }
)

$failed = 0
foreach ($c in $checks) {
  $code = Get-Status $c.Url $c.Headers
  $ok = ($code -eq $c.Expect)
  if (-not $ok) { $failed++ }
  $color = if ($ok) { 'Green' } else { 'Red' }
  Write-Host ("  [{0}] {1,-22} → {2}（期望 {3}）" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $c.Name, $code, $c.Expect) -ForegroundColor $color
}

if ($Announce -ne '') {
  try {
    $body = @{ text = $Announce } | ConvertTo-Json -Compress
    $r = Invoke-WebRequest -Uri "$base/api/admin/announce" -Method POST -Headers $auth -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 8
    Write-Host ("  [PASS] 发布公告              → {0} {1}" -f [int]$r.StatusCode, $r.Content) -ForegroundColor Green
  } catch {
    $failed++
    Write-Host ("  [FAIL] 发布公告              → {0}" -f $_.Exception.Message) -ForegroundColor Red
  }
}
if ($Withdraw) {
  try {
    $r = Invoke-WebRequest -Uri "$base/api/admin/announce/withdraw" -Method POST -Headers $auth -UseBasicParsing -TimeoutSec 8
    Write-Host ("  [PASS] 撤回公告              → {0} {1}" -f [int]$r.StatusCode, $r.Content) -ForegroundColor Green
  } catch {
    $failed++
    Write-Host ("  [FAIL] 撤回公告              → {0}" -f $_.Exception.Message) -ForegroundColor Red
  }
}

Write-Host ''
if ($failed -eq 0) {
  Write-Host '全部通过。' -ForegroundColor Green
} else {
  Write-Host "$failed 项不符合预期：口令对吗？服务器启动时设了 ADMIN_SECRET 吗？" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------------------------------
# 打开面板：走 explorer.exe（和游戏启动器 scripts/open-browser.mjs 同一档），而不是 Start-Process <url>。
# 后者用调用者自己的令牌做 shell 关联：启动器一旦是提权的，Edge/Chrome 会被拉成提权实例，Edge 只会弹
# 「现有实例正在以提升的权限运行」而不开页面——「游戏页开了、面板页没开」多半就是这一条。
# 另外故意晚几秒：启动器同时打开的游戏页先出现，面板标签页最后开，就落在最前面。
# ---------------------------------------------------------------------------------------------------
function Open-AdminPanel {
  $auto = "http://localhost:$Port/dev/admin-auto.html#t=$Token"
  Write-Host "等 $OpenDelaySec 秒再开面板（让游戏页先开出来，面板标签页落在最前面）…" -ForegroundColor DarkGray
  Start-Sleep -Seconds $OpenDelaySec
  $via = ''
  try {
    $explorer = Join-Path $env:SystemRoot 'explorer.exe'
    $rundll = Join-Path $env:SystemRoot 'System32\rundll32.exe'
    if (Test-Path -LiteralPath $explorer) {
      Start-Process -FilePath $explorer -ArgumentList $auto
      $via = 'explorer.exe'
    } elseif (Test-Path -LiteralPath $rundll) {
      Start-Process -FilePath $rundll -ArgumentList 'url.dll,FileProtocolHandler', $auto
      $via = 'rundll32'
    }
  } catch {
    Write-Host "打开浏览器失败：$($_.Exception.Message)" -ForegroundColor Yellow
  }
  if ($via) {
    Write-Host "已通过 $via 打开面板（口令自动填好，不用手输）。没看到面板就点下面第一行。" -ForegroundColor Cyan
  } else {
    Write-Host '这台机器上没找到 explorer.exe / rundll32，请手动打开下面第一行：' -ForegroundColor Yellow
  }
  Write-Host '  面板（自动登录）: ' -NoNewline -ForegroundColor DarkGray
  Write-Host $auto -ForegroundColor Cyan
  Write-Host '  面板（手动登录）: ' -NoNewline -ForegroundColor DarkGray
  Write-Host "http://localhost:$Port/admin/" -ForegroundColor Cyan
  Write-Host "  令牌            : $Token" -ForegroundColor DarkGray
}

if ($NoBrowser -or $env:SP_ADMIN_NO_BROWSER) {
  Write-Host '（未开浏览器）面板自动登录地址：' -NoNewline
  Write-Host "http://localhost:$Port/dev/admin-auto.html#t=$Token" -ForegroundColor DarkGray
} else {
  Open-AdminPanel
}
Write-Host ''
