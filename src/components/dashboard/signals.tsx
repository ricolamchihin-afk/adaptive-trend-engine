"use client";

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SignalReport } from "@/lib/engine/signal";
import { US_EQUITY_WATCHLIST } from "@/lib/engine/universe";
import { cn } from "@/lib/utils";

function tone(bias: string): string {
  if (bias === "LONG" || bias === "ENTER_LONG") return "text-emerald-400";
  if (bias === "SHORT" || bias === "ENTER_SHORT") return "text-rose-300";
  return "text-zinc-300";
}

function fmt(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export function SignalsPanel() {
  const [symbol, setSymbol] = useState("AAPL");
  const [signal, setSignal] = useState<SignalReport | null>(null);
  const [scan, setScan] = useState<SignalReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadOne() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/signal?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
      const data = (await response.json()) as SignalReport & { error?: string };
      if (!response.ok) throw new Error(data.error || "signal_failed");
      setSignal(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "signal_failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadScan() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/signal?symbols=${US_EQUITY_WATCHLIST.slice(0, 8).join(",")}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as { signals?: SignalReport[]; error?: string };
      if (!response.ok) throw new Error(data.error || "scan_failed");
      setScan(data.signals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "scan_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-white/10 bg-[#14181f]">
      <CardHeader>
        <CardTitle>Aster / Grok signals</CardTitle>
        <CardDescription>
          Same Donchian + daily EMA + RSI gates as the backtest. Crypto reads Binance/Hyperliquid;
          stocks read US cash. Output is paper LONG / SHORT / FLAT for the matching Aster perp.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="signal-symbol">Symbol</Label>
            <Input
              id="signal-symbol"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              placeholder="AAPL or BTC"
              className="w-40"
            />
          </div>
          <Button onClick={() => void loadOne()} disabled={busy}>
            {busy ? "Reading…" : "Read signal"}
          </Button>
          <Button variant="secondary" onClick={() => void loadScan()} disabled={busy}>
            Scan MAG7 + QQQ
          </Button>
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Signal failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {signal ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <div className="text-xs text-zinc-500">Bias</div>
                <div className={cn("font-semibold", tone(signal.setup.bias))}>{signal.setup.bias}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Action</div>
                <div className={cn("font-semibold", tone(signal.setup.action))}>{signal.setup.action}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Route</div>
                <div className="font-mono text-xs text-zinc-300">
                  {signal.route.assetClass} · {signal.source} → {signal.route.asterSymbol}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Mark</div>
                <div className="font-mono">{fmt(signal.mark)}</div>
              </div>
            </div>
            <p className="text-xs text-zinc-400">{signal.setup.reasons.join(" · ")}</p>
            <p className="text-xs text-zinc-500">{signal.route.note}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Indicator</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Daily dir</TableCell>
                  <TableCell className="font-mono">{signal.indicators.dailyDir}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>RSI / ADX / ATR</TableCell>
                  <TableCell className="font-mono">
                    {fmt(signal.indicators.rsi, 1)} / {fmt(signal.indicators.adx, 1)} / {fmt(signal.indicators.atr)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Donchian entry</TableCell>
                  <TableCell className="font-mono">
                    {fmt(signal.indicators.entryLow)} / {fmt(signal.indicators.entryHigh)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>MACD hist / EMA slope %</TableCell>
                  <TableCell className="font-mono">
                    {fmt(signal.indicators.macdHist, 3)} / {fmt(signal.indicators.dailyEmaSlopePct, 2)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        ) : null}
        {scan ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Bias</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Mark</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scan.map((row) => (
                <TableRow key={row.symbol}>
                  <TableCell className="font-mono">{row.symbol}</TableCell>
                  <TableCell className={tone(row.setup.bias)}>{row.setup.bias}</TableCell>
                  <TableCell className={tone(row.setup.action)}>{row.setup.action}</TableCell>
                  <TableCell className="font-mono text-xs">{row.source}</TableCell>
                  <TableCell className="font-mono">{fmt(row.mark)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
