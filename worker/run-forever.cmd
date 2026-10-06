@echo off
rem Keeps the JobVibe apply worker running: starts it, and restarts it 30 seconds
rem after it stops (crash, lost network). Started hidden at sign-in by
rem install-autostart.cmd; you don't run this yourself.
rem Output goes to %LOCALAPPDATA%\JobVibe\worker.log
setlocal
set "DIR=%LOCALAPPDATA%\JobVibe"
set "LOG=%DIR%\worker.log"
if not exist "%DIR%" mkdir "%DIR%"
cd /d "%~dp0.."

:loop
if exist "%DIR%\stop" goto end
rem Keep the log small: past 5 MB it becomes worker.old.log
for %%F in ("%LOG%") do if %%~zF GTR 5000000 move /y "%LOG%" "%DIR%\worker.old.log" >nul
echo ==== %date% %time% starting worker >> "%LOG%"
node --no-warnings worker\index.js %* >> "%LOG%" 2>&1
rem 3 = another worker is already running on this PC: nothing to keep alive.
if %errorlevel%==3 goto end
echo ==== %date% %time% worker stopped (code %errorlevel%), restarting in 30 s >> "%LOG%"
ping -n 31 127.0.0.1 >nul
goto loop

:end
endlocal
