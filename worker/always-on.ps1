# Keeps the JobVibe worker running: starts it, and starts it again when it stops
# (after a code update, which it detects itself, or after a crash).
#
#   powershell -ExecutionPolicy Bypass -File worker\always-on.ps1          dry run (fills, never submits)
#   powershell -ExecutionPolicy Bypass -File worker\always-on.ps1 -Live    real applications
#
# Stop it with Ctrl+C (twice if a worker is mid-run).
param([switch]$Live)

Set-Location (Join-Path $PSScriptRoot '..')
$mode = if ($Live) { 'LIVE: approved jobs are submitted' } else { 'dry run: nothing is submitted' }
Write-Host "JobVibe worker, always on ($mode). Ctrl+C to stop."
while ($true) {
  if ($Live) { node --env-file=.env worker/index.js } else { node --env-file=.env worker/index.js --dry-run }
  Write-Host "$(Get-Date -Format HH:mm:ss) worker stopped (exit $LASTEXITCODE); starting again in 5 s"
  Start-Sleep -Seconds 5
}
