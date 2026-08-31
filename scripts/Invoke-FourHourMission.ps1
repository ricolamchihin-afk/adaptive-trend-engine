# Four-hour mission: refresh the Aster equity screen and write CIO files.
# Register this with Register-FourHourMission.ps1 (Windows Task Scheduler).
# Paper only.

[CmdletBinding()]
param(
    [switch]$Standalone,
    [int]$Limit = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "scripts\Screen-AsterEquityPerps.ps1"))) {
    $root = $PWD.Path
}
$dir = Join-Path $root "data\us-equity"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$screenPs1 = Join-Path $root "scripts\Screen-AsterEquityPerps.ps1"
$rawPath = Join-Path $dir "aster-equity-screen.json"
$args = @("-File", $screenPs1, "-OutFile", $rawPath)
if ($Standalone) { $args += "-Standalone" }
if ($Limit -gt 0) { $args += "-Limit"; $args += "$Limit" }

Write-Host "4h mission: screening Aster equity perps..."
& powershell.exe @args
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    throw "screen_failed exit=$LASTEXITCODE"
}

$raw = Get-Content -Raw -LiteralPath $rawPath | ConvertFrom-Json
$now = [DateTime]::UtcNow
$bucket = $now.AddMinutes(-$now.Minute).AddSeconds(-$now.Second).AddMilliseconds(-$now.Millisecond)
$bucket = $bucket.AddHours(-($bucket.Hour % 4))
$stamp = $bucket.ToString("yyyyMMdd-HHmm") + "Z"

$enterLong = @($raw.screens | Where-Object { $_.setup.action -eq "ENTER_LONG" })
$enterShort = @($raw.screens | Where-Object { $_.setup.action -eq "ENTER_SHORT" })
$waitLong = @($raw.screens | Where-Object { $_.setup.bias -eq "LONG" -and $_.setup.action -eq "WAIT" })
$waitShort = @($raw.screens | Where-Object { $_.setup.bias -eq "SHORT" -and $_.setup.action -eq "WAIT" })

function Compact-Row($row) {
    return [ordered]@{
        base        = $row.base
        asterSymbol = $row.asterSymbol
        cashTicker  = $row.cashTicker
        mark        = $row.mark
        source      = $row.source
        bias        = $row.setup.bias
        action      = $row.setup.action
        reasons     = @($row.setup.reasons)
        dailyDir    = $row.indicators.dailyDir
        rsi         = $row.indicators.rsi
        adx         = $row.indicators.adx
        atr         = $row.indicators.atr
    }
}

$brief = [ordered]@{
    role           = "cio_brief"
    paperOnly      = $true
    generatedAt    = $raw.generatedAt
    fourHourBucket = $bucket.ToString("o")
    venue          = "aster_usdt_perps"
    summary        = $raw.summary
    enterLong      = @($enterLong | ForEach-Object { Compact-Row $_ })
    enterShort     = @($enterShort | ForEach-Object { Compact-Row $_ })
    waitLong       = @($waitLong | ForEach-Object { Compact-Row $_ })
    waitShort      = @($waitShort | ForEach-Object { Compact-Row $_ })
    instruction    = "You are the CIO. Recommend only from this brief. ENTER_* first, then WAIT. Do not invent names. Paper only."
}

$latest = Join-Path $dir "latest.json"
$briefPath = Join-Path $dir "cio-brief.json"
$archive = Join-Path $dir "mission-$stamp.json"
$brief | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $briefPath
Copy-Item -Force $rawPath $latest
Copy-Item -Force $briefPath $archive

$cio = @"
You are the CIO of a paper Aster equity-perp book.
This file is a 4h snapshot, not a live stream. Recommend only from cio-brief.json / latest.json.
Priority: ENTER_LONG and ENTER_SHORT, then WAIT, then FLAT.
Never place, cancel, or resize an order. Never invent names or candles.
End with: paper only, wait for the next 4h snapshot.
"@
Set-Content -Encoding UTF8 -LiteralPath (Join-Path $dir "cio-instructions.txt") -Value $cio

Write-Host ""
Write-Host "Mission files:"
Write-Host "  $latest"
Write-Host "  $briefPath"
Write-Host "  $archive"
Write-Host ("ENTER_LONG={0} ENTER_SHORT={1} WAIT_LONG={2} WAIT_SHORT={3}" -f $enterLong.Count, $enterShort.Count, $waitLong.Count, $waitShort.Count)
Write-Host "Give Grok (CIO) cio-brief.json plus cio-instructions.txt."
