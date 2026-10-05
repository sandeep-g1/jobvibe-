@echo off
rem Start the JobVibe apply worker on this PC. Leave this window open.
rem It checks every minute for jobs approved in Telegram and applies to them.
rem Add  --dry-run  to fill forms without submitting, or  --headed  to watch the browser.
cd /d "%~dp0.."
node --no-warnings worker\index.js %*
pause
