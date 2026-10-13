@echo off
rem 卫戍协议：盟约 0.3.0（含海克斯）— 从源码树启动。
rem 注意：整合包 Stronghold-Protocol\ 是 v0.2.1，里面没有海克斯，不要用它启动。
rem 双击本文件即可；参数会原样传给 scripts\launch.mjs，例如： 开始游戏-0.3.0.bat --port 3001
chcp 65001 >nul
setlocal EnableExtensions
title 卫戍协议：盟约 0.3.0
cd /d "%~dp0Stronghold-Protocol-repo"

where node >nul 2>nul
if errorlevel 1 goto :nonode
node -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)"
if errorlevel 1 goto :oldnode

if not exist "node_modules\ws\package.json" (
  echo [首次运行] 正在安装依赖 npm ci ...
  call npm ci --no-audit --no-fund || call npm install --no-audit --no-fund || goto :fail
)

rem --no-setup：依赖、vendor 库和美术都已就位（美术走 public\assets junction），跳过 setup 的联网下载
node scripts\launch.mjs --no-setup %*
if errorlevel 1 goto :fail
exit /b 0

:nonode
echo.
echo 未找到 Node.js（需要 22 或更高，22 / 24 LTS）：https://nodejs.org/zh-cn/download
echo.
pause
exit /b 1

:oldnode
echo.
for /f "delims=" %%v in ('node -v') do echo 当前 Node.js 版本 %%v 太旧，需要 22 或更高（22 / 24 LTS）。
echo.
pause
exit /b 1

:fail
echo.
echo 启动失败，请看上面的信息。诊断：node tools\doctor.mjs
echo.
pause
exit /b 1
