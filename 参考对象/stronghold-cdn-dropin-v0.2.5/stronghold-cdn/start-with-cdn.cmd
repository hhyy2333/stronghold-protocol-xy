@echo off
rem One-click: serve this deployment with the art coming from the CDN.
rem Put this folder next to the deployment folder (the one with package.json), then double-click.
setlocal
cd /d "%~dp0.."
if "%SP_CDN_BASE%"=="" set SP_CDN_BASE=https://weishucdn.jiangjiangze.icu
if "%SP_CDN_TOKEN%"=="" set SP_CDN_TOKEN=v0.2.5-72d6ad63
if "%PORT%"=="" set PORT=3000
echo [cdn] deployment: %CD%
echo [cdn] art source: %SP_CDN_BASE%
node "%~dp0cdn-serve.mjs"
if errorlevel 1 (
  echo.
  echo [cdn] the launcher exited with an error. Is Node.js 18+ installed and on PATH?
  pause
)
endlocal
