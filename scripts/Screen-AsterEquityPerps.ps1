# Screen every Aster equity perp (STOCK + ETF) and write one JSON.
#
# PyCharm:
#   Run → Edit Configurations → + → Shell Script
#   Script path:      scripts/Screen-AsterEquityPerps.ps1
#   Working directory: $ProjectFileDir$
#   Interpreter:      powershell.exe   (or pwsh.exe)
#
# Optional parameters (Script options / Program arguments):
#   -EngineUrl http://127.0.0.1:43871
#   -Standalone              # skip the local engine, screen in this script
#   -PopulationOnly          # write the Aster list only, no signals
#   -Limit 10                # first N names (smoke test)
#   -OutFile C:\temp\screen.json
#
# Paper only. Does not place Aster orders.

[CmdletBinding()]
param(
    [string]$EngineUrl = "http://127.0.0.1:43871",
    [string]$OutFile = "",
    [switch]$Standalone,
    [switch]$PopulationOnly,
    [int]$Limit = 0,
    [int]$YahooDelayMs = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = "Continue"

$UserAgent = "AdaptiveTrendEngine/0.9 (research; paper-only; powershell-screen)"
$AsterInfo = "https://fapi.asterdex.com/fapi/v1/exchangeInfo"
$AsterKline = "https://fapi.asterdex.com/fapi/v1/klines"
$YahooChart = "https://query1.finance.yahoo.com/v8/finance/chart"

$CashAlias = @{
    PAYP     = "PYPL"
    BRKB     = "BRK-B"
    SAMSUNG  = "005930.KS"
    SKHYNIX  = "000660.KS"
    SKHY     = "000660.KS"
    TENCENT  = "0700.HK"
    XIAOMI   = "1810.HK"
    KUAISHOU = "1024.HK"
    MEITUAN  = "3690.HK"
    HYUNDAI  = "005380.KS"
    POPMART  = "9992.HK"
}

function Get-RepoRoot {
    if (Test-Path -LiteralPath (Join-Path $PWD "package.json")) { return $PWD.Path }
    $fromScript = Resolve-Path (Join-Path $PSScriptRoot "..")
    if (Test-Path -LiteralPath (Join-Path $fromScript "package.json")) { return $fromScript.Path }
    return $PWD.Path
}

function Get-CashTicker([string]$Base) {
    if ($CashAlias.ContainsKey($Base)) { return $CashAlias[$Base] }
    return $Base
}

function Invoke-JsonGet([string]$Url, [int]$TimeoutSec = 60) {
    return Invoke-RestMethod -Method Get -Uri $Url -UserAgent $UserAgent -TimeoutSec $TimeoutSec
}

function Get-AsterEquityPopulation {
    Write-Host "Fetching Aster exchangeInfo..."
    $info = Invoke-JsonGet $AsterInfo 90
    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($sym in $info.symbols) {
        $status = [string]$sym.status
        if ($status.ToUpperInvariant() -ne "TRADING") { continue }
        $subs = @()
        if ($sym.underlyingSubType) { $subs = @($sym.underlyingSubType | ForEach-Object { [string]$_ }) }
        $isStock = $subs | Where-Object { $_.ToUpperInvariant() -eq "STOCK" -or $_.ToUpperInvariant() -eq "ETF" }
        if (-not $isStock) { continue }
        $base = ([string]$sym.baseAsset).ToUpperInvariant()
        if (-not $base) { continue }
        $subTypes = @($subs | ForEach-Object { $_.ToUpperInvariant() } | Select-Object -Unique)
        $rows.Add([pscustomobject]@{
                base        = $base
                asterSymbol = [string]$sym.symbol
                cashTicker  = Get-CashTicker $base
                subTypes    = @($subTypes)
                status      = "TRADING"
            }) | Out-Null
    }
    $unique = @($rows | Group-Object base | ForEach-Object { $_.Group[0] } | Sort-Object base)
    Write-Host ("Aster equity population: {0} TRADING STOCK/ETF perps" -f $unique.Count)
    return $unique
}

function Test-Engine {
    param([string]$Url)
    try {
        $health = Invoke-RestMethod -Method Get -Uri "$Url/api/health" -TimeoutSec 5
        return [bool]$health.ok
    }
    catch {
        return $false
    }
}

function Get-YahooBars([string]$Ticker, [string]$Interval, [string]$Range) {
    $url = "{0}/{1}?interval={2}&range={3}&includePrePost=false" -f $YahooChart, [uri]::EscapeDataString($Ticker), $Interval, $Range
    $chart = Invoke-JsonGet $url 45
    $result = $chart.chart.result
    if (-not $result -or @($result).Count -lt 1) { throw "yahoo_empty:$Ticker" }
    $row = @($result)[0]
    $ts = @($row.timestamp)
    $q = $row.indicators.quote[0]
    $bars = New-Object System.Collections.Generic.List[object]
    for ($i = 0; $i -lt $ts.Count; $i++) {
        $o = $q.open[$i]; $h = $q.high[$i]; $l = $q.low[$i]; $c = $q.close[$i]
        if ($null -eq $o -or $null -eq $h -or $null -eq $l -or $null -eq $c) { continue }
        $vol = 0.0
        if ($q.volume -and $null -ne $q.volume[$i]) { $vol = [double]$q.volume[$i] }
        $openMs = [int64]([int64]$ts[$i] * 1000)
        $bars.Add([pscustomobject]@{
                openTime = $openMs
                open     = [double]$o
                high     = [double]$h
                low      = [double]$l
                close    = [double]$c
                volume   = $vol
            }) | Out-Null
    }
    return @($bars)
}

function Get-AsterBars([string]$AsterSymbol, [string]$Interval, [int]$Limit = 1500) {
    $url = "{0}?symbol={1}&interval={2}&limit={3}" -f $AsterKline, [uri]::EscapeDataString($AsterSymbol), $Interval, $Limit
    $raw = Invoke-JsonGet $url 45
    $bars = foreach ($row in $raw) {
        [pscustomobject]@{
            openTime = [int64]$row[0]
            open     = [double]$row[1]
            high     = [double]$row[2]
            low      = [double]$row[3]
            close    = [double]$row[4]
            volume   = [double]$row[5]
        }
    }
    return @($bars)
}

function ConvertTo-FourHour([object[]]$Hourly) {
    $buckets = @{}
    $interval = 4L * 60L * 60L * 1000L
    foreach ($bar in $Hourly) {
        $key = [int64]([math]::Floor($bar.openTime / $interval) * $interval)
        if (-not $buckets.ContainsKey($key)) { $buckets[$key] = New-Object System.Collections.Generic.List[object] }
        $buckets[$key].Add($bar) | Out-Null
    }
    $out = foreach ($key in ($buckets.Keys | Sort-Object)) {
        $rows = $buckets[$key]
        [pscustomobject]@{
            openTime = [int64]$key
            open     = [double]$rows[0].open
            high     = [double](($rows | Measure-Object -Property high -Maximum).Maximum)
            low      = [double](($rows | Measure-Object -Property low -Minimum).Minimum)
            close    = [double]$rows[$rows.Count - 1].close
            volume   = [double](($rows | Measure-Object -Property volume -Sum).Sum)
        }
    }
    return @($out)
}

function Get-EmaSeries([double[]]$Values, [int]$Period) {
    if ($Values.Count -lt $Period) { return @() }
    $k = 2.0 / ($Period + 1)
    $ema = 0.0
    for ($i = 0; $i -lt $Period; $i++) { $ema += $Values[$i] }
    $ema = $ema / $Period
    $out = New-Object System.Collections.Generic.List[double]
    $out.Add($ema) | Out-Null
    for ($i = $Period; $i -lt $Values.Count; $i++) {
        $ema = $Values[$i] * $k + $ema * (1 - $k)
        $out.Add($ema) | Out-Null
    }
    return @($out)
}

function Get-RsiWilder([double[]]$Values, [int]$Period) {
    if ($Values.Count -lt $Period + 1) { return $null }
    $gain = 0.0; $loss = 0.0
    for ($i = 1; $i -le $Period; $i++) {
        $chg = $Values[$i] - $Values[$i - 1]
        if ($chg -ge 0) { $gain += $chg } else { $loss -= $chg }
    }
    $avgGain = $gain / $Period
    $avgLoss = $loss / $Period
    for ($i = $Period + 1; $i -lt $Values.Count; $i++) {
        $chg = $Values[$i] - $Values[$i - 1]
        $up = 0.0; $dn = 0.0
        if ($chg -gt 0) { $up = $chg } else { $dn = -$chg }
        $avgGain = ($avgGain * ($Period - 1) + $up) / $Period
        $avgLoss = ($avgLoss * ($Period - 1) + $dn) / $Period
    }
    if ($avgLoss -eq 0) { return 100.0 }
    $rs = $avgGain / $avgLoss
    return 100.0 - (100.0 / (1.0 + $rs))
}

function Get-TrueRange([double]$High, [double]$Low, [double]$PrevClose) {
    $a = $High - $Low
    $b = [math]::Abs($High - $PrevClose)
    $c = [math]::Abs($Low - $PrevClose)
    return [math]::Max($a, [math]::Max($b, $c))
}

function Get-Atr([object[]]$Bars, [int]$Period) {
    if ($Bars.Count -lt $Period + 1) { return $null }
    $trs = New-Object System.Collections.Generic.List[double]
    for ($i = 1; $i -lt $Bars.Count; $i++) {
        $trs.Add((Get-TrueRange $Bars[$i].high $Bars[$i].low $Bars[$i - 1].close)) | Out-Null
    }
    $value = 0.0
    for ($i = 0; $i -lt $Period; $i++) { $value += $trs[$i] }
    $value = $value / $Period
    for ($i = $Period; $i -lt $trs.Count; $i++) {
        $value = ($value * ($Period - 1) + $trs[$i]) / $Period
    }
    return $value
}

function Get-AdxWilder([object[]]$Bars, [int]$Period) {
    if ($Bars.Count -lt $Period * 2 + 1) { return $null }
    $plusDm = New-Object System.Collections.Generic.List[double]
    $minusDm = New-Object System.Collections.Generic.List[double]
    $tr = New-Object System.Collections.Generic.List[double]
    for ($i = 1; $i -lt $Bars.Count; $i++) {
        $up = $Bars[$i].high - $Bars[$i - 1].high
        $down = $Bars[$i - 1].low - $Bars[$i].low
        $p = 0.0; $m = 0.0
        if ($up -gt $down -and $up -gt 0) { $p = $up }
        if ($down -gt $up -and $down -gt 0) { $m = $down }
        $plusDm.Add($p) | Out-Null
        $minusDm.Add($m) | Out-Null
        $tr.Add((Get-TrueRange $Bars[$i].high $Bars[$i].low $Bars[$i - 1].close)) | Out-Null
    }
    $smoothTr = 0.0; $smoothPlus = 0.0; $smoothMinus = 0.0
    for ($i = 0; $i -lt $Period; $i++) {
        $smoothTr += $tr[$i]; $smoothPlus += $plusDm[$i]; $smoothMinus += $minusDm[$i]
    }
    $dx = New-Object System.Collections.Generic.List[double]
    $plusDi = 0.0; $minusDi = 0.0
    if ($smoothTr -ne 0) {
        $plusDi = 100.0 * $smoothPlus / $smoothTr
        $minusDi = 100.0 * $smoothMinus / $smoothTr
    }
    $denom = $plusDi + $minusDi
    if ($denom -eq 0) { $dx.Add(0.0) | Out-Null } else { $dx.Add((100.0 * [math]::Abs($plusDi - $minusDi)) / $denom) | Out-Null }
    for ($i = $Period; $i -lt $tr.Count; $i++) {
        $smoothTr = $smoothTr - $smoothTr / $Period + $tr[$i]
        $smoothPlus = $smoothPlus - $smoothPlus / $Period + $plusDm[$i]
        $smoothMinus = $smoothMinus - $smoothMinus / $Period + $minusDm[$i]
        $plusDi = 0.0; $minusDi = 0.0
        if ($smoothTr -ne 0) {
            $plusDi = 100.0 * $smoothPlus / $smoothTr
            $minusDi = 100.0 * $smoothMinus / $smoothTr
        }
        $denom = $plusDi + $minusDi
        if ($denom -eq 0) { $dx.Add(0.0) | Out-Null } else { $dx.Add((100.0 * [math]::Abs($plusDi - $minusDi)) / $denom) | Out-Null }
    }
    if ($dx.Count -lt $Period) { return $null }
    $adx = 0.0
    for ($i = 0; $i -lt $Period; $i++) { $adx += $dx[$i] }
    $adx = $adx / $Period
    for ($i = $Period; $i -lt $dx.Count; $i++) {
        $adx = ($adx * ($Period - 1) + $dx[$i]) / $Period
    }
    return $adx
}

function Get-MacdHist([double[]]$Closes) {
    $fast = 12; $slow = 26; $signalPeriod = 9
    if ($Closes.Count -lt $slow + $signalPeriod) { return $null }
    $fastArr = @(Get-EmaSeries $Closes $fast)
    $slowArr = @(Get-EmaSeries $Closes $slow)
    $offset = $fastArr.Count - $slowArr.Count
    if ($offset -lt 0) { return $null }
    $macdLine = for ($i = 0; $i -lt $slowArr.Count; $i++) { $fastArr[$i + $offset] - $slowArr[$i] }
    $signalArr = @(Get-EmaSeries @($macdLine) $signalPeriod)
    if ($signalArr.Count -lt 1) { return $null }
    return $macdLine[$macdLine.Count - 1] - $signalArr[$signalArr.Count - 1]
}

function Get-DailyContext([object[]]$Daily) {
    $closes = @($Daily | ForEach-Object { [double]$_.close })
    $ema = @(Get-EmaSeries $closes 150)
    if ($ema.Count -lt 1 -or $Daily.Count -lt 1) {
        return @{ dir = 0; slopePct = $null }
    }
    $last = $Daily[$Daily.Count - 1]
    $cur = $ema[$ema.Count - 1]
    $dir = -1
    if ($last.close -gt $cur) { $dir = 1 }
    $slope = $null
    $prevIdx = $ema.Count - 1 - 10
    if ($prevIdx -ge 0 -and $ema[$prevIdx] -gt 0) {
        $slope = (($cur - $ema[$prevIdx]) / $ema[$prevIdx]) * 100.0
    }
    return @{ dir = $dir; slopePct = $slope }
}

function Get-AteSetup([object[]]$Daily, [object[]]$FourHour) {
    $emptyGates = @{
        dailyDir = 0; adxOk = $false; rsiOk = $false; macdOk = $false
        slopeOk = $false; atrOk = $false; donchianReady = $false; breakout = $false
    }
    if (-not $FourHour -or $FourHour.Count -lt 35) {
        return @{
            bias = "FLAT"; action = "FLAT"; reasons = @("Not enough 4h bars")
            gates = $emptyGates
            indicators = @{
                dailyDir = 0; dailyEmaSlopePct = $null; entryHigh = $null; entryLow = $null
                atr = $null; adx = $null; rsi = $null; macdHist = $null; close = $null; barOpenTime = $null
            }
        }
    }
    $i = $FourHour.Count - 1
    $candle = $FourHour[$i]
    $priorEntry = @($FourHour[($i - 34)..($i - 1)])
    $entryHigh = [double](($priorEntry | Measure-Object -Property high -Maximum).Maximum)
    $entryLow = [double](($priorEntry | Measure-Object -Property low -Minimum).Minimum)
    $atrBars = @($FourHour[[math]::Max(0, $i - 15)..($i - 1)])
    $adxBars = @($FourHour[[math]::Max(0, $i - 56)..($i - 1)])
    $rsiBars = @($FourHour[[math]::Max(0, $i - 57)..($i - 1)])
    $macdBars = @($FourHour[[math]::Max(0, $i - 60)..($i - 1)])
    $atr = Get-Atr $atrBars 14
    $adx = Get-AdxWilder $adxBars 14
    $rsi = Get-RsiWilder @($rsiBars | ForEach-Object { [double]$_.close }) 14
    $macd = Get-MacdHist @($macdBars | ForEach-Object { [double]$_.close })
    $daily = Get-DailyContext $Daily
    $adxOk = ($null -ne $adx -and $adx -ge 0)
    $atrOk = ($null -ne $atr -and $atr -gt 0)
    $rsiLong = ($null -ne $rsi -and $rsi -ge 50)
    $rsiShort = ($null -ne $rsi -and $rsi -le 50)
    $breakoutLong = $candle.high -ge $entryHigh
    $breakoutShort = $candle.low -le $entryLow
    $enterLong = $adxOk -and $atrOk -and ($daily.dir -gt 0) -and $rsiLong -and $breakoutLong
    $enterShort = $adxOk -and $atrOk -and ($daily.dir -lt 0) -and $rsiShort -and $breakoutShort
    $epoch = [DateTime]::SpecifyKind([DateTime]::Parse("1970-01-01"), [DateTimeKind]::Utc)
    $barTime = $epoch.AddMilliseconds([double]$candle.openTime).ToString("o")
    $indicators = @{
        dailyDir         = [int]$daily.dir
        dailyEmaSlopePct = $daily.slopePct
        entryHigh        = $entryHigh
        entryLow         = $entryLow
        atr              = $atr
        adx              = $adx
        rsi              = $rsi
        macdHist         = $macd
        close            = [double]$candle.close
        barOpenTime      = $barTime
    }
    if ($enterLong) {
        return @{
            bias = "LONG"; action = "ENTER_LONG"
            reasons = @("Daily close above EMA", "Donchian entry high broken", "Momentum gates pass")
            gates = @{ dailyDir = 1; adxOk = $true; rsiOk = $true; macdOk = $true; slopeOk = $true; atrOk = $true; donchianReady = $true; breakout = $true }
            indicators = $indicators
        }
    }
    if ($enterShort) {
        return @{
            bias = "SHORT"; action = "ENTER_SHORT"
            reasons = @("Daily close below EMA", "Donchian entry low broken", "Momentum gates pass")
            gates = @{ dailyDir = -1; adxOk = $true; rsiOk = $true; macdOk = $true; slopeOk = $true; atrOk = $true; donchianReady = $true; breakout = $true }
            indicators = $indicators
        }
    }
    if ($daily.dir -gt 0 -and $adxOk -and $rsiLong) {
        return @{
            bias = "LONG"; action = "WAIT"
            reasons = @("Regime is long-only; waiting for a Donchian breakout")
            gates = @{ dailyDir = 1; adxOk = $true; rsiOk = $true; macdOk = $true; slopeOk = $true; atrOk = $atrOk; donchianReady = $true; breakout = $false }
            indicators = $indicators
        }
    }
    if ($daily.dir -lt 0 -and $adxOk -and $rsiShort) {
        return @{
            bias = "SHORT"; action = "WAIT"
            reasons = @("Regime is short-only; waiting for a Donchian breakdown")
            gates = @{ dailyDir = -1; adxOk = $true; rsiOk = $true; macdOk = $true; slopeOk = $true; atrOk = $atrOk; donchianReady = $true; breakout = $false }
            indicators = $indicators
        }
    }
    $reasons = New-Object System.Collections.Generic.List[string]
    if ([int]$daily.dir -eq 0) { $reasons.Add("Daily EMA regime unavailable") | Out-Null }
    if (-not $adxOk) { $reasons.Add("ADX below threshold") | Out-Null }
    if ($daily.dir -gt 0 -and -not $rsiLong) { $reasons.Add("RSI below long gate") | Out-Null }
    if ($daily.dir -lt 0 -and -not $rsiShort) { $reasons.Add("RSI above short gate") | Out-Null }
    if ($reasons.Count -lt 1) { $reasons.Add("Gates conflict; stay flat") | Out-Null }
    return @{
        bias = "FLAT"; action = "FLAT"; reasons = @($reasons)
        gates = @{
            dailyDir = [int]$daily.dir; adxOk = $adxOk; rsiOk = $(if ($daily.dir -lt 0) { $rsiShort } else { $rsiLong })
            macdOk = $true; slopeOk = $true; atrOk = $atrOk; donchianReady = $true; breakout = $false
        }
        indicators = $indicators
    }
}

function Get-StandaloneScreen([object]$Row) {
    $source = "yahoo_public"
    $warning = "US/cash session bars resampled to 4h. Aster is the execution venue only."
    $daily = @(); $four = @()
    try {
        $daily = @(Get-YahooBars $Row.cashTicker "1d" "2y")
        $hourly = @(Get-YahooBars $Row.cashTicker "1h" "1y")
        $four = @(ConvertTo-FourHour $hourly)
    }
    catch {
        $source = "aster_public"
        $warning = "Yahoo cash feed missed; using Aster stock-perp candles."
        $daily = @(Get-AsterBars $Row.asterSymbol "1d" 1000)
        $four = @(Get-AsterBars $Row.asterSymbol "4h" 1500)
    }
    $ate = Get-AteSetup $daily $four
    $mark = $null
    if ($four.Count -gt 0) { $mark = [double]$four[$four.Count - 1].close }
    elseif ($daily.Count -gt 0) { $mark = [double]$daily[$daily.Count - 1].close }
    return [ordered]@{
        base        = $Row.base
        asterSymbol = $Row.asterSymbol
        cashTicker  = $Row.cashTicker
        source      = $source
        mark        = $mark
        warning     = $warning
        setup       = @{
            bias    = $ate.bias
            action  = $ate.action
            reasons = @($ate.reasons)
            gates   = $ate.gates
        }
        indicators  = $ate.indicators
        error       = $null
    }
}

function Get-ScreenSummary([object[]]$Screens, [int]$Population) {
    $s = [ordered]@{
        population = $Population
        screened   = @($Screens).Count
        failed     = 0
        LONG       = 0
        SHORT      = 0
        FLAT       = 0
        GRID       = 0
        ENTER_LONG = 0
        ENTER_SHORT = 0
        WAIT       = 0
    }
    foreach ($row in $Screens) {
        if ($row.error) { $s.failed++ }
        $bias = [string]$row.setup.bias
        $action = [string]$row.setup.action
        if ($s.Contains($bias)) { $s[$bias] = [int]$s[$bias] + 1 }
        if ($s.Contains($action)) { $s[$action] = [int]$s[$action] + 1 }
    }
    return $s
}

# --- main ---
$root = Get-RepoRoot
if (-not $OutFile) {
    $dir = Join-Path $root "data\us-equity"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $OutFile = Join-Path $dir "aster-equity-screen.json"
}

$population = @(Get-AsterEquityPopulation)
if ($Limit -gt 0) {
    Write-Host ("Limiting screen to first {0} of {1}" -f $Limit, $population.Count)
}

$report = $null
$engineUp = $false
if (-not $Standalone -and -not $PopulationOnly) {
    $engineUp = Test-Engine -Url $EngineUrl
}

if ($engineUp) {
    $url = "$EngineUrl/api/screen"
    if ($Limit -gt 0) { $url = "$url`?limit=$Limit" }
    Write-Host "Engine is up. GET $url (this walks every equity; can take a few minutes)..."
    $report = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 300
}
elseif (-not $PopulationOnly) {
    Write-Host "Local engine not reachable. Screening Yahoo/Aster from PowerShell..."
    $slice = $population
    if ($Limit -gt 0) { $slice = @($population | Select-Object -First $Limit) }
    $screens = New-Object System.Collections.Generic.List[object]
    $errors = New-Object System.Collections.Generic.List[object]
    $n = 0
    foreach ($row in $slice) {
        $n++
        Write-Progress -Activity "Screening Aster equity perps" -Status $row.base -PercentComplete (100.0 * $n / $slice.Count)
        try {
            $screens.Add((Get-StandaloneScreen $row)) | Out-Null
        }
        catch {
            $msg = [string]$_.Exception.Message
            $errors.Add([ordered]@{ base = $row.base; error = $msg }) | Out-Null
            $screens.Add([ordered]@{
                    base        = $row.base
                    asterSymbol = $row.asterSymbol
                    cashTicker  = $row.cashTicker
                    source      = "unavailable"
                    mark        = $null
                    warning     = $null
                    setup       = @{ bias = "FLAT"; action = "FLAT"; reasons = @("Screen failed"); gates = @{} }
                    indicators  = @{}
                    error       = $msg
                }) | Out-Null
        }
        if ($YahooDelayMs -gt 0) { Start-Sleep -Milliseconds $YahooDelayMs }
    }
    Write-Progress -Activity "Screening Aster equity perps" -Completed
    $report = [ordered]@{
        generatedAt = [DateTime]::UtcNow.ToString("o")
        venue       = "aster_usdt_perps"
        playbook    = "aster_preps_v1"
        venueRule   = "If the instrument is a stock or ETF, read the US (or listed cash) print. Always trade the matching Aster perp after the signal, never the cash share."
        population  = @($population)
        screens     = @($screens)
        summary     = Get-ScreenSummary @($screens) $population.Count
        errors      = @($errors)
        source      = "powershell_standalone"
    }
}
else {
    $report = [ordered]@{
        generatedAt = [DateTime]::UtcNow.ToString("o")
        venue       = "aster_usdt_perps"
        playbook    = "aster_preps_v1"
        population  = @($population)
        screens     = @()
        summary     = @{ population = $population.Count; screened = 0; failed = 0 }
        errors      = @()
        source      = "population_only"
    }
}

$json = $report | ConvertTo-Json -Depth 10
# Windows PowerShell 5.1 can emit a truncated-looking tree if Depth is too low; 10 covers this shape.
[System.IO.File]::WriteAllText($OutFile, $json)
Write-Host ""
Write-Host "Wrote $OutFile"
if ($report.summary) {
    $sum = $report.summary
    Write-Host ("population={0} screened={1} failed={2} LONG={3} SHORT={4} FLAT={5} ENTER_LONG={6} ENTER_SHORT={7} WAIT={8}" -f `
            $sum.population, $sum.screened, $sum.failed, $sum.LONG, $sum.SHORT, $sum.FLAT, $sum.ENTER_LONG, $sum.ENTER_SHORT, $sum.WAIT)
}
Write-Host "Paper only. Feed this JSON to Grok with GET /api/playbook as the system prompt."
