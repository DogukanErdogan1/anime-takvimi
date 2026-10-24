@echo off
setlocal
title Anime Takvimi - Yerel Onizleme
set "ANIME_PROJECT="
rem Packaged output has no node_modules. Reuse the installed working copy.
for %%P in ("%~dp0." "%~dp0..\work\anime-membership" "%~dp0..\..\work\anime-membership") do (
  if not defined ANIME_PROJECT if exist "%%~fP\package.json" if exist "%%~fP\scripts\open-local.mjs" if exist "%%~fP\node_modules\vinext\dist\cli.js" set "ANIME_PROJECT=%%~fP"
)
if not defined ANIME_PROJECT (
  echo Calismaya hazir proje bulunamadi.
  echo Paketleri kurmak icin package.json bulunan proje klasorunde npm ci calistirin.
  pause
  exit /b 1
)
set "ANIME_NODE_DIR=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "ANIME_NODE=%ANIME_NODE_DIR%\node.exe"
if not exist "%ANIME_NODE%" set "ANIME_NODE=node"
"%ANIME_NODE%" --version >nul 2>&1
if errorlevel 1 (
  echo Node.js bulunamadi veya etkin bir surum secilmedi.
  echo Node.js 22.13 veya uzerini kurup proje klasorunde npm run dev calistirin.
  pause
  exit /b 1
)
cd /d "%ANIME_PROJECT%"
if errorlevel 1 exit /b 1
echo Proje: %ANIME_PROJECT%
set "PATH=%ANIME_NODE_DIR%;%PATH%"
"%ANIME_NODE%" scripts/open-local.mjs %*
set "ANIME_EXIT_CODE=%ERRORLEVEL%"
if not "%ANIME_EXIT_CODE%"=="0" pause
exit /b %ANIME_EXIT_CODE%
