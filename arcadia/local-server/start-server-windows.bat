@echo off
chcp 65001 >nul
cd /d "%~dp0"
title АРКАДИЯ — локальный сервер
where node >nul 2>nul || (echo Установите Node.js: https://nodejs.org & pause & exit /b 1)
node server.mjs %*
pause
