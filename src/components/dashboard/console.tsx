"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Snapshot } from "@/lib/engine/runtime";
import type { BacktestReport } from "@/lib/engine/backtest";
import type { Regime } from "@/lib/engine/types";
import { pct, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

const REGIMES: Regime[] = ["LONG", "SHORT", "FLAT"];

interface LabParams {
  years: number;
  capitalUsd: number;
  riskPct: number; // percent
  maxLeverage: number;
  donchianEntry: number;
  donchianExit: number;
  atrPeriod: number;
  atrStopMult: number;
  adxPeriod: number;
  adxThreshold: number;
  dailyEma: number;
  rsiPeriod: number;
  rsiLongMin: number;
  rsiShortMax: number;
}

const DEFAULT_LAB: LabParams = {
  years: 2,
  capitalUsd: 1000,
  riskPct: 3,
  maxLeverage: 20,
  donchianEntry: 34,
  donchianExit: 5,
  atrPeriod: 14,
  atrStopMult: 3,
  adxPeriod: 14,
  adxThreshold: 0,
  dailyEma: 150,
  rsiPeriod: 14,
  rsiLongMin: 50,
  rsiShortMax: 50,
};

interface ConnectionsResponse {
  marketData: { ok: boolean; source?: string; mark?: number; error?: string };
  telegram: { enabled: boolean; configured: boolean; chatCount: number; botOk: boolean; botUsername?: string; error?: string };
  exchange: { name: string; apiUrlSet: boolean; apiKeyPresent: boolean; signerPresent: boolean; tradingConnection: string };
}

interface DryRunResponse {
  generatedAt: string;
  liveTradingEnabled: boolean;
  liveExecutionAvailable: boolean;
  exchange: string;
  accountLabel: string;
  credentialsPresent: boolean;
  config: {
    capitalUsd: number;
    maxLeverage: number;
    riskPct: number;
    maxNotionalUsd: number;
    dailyLossLimitUsd: number;
    maxDrawdownPct: number;
  };
  market: { mark: number; source: string };
  plan: {
    action: string;
    side: string;
    sizeBtc: number;
    notionalUsd: number;
    entryPrice: number;
    stopPrice: number | null;
    effectiveLeverage: number;
    notionalCapped: boolean;
    dryRun: boolean;
    liveSubmitted: boolean;
    note: string;
  };
  note: string;
}

const LAB_FIELDS: Array<{ key: keyof LabParams; label: string; step?: number; hint: string }> = [
  { key: "years", label: "Years", hint: "1-3 (4h feed caps ~2.3y)" },
  { key: "capitalUsd", label: "Initial USD", step: 100, hint: "starting capital" },
  { key: "riskPct", label: "Risk % / trade", step: 0.5, hint: "ATR volatility sizing" },
  { key: "maxLeverage", label: "Max leverage", hint: "hard cap" },
  { key: "donchianEntry", label: "Donchian entry", hint: "breakout lookback (bars)" },
  { key: "donchianExit", label: "Donchian exit", hint: "trailing exit (bars)" },
  { key: "atrPeriod", label: "ATR period", hint: "volatility lookback" },
  { key: "atrStopMult", label: "ATR stop x", step: 0.5, hint: "initial stop distance" },
  { key: "adxPeriod", label: "ADX period", hint: "trend-strength lookback" },
  { key: "adxThreshold", label: "ADX min", hint: "0 disables the gate" },
  { key: "dailyEma", label: "Daily EMA", hint: "trend filter period" },
  { key: "rsiPeriod", label: "RSI period", hint: "momentum indicator" },
  { key: "rsiLongMin", label: "RSI long ≥", hint: "0 disables (e.g. 50)" },
  { key: "rsiShortMax", label: "RSI short ≤", hint: "100 disables (e.g. 50)" },
];

function pnlClass(value: number): string {
  if (value > 0.0001) return "text-emerald-400";
  if (value < -0.0001) return "text-rose-400";
  return "text-zinc-300";
}

function sideTone(side: string): "good" | "warn" | "bad" | "neutral" {
  if (side === "LONG") return "good";
  if (side === "SHORT") return "warn";
  return "neutral";
}

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "good" | "warn" | "bad" | "neutral" | "live";
}) {
  const tones = {
    good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    bad: "border-rose-500/40 bg-rose-500/10 text-rose-300",
    live: "border-rose-400 bg-rose-500 text-white",
    neutral: "border-zinc-600 bg-zinc-800 text-zinc-300",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

function signed(value: number, digits = 2): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function ReadinessConsole() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [killing, setKilling] = useState(false);
  const [backtest, setBacktest] = useState<BacktestReport | null>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtesting, setBacktesting] = useState(false);
  const [lab, setLab] = useState<LabParams>(DEFAULT_LAB);
  const [dryRun, setDryRun] = useState<DryRunResponse | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [dryRunning, setDryRunning] = useState(false);
  const [connections, setConnections] = useState<ConnectionsResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/snapshot", { cache: "no-store" });
      const data = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) throw new Error(data.error || "snapshot_failed");
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "snapshot_failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/snapshot", { cache: "no-store" });
        const data = (await response.json()) as Snapshot & { error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || "snapshot_failed");
        setSnapshot(data);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "snapshot_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function checkConnections() {
    setChecking(true);
    try {
      const response = await fetch("/api/connections", { cache: "no-store" });
      const data = (await response.json()) as ConnectionsResponse;
      setConnections(data);
    } catch {
      setConnections(null);
    } finally {
      setChecking(false);
    }
  }

  async function sendTelegramTest() {
    setSending(true);
    setSendResult(null);
    try {
      const response = await fetch("/api/dry-run", { method: "POST" });
      const data = (await response.json()) as {
        error?: string;
        telegram?: { attempted: boolean; sent: number; results: Array<{ ok: boolean; error?: string }> };
      };
      if (!response.ok) throw new Error(data.error || "send_failed");
      const tg = data.telegram;
      if (!tg || !tg.attempted) {
        setSendResult("Telegram is not enabled/configured (set TELEGRAM_ENABLED=true, token, chat ids).");
      } else {
        const failed = tg.results.filter((r) => !r.ok).map((r) => r.error).join(", ");
        setSendResult(`Sent to ${tg.sent}/${tg.results.length} chat(s).${failed ? ` Errors: ${failed}` : ""}`);
      }
    } catch (err) {
      setSendResult(err instanceof Error ? err.message : "send_failed");
    } finally {
      setSending(false);
    }
  }

  async function runDryRun() {
    setDryRunning(true);
    setDryRunError(null);
    try {
      const response = await fetch("/api/dry-run", { cache: "no-store" });
      const data = (await response.json()) as DryRunResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "dry_run_failed");
      setDryRun(data);
    } catch (err) {
      setDryRunError(err instanceof Error ? err.message : "dry_run_failed");
    } finally {
      setDryRunning(false);
    }
  }

  async function paperKill() {
    setKilling(true);
    try {
      await fetch("/api/kill", { method: "POST" });
      await load();
    } finally {
      setKilling(false);
    }
  }

  async function runBacktest(p: LabParams) {
    setBacktesting(true);
    setBacktestError(null);
    try {
      const q = new URLSearchParams({
        years: String(p.years),
        capital: String(p.capitalUsd),
        risk: String(p.riskPct / 100),
        lev: String(p.maxLeverage),
        entry: String(p.donchianEntry),
        exit: String(p.donchianExit),
        atrPeriod: String(p.atrPeriod),
        atrMult: String(p.atrStopMult),
        adxPeriod: String(p.adxPeriod),
        adx: String(p.adxThreshold),
        dailyEma: String(p.dailyEma),
        rsiPeriod: String(p.rsiPeriod),
        rsiLongMin: String(p.rsiLongMin),
        rsiShortMax: String(p.rsiShortMax),
      });
      const response = await fetch(`/api/backtest?${q}`, { cache: "no-store" });
      const data = (await response.json()) as BacktestReport & { error?: string };
      if (!response.ok) throw new Error(data.error || "backtest_failed");
      setBacktest(data);
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : "backtest_failed");
    } finally {
      setBacktesting(false);
    }
  }

  if (loading && !snapshot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0d10] px-6">
        <div className="max-w-md text-center">
          <p className="text-xs uppercase tracking-[0.28em] text-amber-200/80">Phase 7.10</p>
          <h1 className="mt-3 text-2xl font-semibold text-zinc-100">Loading trend strategy</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Fetching closed Hyperliquid candles and running the Donchian trend engine.
            No exchange credentials are used.
          </p>
        </div>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0d10] px-6">
        <Alert variant="destructive" className="max-w-lg border-rose-500/40 bg-rose-950/40">
          <AlertTitle>Console failed closed</AlertTitle>
          <AlertDescription>{error}. The engine will not invent candles or place orders.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!snapshot) return null;

  const { regime, position, strategy, market, leverage, recent } = snapshot;

  return (
    <div className="min-h-screen bg-[#0b0d10] text-zinc-100">
      <header className="border-b border-white/10 bg-[#0e1116]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.32em] text-amber-200/80">
              Smart Grid · Phase 7.10
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Turtle trend follower
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              One Phoenix book, {usd(strategy.capitalUsd, 0)}. Donchian breakout entries filtered by the
              daily trend, an ATR trailing stop, and volatility sizing that risks{" "}
              {(strategy.riskPct * 100).toFixed(1)}% per trade (up to {strategy.maxLeverage}x). Paper only:
              this console cannot submit, cancel, or resize an order.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={sideTone(position.side)}>Position: {position.side}</StatusPill>
            <StatusPill tone="bad">live_actions_enabled = false</StatusPill>
            {snapshot.paperKill ? <StatusPill tone="live">Paper kill engaged</StatusPill> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {market.warning ? (
          <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-100">
            <AlertTitle>Market feed note</AlertTitle>
            <AlertDescription className="text-amber-100/80">{market.warning}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Last refresh failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="BTC mark" value={market.mark ? usd(market.mark, 0) : "-"} hint={market.lastClosed ?? "no closed bar"} />
          <Metric
            label="Position"
            value={position.side === "FLAT" ? "Flat" : `${position.side} ${Math.abs(position.sizeBtc).toFixed(4)} BTC`}
            hint={position.side === "FLAT" ? "no exposure" : `${usd(position.notionalUsd, 0)} notional · ${position.leverage.toFixed(1)}x`}
            valueClass={position.side === "SHORT" ? "text-amber-300" : position.side === "LONG" ? "text-emerald-400" : undefined}
          />
          <Metric
            label="Trailing stop"
            value={position.stopPrice ? usd(position.stopPrice, 0) : "-"}
            hint={position.entry ? `entry ${usd(position.entry, 0)}` : "flat"}
            valueClass="text-rose-300"
          />
          <Metric
            label={`Recent (${recent.windowDays.toFixed(0)}d) return`}
            value={`${signed(recent.totalReturnPct)}%`}
            hint={`${recent.trades} trades · ${recent.winRatePct === null ? "n/a" : `${recent.winRatePct.toFixed(0)}% win`} · ${recent.maxDrawdownPct.toFixed(0)}% maxDD`}
            valueClass={pnlClass(recent.totalReturnPct)}
          />
        </section>

        <Card className="border-white/10 bg-[#14181f]">
          <CardHeader>
            <CardTitle>Trend signal</CardTitle>
            <CardDescription>
              The daily EMA gates direction; a 4h close beyond the {""}
              {strategy.venue} Donchian entry channel opens a trade, sized so the ATR stop risks a
              fixed slice of equity. Winners run until the shorter Donchian channel is broken.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ThesisChip label="Position" value={position.side} tone={sideTone(position.side)} />
              <ThesisChip
                label="Daily filter"
                value={regime.dailyDir === 1 ? "Above (long)" : regime.dailyDir === -1 ? "Below (short)" : "Neutral"}
                tone={regime.dailyDir === 1 ? "good" : regime.dailyDir === -1 ? "warn" : "neutral"}
              />
              <ThesisChip
                label="Effective leverage"
                value={position.side === "FLAT" ? "0x" : `${position.leverage.toFixed(1)}x`}
                tone="neutral"
              />
              <ThesisChip
                label="Liquidation"
                value={position.liquidationPrice ? usd(position.liquidationPrice, 0) : "-"}
                tone="bad"
              />
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    <TableHead>Signal</TableHead>
                    <TableHead>Reading</TableHead>
                    <TableHead>Effect</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {regime.readings.map((item) => (
                    <TableRow key={item.id} className="border-white/10">
                      <TableCell className="min-w-40">
                        <div className="font-medium text-zinc-100">{item.name}</div>
                        <div className="text-xs text-zinc-500">{item.timeframe}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.formatted}</TableCell>
                      <TableCell className="max-w-md text-xs text-zinc-400">{item.effect}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="backtest" className="space-y-4">
          <TabsList className="bg-[#14181f]">
            <TabsTrigger value="backtest">Backtest lab</TabsTrigger>
            <TabsTrigger value="dryrun">Dry run</TabsTrigger>
            <TabsTrigger value="leverage">Leverage &amp; ROE</TabsTrigger>
            <TabsTrigger value="boundary">Production boundary</TabsTrigger>
          </TabsList>

          <TabsContent value="backtest">
            <Card className="border-white/10 bg-[#14181f]">
              <CardHeader>
                <CardTitle>Backtest lab</CardTitle>
                <CardDescription>
                  Tune any factor and re-run over up to ~3 years of closed 4h candles. ADX and RSI
                  are optional confirmation indicators (set ADX min &gt; 0, or RSI long/short bounds
                  inside 0-100, to enable). Donchian breakout + ATR volatility sizing; winners run to
                  the trailing exit, losers capped near the risk budget.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {LAB_FIELDS.map((field) => (
                    <NumberField
                      key={field.key}
                      label={field.label}
                      hint={field.hint}
                      step={field.step}
                      value={lab[field.key]}
                      onChange={(value) => setLab((prev) => ({ ...prev, [field.key]: value }))}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void runBacktest(lab)} disabled={backtesting}>
                    {backtesting ? "Walking candles..." : "Run backtest"}
                  </Button>
                  <Button variant="destructive" onClick={() => setLab(DEFAULT_LAB)} disabled={backtesting}>
                    Reset defaults
                  </Button>
                </div>
                {backtestError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Backtest failed</AlertTitle>
                    <AlertDescription>{backtestError}</AlertDescription>
                  </Alert>
                ) : null}
                {backtest ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Metric label="CAGR (annualized)" value={`${signed(backtest.cagrPct)}%`} hint={`${usd(backtest.startEquityUsd, 0)} to ${usd(backtest.finalEquityUsd, 0)} · ${signed(backtest.totalReturnPct)}% total`} valueClass={pnlClass(backtest.cagrPct)} />
                      <Metric label="Sharpe" value={backtest.sharpe === null ? "-" : backtest.sharpe.toFixed(2)} hint={`${backtest.annualVolPct.toFixed(0)}% annual vol`} valueClass={pnlClass(backtest.sharpe ?? 0)} />
                      <Metric label="Max drawdown" value={`-${backtest.maxDrawdownPct.toFixed(1)}%`} hint="peak-to-trough on equity" valueClass="text-rose-300" />
                      <Metric label="Trades" value={`${String(backtest.trades)} (${backtest.monthsCount ? (backtest.trades / backtest.monthsCount).toFixed(1) : "0"}/mo)`} hint={`${backtest.winRatePct === null ? "n/a" : `${backtest.winRatePct.toFixed(0)}% win`} · fees ${usd(backtest.feesUsd)}`} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Metric label="Sortino" value={backtest.sortino === null ? "-" : backtest.sortino.toFixed(2)} hint="downside-risk adjusted" valueClass={pnlClass(backtest.sortino ?? 0)} />
                      <Metric
                        label="Significance (null H0)"
                        value={backtest.tStat === null ? "-" : `t=${backtest.tStat.toFixed(1)}`}
                        hint={backtest.pValue === null ? "n/a" : `p=${backtest.pValue.toFixed(3)} ${backtest.pValue < 0.05 ? "(significant)" : "(not significant)"}`}
                        valueClass={backtest.pValue !== null && backtest.pValue < 0.05 ? "text-emerald-400" : "text-zinc-300"}
                      />
                      <Metric label="Alpha vs buy&hold" value={`${signed(backtest.alphaVsHoldPct, 1)}%`} hint={`hold BTC: ${signed(backtest.buyHoldReturnPct, 1)}%`} valueClass={pnlClass(backtest.alphaVsHoldPct)} />
                      <Metric label="Months ≥ 20%" value={`${backtest.monthsAbove20} / ${backtest.monthsCount}`} hint={`best ${signed(backtest.bestMonthPct, 0)}% · worst ${signed(backtest.worstMonthPct, 0)}%`} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill tone={backtest.everLiquidated ? "bad" : "good"}>
                        {backtest.everLiquidated ? `${backtest.liquidations} liquidation(s)` : "no liquidation"}
                      </StatusPill>
                      <StatusPill tone="neutral">{backtest.everShort ? "used shorts" : "long only"}</StatusPill>
                      <StatusPill tone={backtest.finalEquityUsd >= backtest.startEquityUsd ? "good" : "bad"}>
                        {backtest.blownUp ? "account blew up" : backtest.finalEquityUsd >= backtest.startEquityUsd ? "profitable" : "net loss"}
                      </StatusPill>
                      <StatusPill tone="neutral">{backtest.marketSource.replaceAll("_", " ")}</StatusPill>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-white/10">
                            <TableHead>Regime</TableHead>
                            <TableHead className="text-right">Net P&amp;L</TableHead>
                            <TableHead className="text-right">Bars</TableHead>
                            <TableHead className="text-right">Time share</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {REGIMES.map((r) => (
                            <TableRow key={r} className="border-white/10">
                              <TableCell>{r}</TableCell>
                              <TableCell className={cn("text-right font-mono text-xs", pnlClass(backtest.perRegimePnlUsd[r]))}>
                                {usd(backtest.perRegimePnlUsd[r])}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">{backtest.barsInRegime[r]}</TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                {backtest.bars ? `${((backtest.barsInRegime[r] / backtest.bars) * 100).toFixed(0)}%` : "-"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Equity curve ({usd(backtest.startEquityUsd, 0)} start)
                      </p>
                      <EquityChart points={backtest.equityCurve} start={backtest.startEquityUsd} />
                    </div>
                    <div className="overflow-x-auto">
                      <p className="mb-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Monthly breakdown
                      </p>
                      <Table>
                        <TableHeader>
                          <TableRow className="border-white/10">
                            <TableHead>Month</TableHead>
                            <TableHead className="text-right">Return</TableHead>
                            <TableHead className="text-right">Trades</TableHead>
                            <TableHead className="text-right">End equity</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {backtest.monthly.map((m) => (
                            <TableRow key={m.month} className="border-white/10">
                              <TableCell className="font-mono text-xs">{m.month}</TableCell>
                              <TableCell className={cn("text-right font-mono text-xs", pnlClass(m.returnPct))}>
                                {signed(m.returnPct, 1)}%
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">{m.trades}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{usd(m.endEquityUsd, 0)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {backtest.epochStart} to {backtest.epochEnd}. {backtest.note}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-zinc-400">
                    No backtest yet. Run it to see total return, drawdown, trade stats, the equity
                    curve, and the monthly breakdown.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dryrun">
            <Card className="border-white/10 bg-[#14181f]">
              <CardHeader>
                <CardTitle>Dry run: intended order from the live signal</CardTitle>
                <CardDescription>
                  Reads your <code>.env</code> config and shows the exact order the strategy would
                  place right now, sized and clamped by your risk limits. Nothing is submitted: there
                  is no exchange write adapter. Restart the dev server after editing <code>.env</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Connections</p>
                    <div className="flex gap-2">
                      <Button onClick={() => void checkConnections()} disabled={checking}>
                        {checking ? "Checking..." : "Check connections"}
                      </Button>
                      <Button onClick={() => void sendTelegramTest()} disabled={sending}>
                        {sending ? "Sending..." : "Send test alert to Telegram"}
                      </Button>
                    </div>
                  </div>
                  {connections ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="flex items-center gap-2">
                        <StatusPill tone={connections.marketData.ok ? "good" : "bad"}>Market data</StatusPill>
                        <span className="text-xs text-zinc-400">
                          {connections.marketData.ok
                            ? `${connections.marketData.source} · ${connections.marketData.mark ? usd(connections.marketData.mark, 0) : "-"}`
                            : connections.marketData.error}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill tone={connections.telegram.botOk ? "good" : connections.telegram.configured ? "bad" : "neutral"}>Telegram</StatusPill>
                        <span className="text-xs text-zinc-400">
                          {connections.telegram.botOk
                            ? `@${connections.telegram.botUsername} · ${connections.telegram.chatCount} chat(s)`
                            : connections.telegram.configured
                              ? connections.telegram.error
                              : "not configured"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill tone="warn">Exchange</StatusPill>
                        <span className="text-xs text-zinc-400">
                          {connections.exchange.name} · key {connections.exchange.apiKeyPresent ? "set" : "no"} · signer{" "}
                          {connections.exchange.signerPresent ? "set" : "no"} · dry-run only
                        </span>
                      </div>
                    </div>
                  ) : null}
                  {sendResult ? <p className="mt-3 text-xs text-amber-200/90">{sendResult}</p> : null}
                  {connections ? (
                    <p className="mt-2 text-[11px] text-zinc-600">{connections.exchange.tradingConnection}</p>
                  ) : null}
                </div>
                <Button onClick={() => void runDryRun()} disabled={dryRunning}>
                  {dryRunning ? "Computing..." : "Run dry run"}
                </Button>
                {dryRunError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Dry run failed</AlertTitle>
                    <AlertDescription>{dryRunError}</AlertDescription>
                  </Alert>
                ) : null}
                {dryRun ? (
                  <>
                    <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-100">
                      <AlertTitle>Dry run — no orders are sent</AlertTitle>
                      <AlertDescription className="text-amber-100/80">
                        live_actions_enabled = false · write adapter = null · liveSubmitted ={" "}
                        {String(dryRun.plan.liveSubmitted)}. {dryRun.note}
                      </AlertDescription>
                    </Alert>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Row k="Exchange" v={dryRun.exchange} />
                      <Row k="Account label" v={dryRun.accountLabel || "(none)"} />
                      <Row k="API credentials" v={dryRun.credentialsPresent ? "present" : "not set"} />
                      <Row k="Capital" v={usd(dryRun.config.capitalUsd, 0)} />
                      <Row k="Max leverage" v={`${dryRun.config.maxLeverage}x`} />
                      <Row k="Risk / trade" v={`${(dryRun.config.riskPct * 100).toFixed(1)}%`} />
                      <Row k="Max notional" v={dryRun.config.maxNotionalUsd ? usd(dryRun.config.maxNotionalUsd, 0) : "uncapped"} />
                      <Row k="Daily loss limit" v={dryRun.config.dailyLossLimitUsd ? usd(dryRun.config.dailyLossLimitUsd, 0) : "unset"} />
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Planned order</p>
                        <StatusPill tone={dryRun.plan.action === "OPEN_LONG" ? "good" : dryRun.plan.action === "OPEN_SHORT" ? "warn" : "neutral"}>
                          {dryRun.plan.action.replaceAll("_", " ")}
                        </StatusPill>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Row k="Side" v={dryRun.plan.side} />
                        <Row k="Size" v={`${Math.abs(dryRun.plan.sizeBtc).toFixed(5)} BTC`} />
                        <Row k="Notional" v={usd(dryRun.plan.notionalUsd, 0)} />
                        <Row k="Eff. leverage" v={`${dryRun.plan.effectiveLeverage.toFixed(1)}x`} />
                        <Row k="Entry (mark)" v={usd(dryRun.plan.entryPrice, 0)} />
                        <Row k="Initial stop" v={dryRun.plan.stopPrice ? usd(dryRun.plan.stopPrice, 0) : "-"} valueClass="text-rose-300" />
                        <Row k="Notional capped" v={dryRun.plan.notionalCapped ? "yes (risk limit)" : "no"} />
                        <Row k="Submitted" v={String(dryRun.plan.liveSubmitted)} valueClass="text-rose-300" />
                      </div>
                      <p className="mt-3 text-xs text-zinc-500">{dryRun.plan.note}</p>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-zinc-400">
                    Fill in <code>.env</code>, then run the dry run to preview the order the strategy
                    would place — without sending anything.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leverage">
            <Card className="border-white/10 bg-[#14181f]">
              <CardHeader>
                <CardTitle>Leverage &amp; ROE: {usd(leverage.collateralUsd, 0)} at {leverage.leverage}x on Phoenix</CardTitle>
                <CardDescription>
                  Reference for the leverage cap. ROE moves {leverage.leverage}x the BTC price; a round trip
                  costs {leverage.roundTripFeeRoePct.toFixed(2)}% ROE at taker fees; liquidation is at
                  {" "}{leverage.liquidationRoePct.toFixed(0)}% ROE ({pct(leverage.liquidationDistancePct)} move).
                  ATR sizing normally keeps effective leverage well below this cap.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10">
                      <TableHead>BTC move</TableHead>
                      <TableHead className="text-right">BTC price</TableHead>
                      <TableHead className="text-right">P&amp;L</TableHead>
                      <TableHead className="text-right">ROE</TableHead>
                      <TableHead className="text-right">Net ROE (after fees)</TableHead>
                      <TableHead>State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leverage.rows.map((row) => (
                      <TableRow key={row.pricePct} className="border-white/10">
                        <TableCell className="font-mono text-xs">{signed(row.pricePct, 1)}%</TableCell>
                        <TableCell className="text-right font-mono text-xs">{usd(row.price, 0)}</TableCell>
                        <TableCell className={cn("text-right font-mono text-xs", pnlClass(row.pnlUsd))}>{usd(row.pnlUsd)}</TableCell>
                        <TableCell className={cn("text-right font-mono text-xs", pnlClass(row.roePct))}>{signed(row.roePct, 1)}%</TableCell>
                        <TableCell className={cn("text-right font-mono text-xs", pnlClass(row.netRoePct))}>{signed(row.netRoePct, 1)}%</TableCell>
                        <TableCell>
                          {row.liquidated ? <StatusPill tone="bad">Liquidated</StatusPill> : <StatusPill tone="neutral">Open</StatusPill>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="boundary">
            <Card className="border-white/10 bg-[#14181f]">
              <CardHeader>
                <CardTitle>Disabled production boundary</CardTitle>
                <CardDescription>
                  Spec hash {snapshot.specHash}. Long and short are paper regimes. Enabling live writes
                  requires a separate explicit authorization; there is no write adapter and no credential
                  import.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm leading-6 text-zinc-300">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Row k="Write adapter" v="null" />
                  <Row k="Credential modules" v="none imported" />
                  <Row k="Canary authorized" v="false" />
                  <Row k="Kill switch" v="paper flatten only" />
                </div>
                <Separator className="bg-white/10" />
                <p>{snapshot.production.statement}</p>
                <Button variant="destructive" onClick={() => void paperKill()} disabled={killing}>
                  {killing ? "Flattening paper book..." : "Paper kill switch"}
                </Button>
                <p className="text-xs text-zinc-500">
                  The paper kill switch forces the position flat. It does not touch an exchange.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  hint: string;
  valueClass?: string;
}) {
  return (
    <Card className="border-white/10 bg-[#14181f]">
      <CardContent className="pt-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
        <p className={cn("mt-2 text-xl font-semibold tracking-tight", valueClass)}>{value}</p>
        <p className="mt-1 text-xs text-zinc-500">{hint}</p>
      </CardContent>
    </Card>
  );
}

function Row({ k, v, valueClass }: { k: string; v: string; valueClass?: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-zinc-500">{k}</span>
      <span className={cn("text-right font-medium text-zinc-100", valueClass)}>{v}</span>
    </div>
  );
}

function EquityChart({ points, start }: { points: Array<{ t: number; equity: number }>; start: number }) {
  if (!points || points.length < 2) {
    return <p className="text-xs text-zinc-500">Not enough data to chart.</p>;
  }
  const width = 760;
  const height = 220;
  const pad = 10;
  const equities = points.map((p) => p.equity);
  const min = Math.min(...equities, start);
  const max = Math.max(...equities, start);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (width - 2 * pad);
  const y = (equity: number) => pad + (1 - (equity - min) / range) * (height - 2 * pad);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1].equity;
  const up = last >= start;
  const stroke = up ? "#34d399" : "#f87171";
  const baseY = y(start).toFixed(1);
  const startDate = new Date(points[0].t).toISOString().slice(0, 10);
  const endDate = new Date(points[points.length - 1].t).toISOString().slice(0, 10);
  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-white/10 bg-black/30">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full" preserveAspectRatio="none">
          <line x1={pad} y1={baseY} x2={width - pad} y2={baseY} stroke="#3f3f46" strokeWidth="1" strokeDasharray="4 4" />
          <path d={path} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
        <span>{startDate}</span>
        <span>peak {usd(max, 0)} · trough {usd(min, 0)}</span>
        <span>{endDate}</span>
      </div>
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">{label}</Label>
      <Input
        type="number"
        step={step ?? 1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="border-white/10 bg-black/30"
      />
      <p className="text-[10px] text-zinc-600">{hint}</p>
    </div>
  );
}

function ThesisChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <div className="mt-2">
        <StatusPill tone={tone}>{value}</StatusPill>
      </div>
    </div>
  );
}
