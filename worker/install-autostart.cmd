@echo off
rem Double-click once: the JobVibe apply worker then runs in the background every
rem time you sign in to Windows, with no window to keep open.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1"
pause
