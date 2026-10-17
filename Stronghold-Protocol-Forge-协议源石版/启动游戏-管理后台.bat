@echo off
rem 卫戍协议：盟约 · 协议源石版 —— 带「监控后台（/admin/）」启动。
rem
rem 与 启动游戏.bat 的唯一区别：启动前设置 ADMIN_SECRET（不设置时源码里没有默认口令，/api/admin/* 一律 404，
rem 面板也不存在）。口令存在本 bat 旁边的 admin-secret.local.txt，重启不变、不会被提交。
rem
rem 双击即可；参数照原样传给 app\scripts\launch.mjs，例如： 启动游戏-管理后台.bat --port 3001
chcp 65001 >nul
setlocal EnableExtensions
title 卫戍协议：盟约 协议源石版（管理后台）
set "HERE=%~dp0"

set "NODE="
if exist "%HERE%node\node.exe" set "NODE=%HERE%node\node.exe"
if not defined NODE set "NODE=node"

rem 固定口令的文件（就在本 bat 旁边，包外面不会被提交）：一行，只有口令本身，不带引号
set "SECRET_FILE=%HERE%admin-secret.local.txt"

rem 口令优先级：环境变量 ADMIN_SECRET ＞ 上面的文件 ＞ 现场生成并写进该文件
set "SECRET_SRC="
if not defined ADMIN_SECRET if exist "%SECRET_FILE%" (
  rem 用 node 读并 trim：手改过的文件可能带 BOM 或行尾空格，直接 for /f 会把它们一起当成口令的一部分
  for /f "delims=" %%s in ('"%NODE%" -e "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8').trim())" "%SECRET_FILE%"') do if not defined ADMIN_SECRET set "ADMIN_SECRET=%%s"
  if defined ADMIN_SECRET set "SECRET_SRC=文件 admin-secret.local.txt（固定口令）"
)
if not defined SECRET_SRC if defined ADMIN_SECRET set "SECRET_SRC=环境变量 ADMIN_SECRET"

rem 两样都没有 → 现场生成一串并落盘。写成独立语句、不塞进同一对括号：括号里的 %ADMIN_SECRET% 会在赋值之前就被展开成空
set "FRESH="
if not defined ADMIN_SECRET set "FRESH=1"
if defined FRESH for /f "delims=" %%s in ('"%NODE%" -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))"') do set "ADMIN_SECRET=%%s"
if defined FRESH if defined ADMIN_SECRET >"%SECRET_FILE%" echo %ADMIN_SECRET%
if defined FRESH if defined ADMIN_SECRET set "SECRET_SRC=新生成，已存入 admin-secret.local.txt（以后重启都用它）"
if not defined ADMIN_SECRET goto :nosecret

rem 下面的自检和自动登录要知道端口：优先 --port 参数，其次环境变量 PORT，最后默认 3000
set "ADMIN_PORT=3000"
if defined PORT set "ADMIN_PORT=%PORT%"
set "TAKE_NEXT="
for %%a in (%*) do (
  if /i "%%a"=="--port" (set "TAKE_NEXT=1") else (if defined TAKE_NEXT (set "ADMIN_PORT=%%a" & set "TAKE_NEXT="))
)

echo.
echo ============================================================
echo  管理后台已启用（口令就在下面，别贴到公网/聊天里）
echo.
echo   口令 : %ADMIN_SECRET%
echo   来源 : %SECRET_SRC%
echo   面板 : http://localhost:%ADMIN_PORT%/admin/
echo   自检 : powershell -ExecutionPolicy Bypass -File "%HERE%admin-selfcheck.ps1" -Port %ADMIN_PORT%
echo.
echo  固定口令：口令存在 %SECRET_FILE%，重启后还是这一个，浏览器不用重新输。
echo  想换口令：删掉上面那个文件再双击本文件（会生成新的），或先 set ADMIN_SECRET=... 再双击。
echo  服务器起来后会自动：另开一个「管理接口自检」窗口逐条报告各接口状态；等游戏页开出来之后（约 4 秒）
echo  再用 explorer.exe 打开面板，口令自动填好、不用手输（地址用 URL 片段传口令，片段不会发给服务器）。
echo  如果浏览器没自动开面板：自检窗口最后会打印一行能直接粘进地址栏的地址，连同令牌。
echo  只想本机可访问（面板连局域网也不暴露）：先执行  set HOST=127.0.0.1  再双击本文件。
echo ============================================================
echo.

rem 独立窗口：等服务器起来 → 打印各接口状态 → 打开自动登录的面板页（-NoExit：留着窗口给操作者看结果）
start "管理接口自检" powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "%HERE%admin-selfcheck.ps1" -Port %ADMIN_PORT% -Token "%ADMIN_SECRET%"

rem --no-setup：依赖、vendor 库和美术都已就位，跳过 setup 的联网下载
"%NODE%" "%HERE%app\scripts\launch.mjs" --no-setup %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" pause
exit /b %CODE%

:nosecret
echo.
echo 没能生成 ADMIN_SECRET（node 调用失败）。请手动执行：
echo   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
echo 把输出的值写进 admin-secret.local.txt（或 set 到环境变量 ADMIN_SECRET）再启动。
echo.
pause
exit /b 1
