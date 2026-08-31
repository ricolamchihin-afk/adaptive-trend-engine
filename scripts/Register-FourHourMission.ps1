# Register a Windows scheduled task that refreshes the Aster equity screen
# every 4 hours (aligned to 00:05 local, then every 4h). Paper only.

[CmdletBinding()]
param(
    [string]$TaskName = "ATE-AsterEquity-4h",
    [switch]$Standalone
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$mission = Join-Path $root "scripts\Invoke-FourHourMission.ps1"
if (-not (Test-Path $mission)) { throw "missing $mission" }

$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$mission`""
if ($Standalone) { $arg += " -Standalone" }

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 4) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName'."
Write-Host "It writes data\us-equity\latest.json and cio-brief.json every 4 hours."
Write-Host "Grok does not wake itself. After each run, feed cio-brief.json to the CIO bot."
Write-Host "To run now: powershell.exe -File `"$mission`" -Standalone"
Write-Host "To remove: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
