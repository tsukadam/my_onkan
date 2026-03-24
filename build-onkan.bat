@echo off
setlocal
REM Production build for /onkan/. Edit URL below; long meta text: UTF-8 file seo-description.txt (gitignored).
cd /d %~dp0
set VITE_BASE_PATH=/onkan/
set VITE_SEO_PUBLIC_URL=https://service.aramugi.com/onkan
REM Optional: override OG image (default build uses .../pwa-icon.svg). PNG 1200x630 is safest for scrapers.
call npm run build
endlocal
