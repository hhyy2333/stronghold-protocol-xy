@echo off
rem ============================================================================
rem  Stronghold Protocol: Alliance 0.19.0 (Forge build) - Windows launcher
rem
rem  KEEP THIS FILE ASCII-ONLY WITH CRLF LINE ENDINGS.  Do not add Chinese text,
rem  and do not save it with LF-only line endings.
rem
rem  Why: cmd.exe reads a .bat with the console's OEM/ANSI code page (936 here),
rem  never as UTF-8.  A UTF-8 .bat that also contains Chinese makes cmd's
rem  byte/character offsets drift, so it executes fragments of lines instead of
rem  the lines themselves ("'ho' is not recognized...", 'The system cannot find
rem  the path specified'), and with LF-only endings it dies right away: the
rem  window flashes and closes.
rem
rem  All Chinese text the player needs is printed by app\scripts\launch.mjs (an
rem  .mjs file is read as UTF-8, which is safe), so this launcher stays ASCII.
rem ============================================================================
chcp 65001 >nul
setlocal EnableExtensions
rem  Boss-hit limit (leaders: a single hit >= 300000 is voided) is OFF for this local launch.
rem  app\shared\constants.js bossHitLimitFrom reads it; set it to a number (e.g. 300000) to restore.
set "SP_BOSS_HIT_LIMIT=off"
title Stronghold Protocol 0.19.0
set "HERE=%~dp0"

rem ---- locate the game folder (its name has Chinese characters -> glob it) ----
set "FORGE="
for /d %%D in ("%HERE%Stronghold-Protocol-Forge-*") do if exist "%%~fD\app\scripts\launch.mjs" set "FORGE=%%~fD"
if not defined FORGE for /d %%D in ("%HERE%*") do if exist "%%~fD\node\node.exe" set "FORGE=%%~fD"
if not defined FORGE goto :noforge
if not exist "%FORGE%\app\scripts\launch.mjs" goto :nolauncher

set "NODE=%FORGE%\node\node.exe"
if not exist "%NODE%" set "NODE=node"

rem ---- hand over to the app's own launcher -----------------------------------
rem  launch.mjs already: reuses a server that is already listening, finishes a
rem  pending update, starts server\index.js and opens the browser only once
rem  /healthz answers.  Extra arguments pass through, e.g.
rem    --port 3001          another port
rem    --host 127.0.0.1     this machine only, no LAN
rem    --no-open            do not open the browser
rem  --no-setup: dependencies, vendor libs and art are already in the build.
pushd "%FORGE%\app"
"%NODE%" scripts\launch.mjs --no-setup %*
set "CODE=%ERRORLEVEL%"
popd

if "%CODE%"=="0" exit /b 0
echo.
echo Launch failed with exit code %CODE% - see the messages above.
pause
exit /b %CODE%

:noforge
echo.
echo Game folder not found: expected a "Stronghold-Protocol-Forge-*" folder
echo next to this .bat, containing app\scripts\launch.mjs.
echo Move this .bat back into the extracted game folder and run it again.
pause
exit /b 1

:nolauncher
echo.
echo "%FORGE%\app\scripts\launch.mjs" is missing - the game files are incomplete.
echo Re-extract the game package and try again.
pause
exit /b 1
