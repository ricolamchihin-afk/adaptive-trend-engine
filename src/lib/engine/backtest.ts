import type { MarketSeries } from "./hierarchy";
import { MANDATES } from "./spec";
import {
  advanceRuntime,
  createEmptyRuntime,
  mandateSummaries,
} from "./shadow";
import type { MandateId, MarketSource } from "./types";

export interface BacktestMandateResult {
  mandate: MandateId;
  role: string;
  startingNavUsd: number;
  worstPathNav: number;
  worstPathPnlUsd: number;
  roePct: number;
  gridHarvestGrossUsd: number;
  inventoryMtmPnlUsd: number;
  feesUsd: number;
  grossBeforeFeesUsd: number;
  feeDragPctOfCapital: number;
  // Share of gross profit consumed by fees (only meaningful when gross > 0).
  feeShareOfGrossPct: number | null;
  maxExposureUsd: number;
  minBufferPct: number;
  everShort: boolean;
  everLiquidated: boolean;
  exposureCapBreached: boolean;
}

export interface BacktestReport {
  epochStart: string;
  epochEnd: string;
  candleCount: number;
  durationHours: number;
  marketSource: MarketSource;
  independentLongTransitions: number;
  mandates: BacktestMandateResult[];
  note: string;
}

// Walks the already-closed one-minute series through the existing long-only
// engine and reports honest per-mandate outcomes. This is a measurement of the
// frozen strategy (fees vs. harvest, net ROE), not a parameter search.
export function runBacktest(
  series: MarketSeries,
  marketSource: MarketSource,
): BacktestReport {
  const oneMinute = series.oneMinute;
  if (!oneMinute.length) {
    throw new Error("no_closed_one_minute_candles");
  }
  const first = oneMinute[0].openTime;
  const last = oneMinute[oneMinute.length - 1].openTime;

  let state = createEmptyRuntime(Date.now(), first);
  state = advanceRuntime(state, series, marketSource, false);

  const summaries = mandateSummaries(state);
  const mandates: BacktestMandateResult[] = summaries.map((summary) => {
    const spec = MANDATES[summary.mandate];
    const grossBeforeFees = summary.gridHarvestGross + summary.inventoryMtmPnl;
    return {
      mandate: summary.mandate,
      role: spec.role,
      startingNavUsd: spec.startingNavUsd,
      worstPathNav: summary.worstPathNav,
      worstPathPnlUsd: summary.worstPathPnl,
      roePct: (summary.worstPathPnl / spec.startingNavUsd) * 100,
      gridHarvestGrossUsd: summary.gridHarvestGross,
      inventoryMtmPnlUsd: summary.inventoryMtmPnl,
      feesUsd: summary.fees,
      grossBeforeFeesUsd: grossBeforeFees,
      feeDragPctOfCapital: (summary.fees / spec.startingNavUsd) * 100,
      feeShareOfGrossPct:
        grossBeforeFees > 0 ? (summary.fees / grossBeforeFees) * 100 : null,
      maxExposureUsd: summary.maxExposureUsd,
      minBufferPct: summary.minBufferPct,
      everShort: summary.everShort,
      everLiquidated: summary.everLiquidated,
      exposureCapBreached: summary.exposureCapBreached,
    };
  });

  return {
    epochStart: new Date(first).toISOString(),
    epochEnd: new Date(last).toISOString(),
    candleCount: oneMinute.length,
    durationHours: (last - first) / 3_600_000,
    marketSource,
    independentLongTransitions: state.independentLongTransitions,
    mandates,
    note:
      marketSource === "hyperliquid_public"
        ? "Backtest over already-closed public Hyperliquid 1m candles. Long-only frozen engine. No live orders."
        : "Backtest over offline synthetic candles. Labeled and excluded from promotion evidence.",
  };
}
