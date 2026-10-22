@echo off
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-multiplayer.ps1"
if errorlevel 1 pause
