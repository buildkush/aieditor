@echo off
cd /d "%~dp0"
echo Starting aiditor desktop application...
call npm.cmd run tauri dev
pause
