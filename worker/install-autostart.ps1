# Registers "JobVibe Worker" in Task Scheduler: starts at your Windows sign-in,
# hidden, keeps running for days (no 3-day limit, keeps going on battery).
$ErrorActionPreference = 'Stop'
$name = 'JobVibe Worker'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$state = Join-Path $env:LOCALAPPDATA 'JobVibe'
New-Item -ItemType Directory -Force -Path $state | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $state 'stop')

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js is not installed (or not on PATH). Install it from https://nodejs.org and run this again.' -ForegroundColor Red
  exit 1
}
$repo = Split-Path -Parent $here
if (-not (Test-Path (Join-Path $repo '.env'))) {
  Write-Host "No .env in $repo. The worker needs DATABASE_URL and APP_PASSWORD there." -ForegroundColor Red
  exit 1
}

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + (Join-Path $here 'run-hidden.vbs') + '"') -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $name

Write-Host ''
Write-Host "Done. The JobVibe worker is running now and will start by itself whenever you sign in to Windows." -ForegroundColor Green
Write-Host "Log: $state\worker.log"
Write-Host 'JobVibe -> Applications shows "Apply worker running" within a minute or two.'
Write-Host 'To stop it for good: double-click worker\uninstall-autostart.cmd'
