@echo off
setlocal

REM 独自サーバー（/onkan/）向けビルド
cd /d "%~dp0"
set VITE_BASE_PATH=/onkan/
npm run build

endlocal
