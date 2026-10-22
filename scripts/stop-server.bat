@echo off
rem Gracefully stop only this installation's authenticated server (default 3000; e.g. --port 3001).
chcp 65001 >nul
cd /d "%~dp0.."
node scripts\free-port.mjs %*
pause
