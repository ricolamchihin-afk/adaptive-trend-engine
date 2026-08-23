"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import type { VenueConfirmation } from "@/lib/engine/types";
import { hours, pct, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

function pnlClass(value: number): string {
  if (value > 0.5) return "text-emerald-400";
  if (value < -0.5) return "text-rose-400";
  return "text-zinc-300";
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

export function ReadinessConsole() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [venues, setVenues] = useState<VenueConfirmation[]>([]);
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
      setVenues(data.venues.rows);
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
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          throw new Error(data.error || "snapshot_failed");
        }
        setSnapshot(data);
        setVenues(data.venues.rows);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "snapshot_failed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const conservative = snapshot?.mandates.find((row) => row.mandate === "conservative");
  const passedGates = snapshot?.promotion.gates.filter((gate) => gate.passed).length ?? 0;

  const deploymentGap = useMemo(() => {
    if (!conservative) return 0;
    return Math.max(0, conservative.targetNotionalPerVenue - (conservative.maxExposureUsd || 0));
  }, [conservative]);

  async function saveVenues() {
    setSaving(true);
    try {
      const response = await fetch("/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: venues }),
      });
      const data = (await response.json()) as { rows?: VenueConfirmation[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "venue_save_failed");
      }
      if (data.rows) {
        setVenues(data.rows);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "venue_save_failed");
    } finally {
      setSaving(false);
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

  async function runBacktest() {
    setBacktesting(true);
    setBacktestError(null);
    try {
      const response = await fetch("/api/backtest", { cache: "no-store" });
      const data = (await response.json()) as BacktestReport & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "backtest_failed");
      }
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
          <p className="text-xs uppercase tracking-[0.28em] text-amber-200/80">
            Phase 7.9
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-zinc-100">
            Loading Conservative readiness
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Fetching closed Hyperliquid candles, evaluating the daily/4h hierarchy,
            and walking the paper books from the first already-closed one-minute bar.
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
          <AlertTitle>Readiness console failed closed</AlertTitle>
          <AlertDescription>
            {error}. The engine will not invent candles or place orders. Refresh after
            the public market feed recovers.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!snapshot) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#0b0d10] text-zinc-100">
      <header className="border-b border-white/10 bg-[#0e1116]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.32em] text-amber-200/80">
              Smart Grid · Phase 7.9 readiness
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Conservative LONG production boundary
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Selected candidate only. Moderate and Aggressive are exposure/leverage
              benchmarks, not live ideas. This console observes paper books and proposed
              intents. It cannot submit, cancel, or resize an exchange order.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="warn">Selected / hold for live clearance</StatusPill>
            <StatusPill tone="bad">live_actions_enabled = false</StatusPill>
            <StatusPill>{snapshot.runtime.independentLongTransitions} / 20 LONG transitions</StatusPill>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {snapshot.market.warning ? (
          <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-100">
            <AlertTitle>Market feed note</AlertTitle>
            <AlertDescription className="text-amber-100/80">
              {snapshot.market.warning}
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Last refresh failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="BTC mark (last closed 1m)"
            value={snapshot.market.mark ? usd(snapshot.market.mark, 0) : "\u2014"}
            hint={snapshot.market.lastClosed1m ?? "no closed bar"}
          />
          <Metric
            label="Conservative worst-path NAV"
            value={usd(conservative?.worstPathNav ?? 0)}
            hint={`P&L ${usd(conservative?.worstPathPnl ?? 0)} after costs`}
            valueClass={pnlClass(conservative?.worstPathPnl ?? 0)}
          />
          <Metric
            label="Target vs current (per venue)"
            value={`${usd(conservative?.targetNotionalPerVenue ?? 0)} / ${usd(conservative?.maxExposureUsd ?? 0)}`}
            hint={`Immediate ${usd(conservative?.immediateNotionalPerVenue ?? 0)} · gap ${usd(deploymentGap)}`}
          />
          <Metric
            label="Paper duration"
            value={hours(snapshot.runtime.paperDurationHours)}
            hint={`Epoch start ${snapshot.runtime.epochStart}`}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          {snapshot.mandates.map((mandate) => (
            <Card
              key={mandate.mandate}
              className={cn(
                "border-white/10 bg-[#14181f]",
                mandate.selected && "ring-1 ring-amber-400/40",
              )}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-xl text-zinc-50">{mandate.name}</CardTitle>
                    <CardDescription className="mt-1">
                      {mandate.selected
                        ? "Frozen production candidate"
                        : "Research benchmark only"}
                    </CardDescription>
                  </div>
                  <Badge variant={mandate.selected ? "default" : "secondary"}>
                    {mandate.selected ? "Selected" : "Benchmark"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row k="Deployment" v={mandate.deploymentStatus.replaceAll("_", " ")} />
                <Row k="Target / venue" v={usd(mandate.targetNotionalPerVenue)} />
                <Row k="Immediate starter" v={usd(mandate.immediateNotionalPerVenue)} />
                <Row k="Grid remainder" v={usd(mandate.gridRemainderPerVenue)} />
                <Row k="Worst-path NAV" v={usd(mandate.worstPathNav)} />
                <Row
                  k="Grid harvest"
                  v={usd(mandate.gridHarvestGross)}
                  valueClass={pnlClass(mandate.gridHarvestGross)}
                />
                <Row
                  k="Inventory MTM"
                  v={usd(mandate.inventoryMtmPnl)}
                  valueClass={pnlClass(mandate.inventoryMtmPnl)}
                />
                <Row k="Fees" v={usd(mandate.fees)} valueClass="text-rose-300" />
                <Row k="Funding placeholder" v={usd(0)} />
                <Row
                  k="After-cost P&L"
                  v={usd(mandate.worstPathPnl)}
                  valueClass={pnlClass(mandate.worstPathPnl)}
                />
                <Row k="Min liq. buffer" v={pct(mandate.minBufferPct)} />
              </CardContent>
            </Card>
          ))}
        </section>

        <Card className="border-white/10 bg-[#14181f]">
          <CardHeader>
            <CardTitle>Decision panel</CardTitle>
            <CardDescription>
              Daily/4h evidence sets direction. Extension score sizes the target.
              15m Z-score/RSI only changes how fast Conservative deploys. Soft
              timing cannot flatten an eligible LONG.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ThesisChip
                label="Thesis"
                value={snapshot.hierarchy?.thesis ?? "FLAT"}
                tone={snapshot.hierarchy?.thesis === "LONG" ? "good" : "neutral"}
              />
              <ThesisChip
                label="Extension score"
                value={
                  snapshot.hierarchy?.extensionScore === null ||
                  snapshot.hierarchy?.extensionScore === undefined
                    ? "\u2014"
                    : snapshot.hierarchy.extensionScore.toFixed(1)
                }
                tone="warn"
              />
              <ThesisChip
                label="15m pace"
                value={
                  snapshot.hierarchy?.pace
                    ? `${snapshot.hierarchy.pace * 100}% immediate`
                    : "\u2014"
                }
                tone="neutral"
              />
              <ThesisChip
                label="Hard halt"
                value={snapshot.hierarchy?.hardHalt ? snapshot.hierarchy.haltReason ?? "halt" : "none"}
                tone={snapshot.hierarchy?.hardHalt ? "bad" : "good"}
              />
            </div>
            <p className="text-sm leading-6 text-zinc-300">
              {snapshot.hierarchy?.explanation}
            </p>
            {snapshot.allocation ? (
              <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Conservative allocation at this score
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Row k="Score-100 floor" v={usd(snapshot.allocation.floorNotional)} />
                  <Row k="Score-0 maximum" v={usd(snapshot.allocation.maxNotional)} />
                  <Row k="Current target" v={usd(snapshot.allocation.targetNotional)} />
                  <Row k="Staged now" v={usd(snapshot.allocation.immediateNotional)} />
                </div>
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    <TableHead>Evidence</TableHead>
                    <TableHead>Reading</TableHead>
                    <TableHead>Threshold</TableHead>
                    <TableHead>Portfolio effect</TableHead>
                    <TableHead>Authority</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.hierarchy?.indicators.map((item) => (
                    <TableRow key={item.id} className="border-white/10">
                      <TableCell className="min-w-40">
                        <div className="font-medium text-zinc-100">{item.name}</div>
                        <div className="text-xs text-zinc-500">{item.timeframe}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.formatted}</TableCell>
                      <TableCell className="max-w-xs text-xs text-zinc-400">
                        {item.threshold}
                      </TableCell>
                      <TableCell className="max-w-xs text-xs text-zinc-400">
                        {item.effect}
                      </TableCell>
                      <TableCell className="max-w-xs text-xs text-zinc-500">
                        {item.authority}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="rounded-lg border border-white/10 p-4 text-sm text-zinc-400">
              <p className="font-medium text-zinc-200">Outcome legend</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>LONG thesis: eligible daily + 4h direction, no hard halt.</li>
                <li>Target notional: linear from the mandate floor at score 100 to 100% at score 0.</li>
                <li>Deployment pace: 100%, 50% or 25% of that target as a staged market allocation.</li>
                <li>Hard halt: conflict, transition, tail, gap, or kill switch. Flatten and block.</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="gates" className="space-y-4">
          <TabsList className="bg-[#14181f]">
            <TabsTrigger value="gates">Promotion gates</TabsTrigger>
            <TabsTrigger value="leverage">Leverage &amp; ROE</TabsTrigger>
            <TabsTrigger value="backtest">Backtest</TabsTrigger>
            <TabsTrigger value="books">Conservative books</TabsTrigger>
            <TabsTrigger value="intents">Dry-run intents</TabsTrigger>
            <TabsTrigger value="venues">Venue registry</TabsTrigger>
            <TabsTrigger value="boundary">Production boundary</TabsTrigger>
          </TabsList>

          <TabsContent value="gates">
            <Card className="border-white/10 bg-[#14181f]">
              <CardHeader>
                <CardTitle>Fixed promotion gates</CardTitle>
                <CardDescription>
                  {passedGates} / {snapshot.promotion.gates.length} passed. Do not improvise
                  extra gates or treat a short correlated sample as clearance.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={(passedGates / snapshot.promotion.gates.length) * 100} />
                <div className="space-y-3">
                  {snapshot.promotion.gates.map((gate) => (
                    <div
                      key={gate.id}
                      className="flex flex-col gap-2 rounded-lg border border-white/10 p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div>
                        <p className="font-medium text-zinc-100">
                          {gate.id}. {gate.title}
                        </p>
                        <p className="mt-1 text-sm text-zinc-400">{gate.detail}</p>
                      </div>
                      <StatusPill tone={gate.passed ? "good" : "bad"}>
                        {gate.passed ? "Pass" : "Hold"}
                      </StatusPill>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leverage">
            <Card className="border-white/10 bg-[#14181f]">
              <CardHeader>
                <CardTitle>Leverage &amp; ROE — 1000 USDC at 10x on Phoenix</CardTitle>
                <CardDescription>
                  Long BTC on Phoenix taker fees, anchored to the current mark
                  ({usd(snapshot.leverage.entryPrice, 0)}). ROE moves 10x the BTC price
                  because collateral is levered 10x. A move to the liquidation distance wipes
                  the margin. This is a paper sizing calculator; it places no orders.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Row k="Collateral" v={usd(snapshot.leverage.collateralUsd, 0)} />
                  <Row k="Position notional" v={usd(snapshot.leverage.notionalUsd, 0)} />
                  <Row k="Position size" v={`${snapshot.leverage.sizeBtc.toFixed(5)} BTC`} />
                  <Row
                    k="Liquidation"
                    v={`${usd(snapshot.leverage.liquidationPrice, 0)} (${pct(snapshot.leverage.liquidationDistancePct)})`}
                    valueClass="text-rose-300"
                  />
                </div>
                <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-100">
                  <AlertTitle>Fees are a fixed drag on every round trip</AlertTitle>
                  <AlertDescription className="text-amber-100/80">
                    Opening and closing 10x notional costs {snapshot.leverage.roundTripFeeRoePct.toFixed(2)}% ROE
                    at Phoenix taker fees, or {snapshot.leverage.makerRoundTripFeeRoePct.toFixed(2)}% ROE if both
                    legs rest as maker. A take-profit must clear that before it earns anything, and a stop must
                    sit well inside the {snapshot.leverage.liquidationRoePct.toFixed(0)}% ROE liquidation line.
                  </AlertDescription>
                </Alert>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10">
                        <TableHead>BTC move</TableHead>
                        <TableHead className="text-right">BTC price</TableHead>
                        <TableHead className="text-right">P&amp;L</TableHead>
                        <TableHead className="text-right">ROE</TableHead>
                        <TableHead className="text-right">Net P&amp;L (after fees)</TableHead>
                        <TableHead className="text-right">Net ROE</TableHead>
                        <TableHead>State</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snapshot.leverage.rows.map((row) => (
                        <TableRow key={row.pricePct} className="border-white/10">
                          <TableCell className="font-mono text-xs">
                            {row.pricePct > 0 ? "+" : ""}
                            {row.pricePct}%
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {usd(row.price, 0)}
                          </TableCell>
                          <TableCell className={cn("text-right font-mono text-xs", pnlClass(row.pnlUsd))}>
                            {usd(row.pnlUsd)}
                          </TableCell>
                          <TableCell className={cn("text-right font-mono text-xs", pnlClass(row.roePct))}>
                            {row.roePct > 0 ? "+" : ""}
                            {row.roePct.toFixed(1)}%
                          </TableCell>
                          <TableCell className={cn("text-right font-mono text-xs", pnlClass(row.netPnlUsd))}>
                            {usd(row.netPnlUsd)}
                          </TableCell>
                          <TableCell className={cn("text-right font-mono text-xs", pnlClass(row.netRoePct))}>
                            {row.netRoePct > 0 ? "+" : ""}
                            {row.netRoePct.toFixed(1)}%
                          </TableCell>
                          <TableCell>
                            {row.liquidated ? (
                              <StatusPill tone="bad">Liquidated</StatusPill>
                            ) : (
                              <StatusPill tone="neutral">Open</StatusPill>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-zinc-500">
                  Shorts mirror this table with the sign flipped, but this repository does not open
                  short inventory. Enabling a short/neutral regime is a separate, gated change.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="backtest">
            <Card className="border-white/10 bg-[#14181f]">
              <CardHeader>
                <CardTitle>Backtest — frozen long-only engine over closed candles</CardTitle>
                <CardDescription>
                  Walks the already-closed public candle window through the same engine the console
                  runs and reports net outcomes, including how much of the gross the fees consume.
                  This measures the current strategy; it does not tune any parameter.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <Button onClick={() => void runBacktest()} disabled={backtesting}>
                  {backtesting ? "Walking candles\u2026" : "Run backtest"}
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
                      <Row k="Candles" v={backtest.candleCount.toLocaleString("en-US")} />
                      <Row k="Window" v={hours(backtest.durationHours)} />
                      <Row k="Feed" v={backtest.marketSource.replaceAll("_", " ")} />
                      <Row k="LONG transitions" v={String(backtest.independentLongTransitions)} />
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-white/10">
                            <TableHead>Mandate</TableHead>
                            <TableHead className="text-right">Net P&amp;L</TableHead>
                            <TableHead className="text-right">ROE</TableHead>
                            <TableHead className="text-right">Harvest</TableHead>
                            <TableHead className="text-right">Inv. MTM</TableHead>
                            <TableHead className="text-right">Fees</TableHead>
                            <TableHead className="text-right">Fees / gross</TableHead>
                            <TableHead>Invariants</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {backtest.mandates.map((mandate) => (
                            <TableRow key={mandate.mandate} className="border-white/10">
                              <TableCell className="capitalize">{mandate.mandate}</TableCell>
                              <TableCell className={cn("text-right font-mono text-xs", pnlClass(mandate.worstPathPnlUsd))}>
                                {usd(mandate.worstPathPnlUsd)}
                              </TableCell>
                              <TableCell className={cn("text-right font-mono text-xs", pnlClass(mandate.roePct))}>
                                {mandate.roePct > 0 ? "+" : ""}
                                {mandate.roePct.toFixed(2)}%
                              </TableCell>
                              <TableCell className={cn("text-right font-mono text-xs", pnlClass(mandate.gridHarvestGrossUsd))}>
                                {usd(mandate.gridHarvestGrossUsd)}
                              </TableCell>
                              <TableCell className={cn("text-right font-mono text-xs", pnlClass(mandate.inventoryMtmPnlUsd))}>
                                {usd(mandate.inventoryMtmPnlUsd)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-rose-300">
                                {usd(mandate.feesUsd)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-rose-300">
                                {mandate.feeShareOfGrossPct === null
                                  ? "\u2014"
                                  : `${mandate.feeShareOfGrossPct.toFixed(0)}%`}
                              </TableCell>
                              <TableCell className="text-xs">
                                {mandate.everShort || mandate.everLiquidated || mandate.exposureCapBreached ? (
                                  <StatusPill tone="bad">breach</StatusPill>
                                ) : (
                                  <StatusPill tone="good">clean</StatusPill>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-xs text-zinc-500">{backtest.note}</p>
                  </>
                ) : (
                  <p className="text-sm text-zinc-400">
                    No backtest yet. Run it to see net P&amp;L, ROE, and the fee share of gross over the
                    closed-candle window.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="books">
            <Card className="border-white/10 bg-[#14181f]">
              <CardHeader>
                <CardTitle>Conservative venue-path books</CardTitle>
                <CardDescription>
                  Five isolated USD 800 research books × low-first / high-first. Capital is
                  not pooled. Report harvest, inventory beta, fees and funding separately.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10">
                      <TableHead>Path</TableHead>
                      <TableHead>Venue</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Exposure</TableHead>
                      <TableHead className="text-right">Target</TableHead>
                      <TableHead className="text-right">Harvest</TableHead>
                      <TableHead className="text-right">MTM</TableHead>
                      <TableHead className="text-right">Fees</TableHead>
                      <TableHead className="text-right">P&L</TableHead>
                      <TableHead className="text-right">Buffer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshot.conservativeBooks.map((book) => (
                      <TableRow
                        key={`${book.pathMode}-${book.venue}`}
                        className="border-white/10"
                      >
                        <TableCell className="font-mono text-xs">{book.pathMode}</TableCell>
                        <TableCell>{book.venue}</TableCell>
                        <TableCell className="text-xs text-zinc-400">
                          {book.deploymentStatus.replaceAll("_", " ")}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {usd(book.exposureUsd)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {usd(book.targetNotional)}
                        </TableCell>
                        <TableCell className={cn("text-right font-mono text-xs", pnlClass(book.gridHarvestGross))}>
                          {usd(book.gridHarvestGross)}
                        </TableCell>
                        <TableCell className={cn("text-right font-mono text-xs", pnlClass(book.inventoryMtmPnl))}>
                          {usd(book.inventoryMtmPnl)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-rose-300">
                          {usd(book.fees)}
                        </TableCell>
                        <TableCell className={cn("text-right font-mono text-xs", pnlClass(book.totalPnl))}>
                          {usd(book.totalPnl)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {pct(book.liquidationBufferPct)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="intents">
            <Card className="border-white/10 bg-[#14181f]">
              <CardHeader>
                <CardTitle>Disabled dry-run intent ledger</CardTitle>
                <CardDescription>
                  Idempotent client-order IDs compared with the shadow engine. Every row
                  has liveSubmitted=false. There is no write adapter to enable.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {snapshot.intents.length === 0 ? (
                  <p className="text-sm text-zinc-400">
                    No proposed intents yet. Intents appear when the hierarchy is eligible
                    LONG or when a flatten is required.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10">
                        <TableHead>When</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>Book</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead>Sent</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snapshot.intents.map((intent) => (
                        <TableRow key={intent.clientOrderId} className="border-white/10">
                          <TableCell className="font-mono text-xs">
                            {new Date(intent.time).toISOString()}
                          </TableCell>
                          <TableCell>{intent.kind}</TableCell>
                          <TableCell className="text-xs">
                            {intent.mandate} · {intent.venue} · {intent.pathMode}
                          </TableCell>
                          <TableCell>{intent.side}</TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {usd(intent.price, 0)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {intent.qty.toFixed(5)}
                          </TableCell>
                          <TableCell>
                            <StatusPill tone="bad">false</StatusPill>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="venues">
            <Card className="border-white/10 bg-[#14181f]">
              <CardHeader>
                <CardTitle>Five-venue confirmation</CardTitle>
                <CardDescription>
                  Record the intended live account identities and operator-reported free
                  collateral. Do not paste API keys, secrets, or seed phrases. This form
                  rejects those fields.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4">
                  {venues.map((row, index) => (
                    <div
                      key={row.id}
                      className="grid gap-3 rounded-lg border border-white/10 p-4 md:grid-cols-6"
                    >
                      <div className="md:col-span-6 flex items-center justify-between">
                        <p className="font-medium">{row.label}</p>
                        <label className="flex items-center gap-2 text-xs text-zinc-400">
                          <input
                            type="checkbox"
                            checked={row.confirmed}
                            onChange={(event) => {
                              const next = [...venues];
                              next[index] = { ...row, confirmed: event.target.checked };
                              setVenues(next);
                            }}
                          />
                          Identity confirmed
                        </label>
                      </div>
                      <Field
                        label="Account label"
                        value={row.accountLabel}
                        onChange={(value) => {
                          const next = [...venues];
                          next[index] = { ...row, accountLabel: value };
                          setVenues(next);
                        }}
                      />
                      <Field
                        label="Reported free USD/USDC"
                        value={row.reportedFreeCollateralUsd ?? ""}
                        onChange={(value) => {
                          const next = [...venues];
                          next[index] = {
                            ...row,
                            reportedFreeCollateralUsd: value === "" ? null : Number(value),
                          };
                          setVenues(next);
                        }}
                      />
                      <Field
                        label="BTC contract"
                        value={row.btcContract}
                        onChange={(value) => {
                          const next = [...venues];
                          next[index] = { ...row, btcContract: value };
                          setVenues(next);
                        }}
                      />
                      <Field
                        label="Collateral mode"
                        value={row.collateralMode}
                        onChange={(value) => {
                          const next = [...venues];
                          next[index] = { ...row, collateralMode: value };
                          setVenues(next);
                        }}
                      />
                      <Field
                        label="Notes"
                        value={row.notes}
                        onChange={(value) => {
                          const next = [...venues];
                          next[index] = { ...row, notes: value };
                          setVenues(next);
                        }}
                      />
                    </div>
                  ))}
                </div>
                <Button onClick={() => void saveVenues()} disabled={saving}>
                  {saving ? "Saving labels\u2026" : "Save venue labels"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="boundary">
            <Card className="border-white/10 bg-[#14181f]">
              <CardHeader>
                <CardTitle>Disabled production boundary</CardTitle>
                <CardDescription>
                  Spec hash {snapshot.specHash}. Changing live_actions_enabled requires a
                  separate explicit authorization that names every venue, capital,
                  notional, daily loss, buffer and canary duration.
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
                <p className="text-zinc-400">
                  Hard limits remain unapproved drafts: Conservative 10x on deployed
                  margin, 20% allocation, 40% liquidation-buffer floor, approximately
                  USD 1,200–1,600 maximum notional per venue. A canary size must not be
                  inferred from the USD 4,000 research assumption.
                </p>
                <Button variant="destructive" onClick={() => void paperKill()} disabled={killing}>
                  {killing ? "Flattening paper books\u2026" : "Paper kill switch"}
                </Button>
                <p className="text-xs text-zinc-500">
                  The paper kill switch cancels simulated openings and reduces paper
                  inventory. It does not touch an exchange.
                </p>
                <div className="space-y-2">
                  {snapshot.events.map((event, index) => (
                    <p key={`${event.time}-${index}`} className="text-xs text-zinc-500">
                      {new Date(event.time).toISOString()} · {event.type} · {event.message}
                    </p>
                  ))}
                </div>
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

function Row({
  k,
  v,
  valueClass,
}: {
  k: string;
  v: string;
  valueClass?: string;
}) {
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

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-zinc-400">{label}</Label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-white/10 bg-black/30"
      />
    </div>
  );
}
