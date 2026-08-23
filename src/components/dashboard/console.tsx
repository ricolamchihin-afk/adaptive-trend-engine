"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const REGIMES: Regime[] = ["LONG", "SHORT", "GRID", "FLAT"];

function pnlClass(value: number): string {
  if (value > 0.0001) return "text-emerald-400";
  if (value < -0.0001) return "text-rose-400";
  return "text-zinc-300";
}

function regimeTone(regime: string): "good" | "warn" | "bad" | "neutral" {
  if (regime === "LONG") return "good";
  if (regime === "SHORT") return "warn";
  if (regime === "GRID") return "neutral";
  return "bad";
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

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/snapshot", { cache: "no-store" });
      const data = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "snapshot_failed");
      }
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

  async function paperKill() {
    setKilling(true);
    try {
      await fetch("/api/kill", { method: "POST" });
      await load();
    } finally {
      setKilling(false);
    }
  }

  async function runBacktest() {
    setBacktesting(true);
    setBacktestError(null);
    try {
      const response = await fetch("/api/backtest", { cache: "no-store" });
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
          <h1 className="mt-3 text-2xl font-semibold text-zinc-100">
            Loading dynamic directional strategy
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Fetching closed Hyperliquid candles and classifying the daily/4h regime.
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
          <AlertDescription>
            {error}. The engine will not invent candles or place orders.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!snapshot) return null;

  const { regime, position, strategy, market, leverage } = snapshot;

  return (
    <div className="min-h-screen bg-[#0b0d10] text-zinc-100">
      <header className="border-b border-white/10 bg-[#0e1116]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.32em] text-amber-200/80">
              Smart Grid · Phase 7.10
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Dynamic directional exposure
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              One Phoenix book, {usd(strategy.capitalUsd, 0)} at {strategy.leverage}x.
              The daily/4h trend picks LONG, SHORT, or a neutral GRID; a hard halt goes
              FLAT. Paper only — this console cannot submit, cancel, or resize an order.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={regimeTone(regime.regime)}>Regime: {regime.regime}</StatusPill>
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
          <Metric label="BTC mark" value={market.mark ? usd(market.mark, 0) : "\u2014"} hint={market.lastClosed ?? "no closed bar"} />
          <Metric
            label="Current regime"
            value={regime.regime}
            hint={regime.reason.replaceAll("_", " ")}
            valueClass={
              regime.regime === "LONG"
                ? "text-emerald-400"
                : regime.regime === "SHORT"
                  ? "text-amber-300"
                  : "text-zinc-300"
            }
          />
          <Metric
            label="Intended position"
            value={
              position.side === "FLAT"
                ? "Flat"
                : `${position.side} ${position.sizeBtc.toFixed(4)} BTC`
            }
            hint={position.side === "FLAT" ? "no exposure" : `${usd(position.notionalUsd, 0)} notional @ ${strategy.leverage}x`}
            valueClass={position.side === "SHORT" ? "text-amber-300" : position.side === "LONG" ? "text-emerald-400" : undefined}
          />
          <Metric
            label="Liquidation price"
            value={position.liquidationPrice ? usd(position.liquidationPrice, 0) : "\u2014"}
            hint={`${pct(position.liquidationDistancePct)} away at ${strategy.leverage}x`}
            valueClass="text-rose-300"
          />
        </section>

        <Card className="border-white/10 bg-[#14181f]">
          <CardHeader>
            <CardTitle>Regime decision (daily + 4h)</CardTitle>
            <CardDescription>
              A trending 4h that agrees with the daily bias sets LONG or SHORT. A weak
              (non-trending) ADX runs the neutral GRID. RSI tails or a conflict force FLAT.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ThesisChip label="Regime" value={regime.regime} tone={regimeTone(regime.regime)} />
              <ThesisChip
                label="Daily bias"
                value={regime.dailyBullish === null ? "\u2014" : regime.dailyBullish ? "Bullish" : "Bearish"}
                tone={regime.dailyBullish ? "good" : "warn"}
              />
              <ThesisChip
                label="4h trend"
                value={regime.fourHourUp ? "Up" : regime.fourHourDown ? "Down" : "Flat"}
                tone={regime.fourHourUp ? "good" : regime.fourHourDown ? "warn" : "neutral"}
              />
              <ThesisChip
                label="4h ADX"
                value={regime.fourHourAdx === null ? "\u2014" : `${regime.fourHourAdx.toFixed(1)}${regime.trending ? " (trend)" : " (range)"}`}
                tone={regime.trending ? "good" : "neutral"}
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
            <TabsTrigger value="backtest">1-year backtest</TabsTrigger>
            <TabsTrigger value="leverage">Leverage &amp; ROE</TabsTrigger>
            <TabsTrigger value="boundary">Production boundary</TabsTrigger>
          </TabsList>

          <TabsContent value="backtest">
            <Card className="border-white/10 bg-[#14181f]">
              <CardHeader>
                <CardTitle>Backtest — dynamic long/short/grid at 10x</CardTitle>
                <CardDescription>
                  Classifies the regime at every closed 4h bar over roughly a year and walks
                  the signed-position simulator (protective stop and liquidation modeled).
                  Measures the strategy; it tunes nothing.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <Button onClick={() => void runBacktest()} disabled={backtesting}>
                  {backtesting ? "Walking a year of candles\u2026" : "Run 1-year backtest"}
                </Button>
                {backtestError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Backtest failed</AlertTitle>
                    <AlertDescription>{backtestError}</AlertDescription>
                  </Alert>
                ) : null}
                {backtest ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Metric label="Total return (ROE)" value={`${signed(backtest.totalReturnPct)}%`} hint={`${usd(backtest.startEquityUsd, 0)} -> ${usd(backtest.finalEquityUsd, 0)}`} valueClass={pnlClass(backtest.totalReturnPct)} />
                      <Metric label="Max drawdown" value={`-${backtest.maxDrawdownPct.toFixed(1)}%`} hint="peak-to-trough on equity" valueClass="text-rose-300" />
                      <Metric label="Trades" value={String(backtest.trades)} hint={backtest.winRatePct === null ? "no closed trades" : `${backtest.winRatePct.toFixed(0)}% win rate`} />
                      <Metric label="Fees" value={usd(backtest.feesUsd)} hint={`${backtest.bars} bars · ${backtest.durationDays.toFixed(0)} days`} valueClass="text-rose-300" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill tone={backtest.everLiquidated ? "bad" : "good"}>
                        {backtest.everLiquidated ? `${backtest.liquidations} liquidation(s)` : "no liquidation"}
                      </StatusPill>
                      <StatusPill tone="neutral">{backtest.everShort ? "used shorts" : "long only"}</StatusPill>
                      <StatusPill tone={backtest.finalEquityUsd >= backtest.startEquityUsd * 0.5 ? "good" : "bad"}>
                        {backtest.blownUp
                          ? "account blew up"
                          : backtest.finalEquityUsd < backtest.startEquityUsd * 0.5
                            ? "near-total loss"
                            : "survived"}
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
                                {backtest.bars ? `${((backtest.barsInRegime[r] / backtest.bars) * 100).toFixed(0)}%` : "\u2014"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {backtest.epochStart} → {backtest.epochEnd}. {backtest.note}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-zinc-400">
                    No backtest yet. Run it to see total return, drawdown, per-regime P&amp;L, and
                    whether 10x survived the year.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leverage">
            <Card className="border-white/10 bg-[#14181f]">
              <CardHeader>
                <CardTitle>Leverage &amp; ROE — {usd(leverage.collateralUsd, 0)} at {leverage.leverage}x on Phoenix</CardTitle>
                <CardDescription>
                  ROE moves {leverage.leverage}x the BTC price. A round trip costs
                  {" "}{leverage.roundTripFeeRoePct.toFixed(2)}% ROE at taker fees; liquidation is at
                  {" "}{leverage.liquidationRoePct.toFixed(0)}% ROE ({pct(leverage.liquidationDistancePct)} move). Anchored to {usd(leverage.entryPrice, 0)}.
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
                  Spec hash {snapshot.specHash}. Long and short are paper regimes. Enabling
                  live writes requires a separate explicit authorization; there is no write
                  adapter and no credential import.
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
                  {killing ? "Flattening paper book\u2026" : "Paper kill switch"}
                </Button>
                <p className="text-xs text-zinc-500">
                  The paper kill switch forces the regime FLAT. It does not touch an exchange.
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
