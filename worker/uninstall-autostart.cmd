@echo off
rem Stops the background JobVibe worker and removes it from Windows sign-in.
setlocal
set "DIR=%LOCALAPPDATA%\JobVibe"
if not exist "%DIR%" mkdir "%DIR%"
rem The stop file keeps run-forever.cmd from restarting the worker.
echo stop> "%DIR%\stop"
schtasks /End /TN "JobVibe Worker" >nul 2>&1
schtasks /Delete /TN "JobVibe Worker" /F >nul 2>&1
rem The worker's process id is in its lock file.
set "LOCK=%TEMP%\jobvibe-worker.lock"
if exist "%LOCK%" (
  set /p PID=<"%LOCK%"
  call taskkill /PID %%PID%% /T /F >nul 2>&1
  del "%LOCK%" >nul 2>&1
)
echo JobVibe worker stopped and removed from sign-in.
echo Run install-autostart.cmd to turn it back on.
pause
endlocal
