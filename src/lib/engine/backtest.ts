import { defaultSimConfig, runSimulation, type SimConfig } from "./simulate";
import { buildFeatures, type FeatureParams } from "./strategy";
import type { MarketSeries, MarketSource, Regime } from "./types";

export interface BacktestReport {
  epochStart: string;
  epochEnd: string;
  executionTimeframe: string;
  bars: number;
  durationDays: number;
  marketSource: MarketSource;
  requestedYears: number;
  capitalUsd: number;
  maxLeverage: number;
  startEquityUsd: number;
  finalEquityUsd: number;
  totalReturnPct: number;
  cagrPct: number;
  sharpe: number | null;
  sortino: number | null;
  annualVolPct: number;
  tStat: number | null;
  pValue: number | null;
  buyHoldReturnPct: number;
  alphaVsHoldPct: number;
  bestMonthPct: number;
  worstMonthPct: number;
  avgMonthPct: number;
  monthsAbove20: number;
  monthsCount: number;
  monthlyReturnsPct: number[];
  monthly: Array<{ month: string; returnPct: number; trades: number; endEquityUsd: number }>;
  equityCurve: Array<{ t: number; equity: number }>;
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

// Backtests the Turtle-style trend follower on the 4h execution timeframe over
// roughly a year. Features look back only at closed bars, so there is no lookahead.
export function runBacktest(
  series: MarketSeries,
  marketSource: MarketSource,
  requestedYears = 1,
  configOverride?: Partial<SimConfig>,
  featureOverride?: Partial<FeatureParams>,
): BacktestReport {
  const exec = series.fourHour;
  if (!exec.length) {
    throw new Error("no_four_hour_candles");
  }

  const features = buildFeatures(series, featureOverride);
  const cfg = { ...defaultSimConfig(), ...configOverride };
  const result = runSimulation(features, cfg);
  const first = exec[0].openTime;
  const last = exec[exec.length - 1].openTime;
  const durationDays = (last - first) / 86_400_000;
  const years = durationDays / 365;
  const growth = result.finalEquityUsd / result.startEquityUsd;
  const cagrPct = years > 0 && growth > 0 ? (growth ** (1 / years) - 1) * 100 : 0;
  const firstClose = exec[0].close;
  const lastCloseP = exec[exec.length - 1].close;
  const buyHoldReturnPct = firstClose > 0 ? (lastCloseP / firstClose - 1) * 100 : 0;

  return {
    epochStart: new Date(first).toISOString(),
    epochEnd: new Date(last).toISOString(),
    executionTimeframe: "4h",
    bars: exec.length,
    durationDays,
    marketSource,
    requestedYears,
    capitalUsd: cfg.capitalUsd,
    maxLeverage: cfg.maxLeverage,
    startEquityUsd: result.startEquityUsd,
    finalEquityUsd: result.finalEquityUsd,
    totalReturnPct: result.totalReturnPct,
    cagrPct,
    sharpe: result.sharpe,
    sortino: result.sortino,
    annualVolPct: result.annualVolPct,
    tStat: result.tStat,
    pValue: result.pValue,
    buyHoldReturnPct,
    alphaVsHoldPct: result.totalReturnPct - buyHoldReturnPct,
    bestMonthPct: result.bestMonthPct,
    worstMonthPct: result.worstMonthPct,
    avgMonthPct: result.avgMonthPct,
    monthsAbove20: result.monthsAbove20,
    monthsCount: result.monthsCount,
    monthlyReturnsPct: result.monthlyReturnsPct,
    monthly: result.monthly,
    equityCurve: result.equityCurve,
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
      marketSource === "offline_synthetic_fallback"
        ? "Offline synthetic candles. Labeled and not evidence."
        : `Turtle-style trend follower (Donchian + ATR sizing) on 4h closed ${marketSource} candles. Paper only; no live orders.`,
  };
}
