@echo off
rem Double-click: start the server + cloudflared public tunnel, print the addresses, keep showing logs.
chcp 65001 >nul
title 卫戍协议：盟约 - 服务器 + 公网隧道
cd /d "%~dp0.."
call "%~dp0start-windows.bat" --tunnel %*
