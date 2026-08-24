import { STRATEGY, venueFeeRate } from "./spec";
import type { Feature } from "./strategy";
import type { Regime } from "./types";

export interface SimConfig {
  capitalUsd: number;
  maxLeverage: number;
  takerRate: number;
  riskPct: number;
  atrStopMult: number;
  liquidationPct: number;
  adxThreshold: number;
  rsiLongMin: number;
  rsiShortMax: number;
  // Fixed take-profit in ROE % of the equity at entry. 0 disables it (let winners run).
  takeProfitRoePct: number;
  // Dynamic take-profit scaled by trend strength: TP% = tpAdxFactor * ADX(at entry),
  // clamped to [tpMinRoePct, tpMaxRoePct]. 0 factor = use the fixed take-profit above.
  tpAdxFactor: number;
  tpMinRoePct: number;
  tpMaxRoePct: number;
  // Optional confirmation filters (0/off by default).
  macdFilter: number; // 1 = require MACD histogram to agree with the trade side
  emaSlopeMinPct: number; // require |daily EMA slope| >= this (0 = off)
}

// 4h bars per year, for annualizing the Sharpe ratio.
const PERIODS_PER_YEAR = 6 * 365;

// Standard normal CDF (Abramowitz-Stegun 7.1.26) for an approximate p-value.
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export function defaultSimConfig(): SimConfig {
  return {
    capitalUsd: STRATEGY.capitalUsd,
    maxLeverage: STRATEGY.maxLeverage,
    takerRate: venueFeeRate("taker"),
    riskPct: STRATEGY.riskPct,
    atrStopMult: STRATEGY.atrStopMult,
    liquidationPct: STRATEGY.liquidationPct,
    adxThreshold: STRATEGY.adxThreshold,
    rsiLongMin: STRATEGY.rsiLongMin,
    rsiShortMax: STRATEGY.rsiShortMax,
    takeProfitRoePct: STRATEGY.takeProfitRoePct,
    tpAdxFactor: STRATEGY.tpAdxFactor,
    tpMinRoePct: STRATEGY.tpMinRoePct,
    tpMaxRoePct: STRATEGY.tpMaxRoePct,
    macdFilter: STRATEGY.macdFilter,
    emaSlopeMinPct: STRATEGY.emaSlopeMinPct,
  };
}

export interface SimResult {
  startEquityUsd: number;
  finalEquityUsd: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  sharpe: number | null;
  sortino: number | null;
  annualVolPct: number;
  // Null-hypothesis test H0: mean per-bar return = 0. t-stat and one-sided p-value.
  tStat: number | null;
  pValue: number | null;
  monthlyReturnsPct: number[];
  bestMonthPct: number;
  worstMonthPct: number;
  avgMonthPct: number;
  monthsAbove20: number;
  monthsCount: number;
  monthly: Array<{ month: string; returnPct: number; trades: number; endEquityUsd: number }>;
  equityCurve: Array<{ t: number; equity: number }>;
  // Full 4h mark-to-market path (not downsampled). Used for portfolio overlay.
  equityBars: Array<{ t: number; equity: number }>;
  feesUsd: number;
  perRegimePnlUsd: Record<Regime, number>;
  barsInRegime: Record<Regime, number>;
  liquidations: number;
  everLiquidated: boolean;
  everShort: boolean;
  blownUp: boolean;
  finalSide: Regime;
  finalEntry: number | null;
  finalStop: number | null;
  finalSizeBtc: number;
  finalLeverage: number;
}

// Turtle-style trend follower: Donchian breakout entries filtered by the daily
// trend, an ATR initial stop that trails up via the shorter Donchian channel, and
// ATR volatility sizing so each loss is ~riskPct of equity. Winners run to the
// opposite breakout. Equity is realized cash; open exposure is marked for
// drawdown and flattened at the end so the result reconciles.
export function runSimulation(features: Feature[], cfg: SimConfig): SimResult {
  let equity = cfg.capitalUsd;
  let posBtc = 0;
  let entry = 0;
  let stopPrice = 0;
  let entryEquity = cfg.capitalUsd;
  let entryAdx = 0;

  let feesUsd = 0;
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let liquidations = 0;
  let everLiquidated = false;
  let everShort = false;
  let blownUp = false;

  const perRegime: Record<Regime, number> = { LONG: 0, SHORT: 0, GRID: 0, FLAT: 0 };
  const barsInRegime: Record<Regime, number> = { LONG: 0, SHORT: 0, GRID: 0, FLAT: 0 };
  let currentBarMonth = "";
  const monthTrades = new Map<string, number>();

  let peakEquity = equity;
  let maxDrawdownPct = 0;
  let lastClose = cfg.capitalUsd;
  const equityCurve: number[] = [equity];
  const curveTimes: number[] = [features[0]?.candle.openTime ?? 0];

  function delta(amount: number, regime: Regime) {
    equity += amount;
    perRegime[regime] += amount;
  }

  function closeAt(price: number, regime: Regime, liquidation = false) {
    if (posBtc === 0) return;
    const pnl = posBtc * (price - entry);
    const fee = Math.abs(posBtc * price) * cfg.takerRate;
    delta(pnl, regime);
    delta(-fee, regime);
    feesUsd += fee;
    trades += 1;
    if (pnl > 0) wins += 1;
    else if (pnl < 0) losses += 1;
    monthTrades.set(currentBarMonth, (monthTrades.get(currentBarMonth) ?? 0) + 1);
    if (liquidation) {
      liquidations += 1;
      everLiquidated = true;
    }
    posBtc = 0;
    entry = 0;
    stopPrice = 0;
  }

  function open(sign: 1 | -1, fill: number, atr: number, regime: Regime) {
    if (equity <= 0 || atr <= 0) {
      return;
    }
    const stopDist = cfg.atrStopMult * atr;
    const maxSize = (equity * cfg.maxLeverage) / fill;
    let sizeBtc = (equity * cfg.riskPct) / stopDist;
    if (sizeBtc > maxSize) sizeBtc = maxSize;
    if (sizeBtc <= 0) return;
    const fee = sizeBtc * fill * cfg.takerRate;
    delta(-fee, regime);
    feesUsd += fee;
    posBtc = sign * sizeBtc;
    entry = fill;
    entryEquity = equity;
    stopPrice = sign > 0 ? fill - stopDist : fill + stopDist;
    if (sign < 0) everShort = true;
  }

  for (const f of features) {
    const candle = f.candle;
    lastClose = candle.close;
    currentBarMonth = new Date(candle.openTime).toISOString().slice(0, 7);
    if (blownUp) {
      barsInRegime.FLAT += 1;
      continue;
    }

    // Take-profit ROE target: dynamic (scaled by trend strength / ADX at entry) when
    // tpAdxFactor > 0, otherwise the fixed take-profit. tpPrice solves
    // pnl / entryEquity == effTpRoe.
    const effTpRoe =
      cfg.tpAdxFactor > 0
        ? Math.min(cfg.tpMaxRoePct, Math.max(cfg.tpMinRoePct, cfg.tpAdxFactor * entryAdx))
        : cfg.takeProfitRoePct;
    const tpEnabled = effTpRoe > 0 && posBtc !== 0;
    const tpPrice = tpEnabled ? entry + ((effTpRoe / 100) * entryEquity) / posBtc : NaN;

    let justExited = false;
    if (posBtc > 0) {
      if (f.exitLow !== null) stopPrice = Math.max(stopPrice, f.exitLow);
      const liq = entry * (1 - cfg.liquidationPct);
      if (candle.open <= liq) {
        closeAt(candle.open, "LONG", true);
        justExited = true;
      } else if (candle.low <= stopPrice) {
        const fill = candle.open < stopPrice ? candle.open : stopPrice;
        closeAt(fill, "LONG", fill <= liq);
        justExited = true;
      } else if (tpEnabled && candle.high >= tpPrice) {
        closeAt(candle.open > tpPrice ? candle.open : tpPrice, "LONG");
        justExited = true;
      }
    } else if (posBtc < 0) {
      if (f.exitHigh !== null) stopPrice = Math.min(stopPrice, f.exitHigh);
      const liq = entry * (1 + cfg.liquidationPct);
      if (candle.open >= liq) {
        closeAt(candle.open, "SHORT", true);
        justExited = true;
      } else if (candle.high >= stopPrice) {
        const fill = candle.open > stopPrice ? candle.open : stopPrice;
        closeAt(fill, "SHORT", fill >= liq);
        justExited = true;
      } else if (tpEnabled && candle.low <= tpPrice) {
        closeAt(candle.open < tpPrice ? candle.open : tpPrice, "SHORT");
        justExited = true;
      }
    }

    const trendStrong = f.adx !== null && f.adx >= cfg.adxThreshold;
    const rsiOkLong = cfg.rsiLongMin <= 0 || (f.rsi !== null && f.rsi >= cfg.rsiLongMin);
    const rsiOkShort = cfg.rsiShortMax >= 100 || (f.rsi !== null && f.rsi <= cfg.rsiShortMax);
    const macdOkLong = cfg.macdFilter < 1 || (f.macdHist !== null && f.macdHist > 0);
    const macdOkShort = cfg.macdFilter < 1 || (f.macdHist !== null && f.macdHist < 0);
    const slopeOkLong =
      cfg.emaSlopeMinPct <= 0 || (f.dailyEmaSlopePct !== null && f.dailyEmaSlopePct >= cfg.emaSlopeMinPct);
    const slopeOkShort =
      cfg.emaSlopeMinPct <= 0 || (f.dailyEmaSlopePct !== null && f.dailyEmaSlopePct <= -cfg.emaSlopeMinPct);
    if (posBtc === 0 && !justExited && trendStrong && f.atr !== null && f.atr > 0) {
      if (f.dailyDir > 0 && rsiOkLong && macdOkLong && slopeOkLong && f.entryHigh !== null && candle.high >= f.entryHigh) {
        open(1, Math.max(candle.open, f.entryHigh), f.atr, "LONG");
        entryAdx = f.adx ?? 0;
      } else if (f.dailyDir < 0 && rsiOkShort && macdOkShort && slopeOkShort && f.entryLow !== null && candle.low <= f.entryLow) {
        open(-1, Math.min(candle.open, f.entryLow), f.atr, "SHORT");
        entryAdx = f.adx ?? 0;
      }
    }

    if (equity <= 0) {
      blownUp = true;
      equity = Math.max(0, equity);
    }

    barsInRegime[posBtc > 0 ? "LONG" : posBtc < 0 ? "SHORT" : "FLAT"] += 1;
    const mark = equity + posBtc * (candle.close - entry);
    equityCurve.push(mark);
    curveTimes.push(candle.openTime);
    peakEquity = Math.max(peakEquity, mark);
    if (peakEquity > 0) {
      maxDrawdownPct = Math.max(maxDrawdownPct, ((peakEquity - mark) / peakEquity) * 100);
    }
  }

  // Annualized Sharpe from per-bar equity returns (risk-free rate assumed 0).
  const rets: number[] = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    if (equityCurve[i - 1] > 0) {
      rets.push(equityCurve[i] / equityCurve[i - 1] - 1);
    }
  }
  const meanRet = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
  const variance = rets.length
    ? rets.reduce((s, r) => s + (r - meanRet) ** 2, 0) / rets.length
    : 0;
  const sd = Math.sqrt(variance);
  const sharpe = sd > 0 ? (meanRet / sd) * Math.sqrt(PERIODS_PER_YEAR) : null;
  const annualVolPct = sd * Math.sqrt(PERIODS_PER_YEAR) * 100;

  // Sortino: annualized mean over downside deviation (only negative returns).
  const downside = rets.filter((r) => r < 0);
  const downVar = downside.length
    ? downside.reduce((s, r) => s + r * r, 0) / rets.length
    : 0;
  const downSd = Math.sqrt(downVar);
  const sortino = downSd > 0 ? (meanRet / downSd) * Math.sqrt(PERIODS_PER_YEAR) : null;

  // Null hypothesis H0: mean per-bar return = 0. Two-sided-ish one-sided p-value via
  // a normal approximation of the t-statistic.
  const tStat = sd > 0 && rets.length > 1 ? meanRet / (sd / Math.sqrt(rets.length)) : null;
  const pValue = tStat === null ? null : 1 - normalCdf(tStat);

  // Calendar-month returns from the equity curve (chained month-end equity).
  const monthEnd = new Map<string, number>();
  const monthOrder: string[] = [];
  for (let i = 0; i < equityCurve.length; i += 1) {
    const key = new Date(curveTimes[i]).toISOString().slice(0, 7);
    if (!monthEnd.has(key)) monthOrder.push(key);
    monthEnd.set(key, equityCurve[i]);
  }
  const monthlyReturnsPct: number[] = [];
  let prevMonthEquity = cfg.capitalUsd;
  for (const key of monthOrder) {
    const end = monthEnd.get(key) as number;
    if (prevMonthEquity > 0) {
      monthlyReturnsPct.push((end / prevMonthEquity - 1) * 100);
    }
    prevMonthEquity = end;
  }
  const monthly = monthOrder.map((key, i) => ({
    month: key,
    returnPct: monthlyReturnsPct[i] ?? 0,
    trades: monthTrades.get(key) ?? 0,
    endEquityUsd: monthEnd.get(key) as number,
  }));

  // Downsample the per-bar equity curve for charting (cap at ~360 points).
  const maxPoints = 360;
  const step = Math.max(1, Math.ceil(equityCurve.length / maxPoints));
  const curve: Array<{ t: number; equity: number }> = [];
  for (let i = 0; i < equityCurve.length; i += step) {
    curve.push({ t: curveTimes[i], equity: equityCurve[i] });
  }
  const lastIdx = equityCurve.length - 1;
  if (lastIdx >= 0 && curve[curve.length - 1]?.t !== curveTimes[lastIdx]) {
    curve.push({ t: curveTimes[lastIdx], equity: equityCurve[lastIdx] });
  }

  const bestMonthPct = monthlyReturnsPct.length ? Math.max(...monthlyReturnsPct) : 0;
  const worstMonthPct = monthlyReturnsPct.length ? Math.min(...monthlyReturnsPct) : 0;
  const avgMonthPct = monthlyReturnsPct.length
    ? monthlyReturnsPct.reduce((s, r) => s + r, 0) / monthlyReturnsPct.length
    : 0;
  const monthsAbove20 = monthlyReturnsPct.filter((r) => r >= 20).length;

  const finalSide: Regime = posBtc > 0 ? "LONG" : posBtc < 0 ? "SHORT" : "FLAT";
  const finalEntry = posBtc !== 0 ? entry : null;
  const finalStop = posBtc !== 0 ? stopPrice : null;
  const finalSizeBtc = posBtc;
  const finalLeverage = equity > 0 ? Math.abs(posBtc * lastClose) / equity : 0;

  if (posBtc !== 0 && !blownUp) {
    closeAt(lastClose, finalSide);
  }

  const closedTrades = wins + losses;
  return {
    startEquityUsd: cfg.capitalUsd,
    finalEquityUsd: equity,
    totalReturnPct: ((equity - cfg.capitalUsd) / cfg.capitalUsd) * 100,
    maxDrawdownPct,
    trades,
    wins,
    losses,
    winRatePct: closedTrades > 0 ? (wins / closedTrades) * 100 : null,
    sharpe,
    sortino,
    annualVolPct,
    tStat,
    pValue,
    monthlyReturnsPct,
    bestMonthPct,
    worstMonthPct,
    avgMonthPct,
    monthsAbove20,
    monthsCount: monthlyReturnsPct.length,
    monthly,
    equityCurve: curve,
    equityBars: curveTimes.map((t, i) => ({ t, equity: equityCurve[i] })),
    feesUsd,
    perRegimePnlUsd: perRegime,
    barsInRegime,
    liquidations,
    everLiquidated,
    everShort,
    blownUp,
    finalSide,
    finalEntry,
    finalStop,
    finalSizeBtc,
    finalLeverage,
  };
}
