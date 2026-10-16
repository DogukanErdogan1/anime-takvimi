@echo off
setlocal
title Anime Takvimi - Yerel Onizleme
set "ANIME_PROJECT=%~dp0"
if not exist "%ANIME_PROJECT%package.json" set "ANIME_PROJECT=%~dp0..\work\anime-membership"
set "ANIME_NODE_DIR=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "ANIME_NODE=%ANIME_NODE_DIR%\node.exe"
if not exist "%ANIME_PROJECT%\package.json" (
  echo Proje klasoru bulunamadi: %ANIME_PROJECT%
  pause
  exit /b 1
)
if not exist "%ANIME_NODE%" set "ANIME_NODE=node"
"%ANIME_NODE%" --version >nul 2>&1
if errorlevel 1 (
  echo Node.js bulunamadi veya etkin bir surum secilmedi.
  echo Node.js 22.13 veya uzerini kurup proje klasorunde npm run dev calistirin.
  pause
  exit /b 1
)
if not exist "%ANIME_PROJECT%\node_modules\vinext\dist\cli.js" (
  echo Bagimliliklar eksik. Proje klasorunde npm ci calistirin.
  pause
  exit /b 1
)
cd /d "%ANIME_PROJECT%"
set "PATH=%ANIME_NODE_DIR%;%PATH%"
"%ANIME_NODE%" scripts/open-local.mjs %*
set "ANIME_EXIT_CODE=%ERRORLEVEL%"
if not "%ANIME_EXIT_CODE%"=="0" pause
exit /b %ANIME_EXIT_CODE%
