@echo off
rem Double-clicked in an Oki release: runs files\install.ps1 beside it, which Windows does not run on a double-click.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0files\install.ps1" %*
pause
