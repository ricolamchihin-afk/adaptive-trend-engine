import { defaultSimConfig, runSimulation, type RegimeBar } from "./simulate";
import { classifyRegime } from "./strategy";
import { STRATEGY } from "./spec";
import type { MarketSeries, MarketSource, Regime } from "./types";

export interface BacktestReport {
  epochStart: string;
  epochEnd: string;
  executionTimeframe: string;
  bars: number;
  durationDays: number;
  marketSource: MarketSource;
  capitalUsd: number;
  leverage: number;
  startEquityUsd: number;
  finalEquityUsd: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  trades: number;
  winRatePct: number | null;
  feesUsd: number;
  perRegimePnlUsd: Record<Regime, number>;
  barsInRegime: Record<Regime, number>;
  liquidations: number;
  everLiquidated: boolean;
  everShort: boolean;
  blownUp: boolean;
  note: string;
}

// Backtests the dynamic long/short/grid strategy on the 4h execution timeframe.
// Regime is classified from the daily + 4h context at each closed bar, then the
// signed-position simulator walks the bars. 4h keeps a full year in one feed.
export function runBacktest(
  series: MarketSeries,
  marketSource: MarketSource,
): BacktestReport {
  const exec = series.fourHour;
  if (!exec.length) {
    throw new Error("no_four_hour_candles");
  }

  const bars: RegimeBar[] = exec.map((candle) => ({
    candle,
    regime: classifyRegime(series, candle.openTime).regime,
    pathMode: "low_first" as const,
  }));

  const result = runSimulation(bars, defaultSimConfig());
  const first = exec[0].openTime;
  const last = exec[exec.length - 1].openTime;

  return {
    epochStart: new Date(first).toISOString(),
    epochEnd: new Date(last).toISOString(),
    executionTimeframe: "4h",
    bars: exec.length,
    durationDays: (last - first) / 86_400_000,
    marketSource,
    capitalUsd: STRATEGY.capitalUsd,
    leverage: STRATEGY.leverage,
    startEquityUsd: result.startEquityUsd,
    finalEquityUsd: result.finalEquityUsd,
    totalReturnPct: result.totalReturnPct,
    maxDrawdownPct: result.maxDrawdownPct,
    trades: result.trades,
    winRatePct: result.winRatePct,
    feesUsd: result.feesUsd,
    perRegimePnlUsd: result.perRegimePnlUsd,
    barsInRegime: result.barsInRegime,
    liquidations: result.liquidations,
    everLiquidated: result.everLiquidated,
    everShort: result.everShort,
    blownUp: result.blownUp,
    note:
      marketSource === "hyperliquid_public"
        ? "Dynamic long/short/grid at 10x on 4h closed public candles. Paper only; no live orders."
        : "Offline synthetic candles. Labeled and not evidence.",
  };
}
