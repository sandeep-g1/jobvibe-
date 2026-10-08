# Keeps the JobVibe worker running: starts it, and starts it again when it stops
# (after a code update, which it detects itself, or after a crash).
#
#   powershell -ExecutionPolicy Bypass -File worker\always-on.ps1          dry run (fills, never submits)
#   powershell -ExecutionPolicy Bypass -File worker\always-on.ps1 -Live    real applications
#   ... -SkipAts workday     leave Workday jobs queued for a worker their owner starts
#
# Stop it with Ctrl+C (twice if a worker is mid-run).
param([switch]$Live, [string]$SkipAts = '')

Set-Location (Join-Path $PSScriptRoot '..')
$mode = if ($Live) { 'LIVE: approved jobs are submitted' } else { 'dry run: nothing is submitted' }
Write-Host "JobVibe worker, always on ($mode). Ctrl+C to stop."
while ($true) {
  $args2 = @('--env-file=.env', 'worker/index.js')
  if (-not $Live) { $args2 += '--dry-run' }
  if ($SkipAts) { $args2 += @('--skip-ats', $SkipAts) }
  & node @args2
  Write-Host "$(Get-Date -Format HH:mm:ss) worker stopped (exit $LASTEXITCODE); starting again in 5 s"
  Start-Sleep -Seconds 5
}
