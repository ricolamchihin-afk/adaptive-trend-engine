import {
  DAY_MS,
  FIFTEEN_MS,
  FOUR_HOUR_MS,
  lastUsable,
  usableAt,
} from "./candles";
import {
  adxWilder,
  bollingerWidth,
  clamp,
  closesOf,
  emaSeries,
  lastEma,
  quantile,
  rsiWilder,
  zScore,
} from "./indicators";
import { HIERARCHY_THRESHOLDS } from "./spec";
import type { Candle, HierarchyDecision, IndicatorReading, PacePct } from "./types";

export interface MarketSeries {
  daily: Candle[];
  fourHour: Candle[];
  oneHour: Candle[];
  fifteen: Candle[];
  oneMinute: Candle[];
  nativeFundingRate: number | null;
}

function reading(partial: Omit<IndicatorReading, "formatted"> & { formatted?: string }): IndicatorReading {
  return {
    ...partial,
    formatted:
      partial.formatted ??
      (partial.value === null ? "unavailable" : partial.value.toFixed(2)),
  };
}

export function extensionScoreFromParts(
  fourHourZ: number,
  fourHourRsi: number,
  oneHourRsi: number,
): number {
  const zNorm = clamp((clamp(fourHourZ, -2.5, 2.5) + 2.5) / 5, 0, 1);
  const raw = 0.45 * zNorm + 0.3 * (fourHourRsi / 100) + 0.25 * (oneHourRsi / 100);
  return clamp(raw * 100, 0, 100);
}

export function paceFromFifteen(z: number, rsi: number): PacePct {
  const t = HIERARCHY_THRESHOLDS;
  if (z <= t.paceFullZ && rsi <= t.paceFullRsi) {
    return 1;
  }
  if (z <= t.paceHalfZ && rsi <= t.paceHalfRsi) {
    return 0.5;
  }
  return 0.25;
}

export function evaluateHierarchy(
  series: MarketSeries,
  decisionTime: number,
): HierarchyDecision {
  const t = HIERARCHY_THRESHOLDS;
  const daily = usableAt(series.daily, decisionTime);
  const fourHour = usableAt(series.fourHour, decisionTime);
  const oneHour = usableAt(series.oneHour, decisionTime);
  const fifteen = usableAt(series.fifteen, decisionTime);

  const dailyCloses = closesOf(daily);
  const fourCloses = closesOf(fourHour);
  const oneCloses = closesOf(oneHour);
  const fifteenCloses = closesOf(fifteen);

  const dailyEma = lastEma(dailyCloses, t.dailyEmaPeriod);
  const lastDaily = lastUsable(series.daily, decisionTime);
  const dailyBullish =
    lastDaily && dailyEma !== null ? lastDaily.close > dailyEma : null;

  const fourEmaSeries = emaSeries(fourCloses, t.fourHourEmaPeriod);
  const fourEma = fourEmaSeries.length ? fourEmaSeries[fourEmaSeries.length - 1] : null;
  const prevFourEma =
    fourEmaSeries.length >= 2 ? fourEmaSeries[fourEmaSeries.length - 2] : null;
  const lastFour = lastUsable(series.fourHour, decisionTime);
  const fourAdx = adxWilder(
    fourHour.map((c) => c.high),
    fourHour.map((c) => c.low),
    fourCloses,
    t.fourHourAdxPeriod,
  );
  const fourHourLong =
    lastFour && fourEma !== null && prevFourEma !== null && fourAdx !== null
      ? lastFour.close > fourEma &&
        fourEma > prevFourEma &&
        fourAdx >= t.adxTrendThreshold
      : null;

  const fourHourZ = zScore(fourCloses, t.zScorePeriod);
  const fourHourRsi = rsiWilder(fourCloses, t.rsiPeriod);
  const oneHourRsi = rsiWilder(oneCloses, t.rsiPeriod);
  const oneHourBbw = bollingerWidth(oneCloses, t.bbwPeriod, t.bbwStd);
  const fifteenZ = zScore(fifteenCloses, t.zScorePeriod);
  const fifteenRsi = rsiWilder(fifteenCloses, t.rsiPeriod);

  const bbwHistory: number[] = [];
  for (let i = t.bbwPeriod; i <= oneCloses.length; i += 1) {
    const width = bollingerWidth(
      oneCloses.slice(0, i),
      t.bbwPeriod,
      t.bbwStd,
    );
    if (width !== null) {
      bbwHistory.push(width);
    }
  }
  const recentBbw = bbwHistory.slice(-t.bbwLookback);
  const bbwExtreme = quantile(recentBbw, t.bbwExtremeQuantile);
  const prevAdx =
    fourHour.length > 1
      ? adxWilder(
          fourHour.slice(0, -1).map((c) => c.high),
          fourHour.slice(0, -1).map((c) => c.low),
          fourCloses.slice(0, -1),
          t.fourHourAdxPeriod,
        )
      : null;

  let ineligibilityReason: string | null = null;
  if (!lastDaily || dailyBullish === null) {
    ineligibilityReason = "daily_context_unavailable";
  } else if (fourHourLong === null || fourAdx === null) {
    ineligibilityReason = "four_hour_direction_unavailable";
  } else if (
    fourHourZ === null ||
    fourHourRsi === null ||
    oneHourRsi === null
  ) {
    ineligibilityReason = "extension_inputs_unavailable";
  } else if (fifteenZ === null || fifteenRsi === null) {
    ineligibilityReason = "fifteen_minute_pace_unavailable";
  }

  const dataEligible = ineligibilityReason === null;

  let haltReason: string | null = null;
  if (dataEligible && dailyBullish !== null && fourHourLong !== null) {
    if (dailyBullish !== fourHourLong && fourAdx !== null && fourAdx >= t.adxTrendThreshold) {
      haltReason = "daily_4h_conflict";
    } else if (
      fourAdx !== null &&
      prevAdx !== null &&
      prevAdx >= t.adxTrendThreshold &&
      fourAdx < t.adxHaltThreshold
    ) {
      haltReason = "adx_trend_transition";
    } else if (
      oneHourBbw !== null &&
      bbwExtreme !== null &&
      oneHourBbw >= bbwExtreme &&
      fourAdx !== null &&
      prevAdx !== null &&
      fourAdx < prevAdx
    ) {
      haltReason = "bbw_expansion_with_adx_decay";
    } else if (
      fourHourRsi !== null &&
      (fourHourRsi >= t.rsiTailHigh || fourHourRsi <= t.rsiTailLow)
    ) {
      haltReason = "rsi_tail_risk";
    }
  }

  const hardHalt = haltReason !== null;
  const thesis: HierarchyDecision["thesis"] =
    dataEligible && !hardHalt && dailyBullish === true && fourHourLong === true
      ? "LONG"
      : "FLAT";

  const score =
    dataEligible && fourHourZ !== null && fourHourRsi !== null && oneHourRsi !== null
      ? extensionScoreFromParts(fourHourZ, fourHourRsi, oneHourRsi)
      : null;
  const pace =
    dataEligible && fifteenZ !== null && fifteenRsi !== null
      ? paceFromFifteen(fifteenZ, fifteenRsi)
      : null;

  const lastFifteen = lastUsable(series.fifteen, decisionTime);
  const availableAt = Math.max(
    lastDaily ? lastDaily.openTime + DAY_MS : 0,
    lastFour ? lastFour.openTime + FOUR_HOUR_MS : 0,
    lastFifteen ? lastFifteen.openTime + FIFTEEN_MS : 0,
  );

  const indicators: IndicatorReading[] = [
    reading({
      id: "daily_ema",
      name: "Daily EMA20 context",
      timeframe: "1d",
      value: dailyEma,
      threshold: "Close above EMA20 establishes bullish context",
      effect: dailyBullish ? "Supports a LONG regime" : "Blocks LONG; thesis is FLAT",
      authority: "Daily context + 4h ADX/EMA direction establish regime",
      status: dailyBullish === null ? "unavailable" : dailyBullish ? "active" : "inactive",
    }),
    reading({
      id: "four_hour_direction",
      name: "4h EMA20 slope + close",
      timeframe: "4h",
      value: fourEma,
      threshold: "Close > EMA20 and EMA rising",
      effect: fourHourLong ? "Confirms LONG direction" : "No LONG direction",
      authority: "Daily context + 4h ADX/EMA direction establish regime",
      status: fourHourLong === null ? "unavailable" : fourHourLong ? "active" : "inactive",
    }),
    reading({
      id: "four_hour_adx",
      name: "4h ADX",
      timeframe: "4h",
      value: fourAdx,
      threshold: `Trend if ADX ≥ ${t.adxTrendThreshold}; halt if ADX falls below ${t.adxHaltThreshold} after a trend`,
      effect: "Hard halt only when the joint safety rule fires",
      authority: "4h ADX + 1h BBW transition, conflict and tail risk",
      status:
        fourAdx === null
          ? "unavailable"
          : haltReason === "adx_trend_transition"
            ? "halt"
            : fourAdx >= t.adxTrendThreshold
              ? "active"
              : "inactive",
    }),
    reading({
      id: "four_hour_z",
      name: "4h close Z-score",
      timeframe: "4h",
      value: fourHourZ,
      threshold: "Clipped to ±2.5 and mapped into the 0–100 extension score",
      effect: "Higher extension lowers target notional toward the mandate floor",
      authority: "4h Z-score + directional 1h/4h RSI size the target",
      status: fourHourZ === null ? "unavailable" : "active",
    }),
    reading({
      id: "four_hour_rsi",
      name: "4h RSI",
      timeframe: "4h",
      value: fourHourRsi,
      threshold: `Tail halt outside ${t.rsiTailLow}–${t.rsiTailHigh}`,
      effect: "Feeds extension score; extreme values are a hard halt",
      authority: "4h Z-score + directional 1h/4h RSI size the target",
      status:
        fourHourRsi === null
          ? "unavailable"
          : haltReason === "rsi_tail_risk"
            ? "halt"
            : "active",
    }),
    reading({
      id: "one_hour_rsi",
      name: "1h RSI",
      timeframe: "1h",
      value: oneHourRsi,
      threshold: "Directional RSI contributes 25% of the extension score",
      effect: "Stretched 1h RSI reduces Conservative size toward the 25% floor",
      authority: "4h Z-score + directional 1h/4h RSI size the target",
      status: oneHourRsi === null ? "unavailable" : "active",
    }),
    reading({
      id: "one_hour_bbw",
      name: "1h Bollinger bandwidth",
      timeframe: "1h",
      value: oneHourBbw,
      formatted: oneHourBbw === null ? "unavailable" : oneHourBbw.toFixed(4),
      threshold: `Extreme if at/above the ${Math.round(t.bbwExtremeQuantile * 100)}th percentile of the last ${t.bbwLookback} closed 1h widths`,
      effect: "Hard halt only when BBW is extreme and 4h ADX is decaying",
      authority: "4h ADX + 1h BBW transition, conflict and tail risk",
      status:
        oneHourBbw === null
          ? "unavailable"
          : haltReason === "bbw_expansion_with_adx_decay"
            ? "halt"
            : "active",
    }),
    reading({
      id: "fifteen_z",
      name: "15m Z-score",
      timeframe: "15m",
      value: fifteenZ,
      threshold: `100% pace if Z ≤ ${t.paceFullZ}; 50% if Z ≤ ${t.paceHalfZ}; else 25%`,
      effect: "Sets immediate deployment pace only. Cannot flatten an eligible LONG.",
      authority: "15m Z-score + 15m RSI set 100% / 50% / 25% pace",
      status: fifteenZ === null ? "unavailable" : "active",
    }),
    reading({
      id: "fifteen_rsi",
      name: "15m RSI",
      timeframe: "15m",
      value: fifteenRsi,
      threshold: `100% pace if RSI ≤ ${t.paceFullRsi}; 50% if RSI ≤ ${t.paceHalfRsi}; else 25%`,
      effect: "Sets immediate deployment pace only. Cannot flatten an eligible LONG.",
      authority: "15m Z-score + 15m RSI set 100% / 50% / 25% pace",
      status: fifteenRsi === null ? "unavailable" : "active",
    }),
    reading({
      id: "funding",
      name: "Native funding (display only)",
      timeframe: "8h",
      value: series.nativeFundingRate,
      formatted:
        series.nativeFundingRate === null
          ? "placeholder / unsourced"
          : `${(series.nativeFundingRate * 100).toFixed(4)}%`,
      threshold: "Not applied. Funding remains a zero P&L placeholder.",
      effect: "Shown for soak preparation; does not change score, pace, or P&L",
      authority: "Native funding is sourced when available and never silently substituted into P&L",
      status: "inactive",
    }),
  ];

  let explanation: string;
  if (!dataEligible) {
    explanation = `Hierarchy is ineligible: ${ineligibilityReason}. Soft 15m evidence cannot create a position. The books stay flat or flatten if they were long.`;
  } else if (hardHalt) {
    explanation = `Hard halt (${haltReason}). Daily/4h conflict, transition, or tail risk flattens every mandate. 15m pace is not consulted.`;
  } else if (thesis === "LONG") {
    explanation = `Eligible daily/4h evidence is LONG. Extension score ${score?.toFixed(1)} sets Conservative target between the 25% floor and 100% of the $1,600 research notional. 15m pace ${(pace ?? 0) * 100}% deploys that target immediately; the persistent pullback grid handles the balance. Soft extension cannot flatten this LONG.`;
  } else {
    explanation =
      "Daily context or 4h direction is not LONG. Opening shorts remain prohibited, so the thesis is FLAT and any inventory is reduced.";
  }

  return {
    decisionTime,
    availableAt,
    thesis,
    hardHalt,
    haltReason,
    dataEligible,
    ineligibilityReason,
    extensionScore: score,
    pace,
    dailyBullish,
    fourHourLong,
    fourHourAdx: fourAdx,
    fourHourZ,
    fourHourRsi,
    oneHourRsi,
    oneHourBbw,
    fifteenZ,
    fifteenRsi,
    nativeFundingRate: series.nativeFundingRate,
    fundingApplied: false,
    indicators,
    explanation,
  };
}

export function nextActionOpenTime(availableAt: number): number {
  return Math.ceil(availableAt / FIFTEEN_MS) * FIFTEEN_MS === availableAt
    ? availableAt
    : Math.ceil(availableAt / 60_000) * 60_000;
}

export function isFifteenDecisionBoundary(openTime: number): boolean {
  return openTime % FIFTEEN_MS === 0;
}

export function decisionTimeForActionBar(openTime: number): number {
  return openTime;
}
