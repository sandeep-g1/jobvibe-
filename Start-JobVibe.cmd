@echo off
rem JobVibe: start the always-on worker (real applications, inbox, CV tailoring).
rem Put a shortcut to this file in the Startup folder (Win+R, shell:startup) to start it with Windows.
rem Safe to run twice: if the worker is already running, it does nothing.

cd /d "%~dp0"

powershell -NoProfile -Command "if (Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*-File*always-on.ps1*' }) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo JobVibe worker is already running.
  timeout /t 5 >nul
  exit /b 0
)

rem Give Wi-Fi a minute to connect after the PC starts.
echo Starting JobVibe worker in 60 seconds...
timeout /t 60 /nobreak >nul

start "JobVibe worker" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0worker\always-on.ps1" -Live -SkipAts workday
