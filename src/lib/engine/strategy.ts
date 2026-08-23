import { usableAt } from "./candles";
import {
  adxWilder,
  closesOf,
  emaSeries,
  lastEma,
  rsiWilder,
} from "./indicators";
import { STRATEGY } from "./spec";
import type { MarketSeries, RegimeDecision, RegimeReading } from "./types";

// Classifies the regime from the daily + 4h trend context at a decision time.
// Uses only candles that closed at or before decisionTime (no lookahead).
export function classifyRegime(
  series: MarketSeries,
  decisionTime: number,
): RegimeDecision {
  const s = STRATEGY;
  const daily = usableAt(series.daily, decisionTime);
  const fourHour = usableAt(series.fourHour, decisionTime);
  const dailyCloses = closesOf(daily);
  const fourCloses = closesOf(fourHour);

  const dailyEma = lastEma(dailyCloses, s.dailyEmaPeriod);
  const lastDaily = daily[daily.length - 1];
  const dailyBullish =
    lastDaily && dailyEma !== null ? lastDaily.close > dailyEma : null;

  const fourEmaSeries = emaSeries(fourCloses, s.fourHourEmaPeriod);
  const fourEma = fourEmaSeries.length ? fourEmaSeries[fourEmaSeries.length - 1] : null;
  const prevFourEma =
    fourEmaSeries.length >= 2 ? fourEmaSeries[fourEmaSeries.length - 2] : null;
  const lastFour = fourHour[fourHour.length - 1];
  const fourAdx = adxWilder(
    fourHour.map((c) => c.high),
    fourHour.map((c) => c.low),
    fourCloses,
    s.fourHourAdxPeriod,
  );
  const fourRsi = rsiWilder(fourCloses, s.rsiPeriod);

  const canDirect =
    lastFour && fourEma !== null && prevFourEma !== null;
  const fourHourUp = canDirect
    ? lastFour.close > fourEma && fourEma > prevFourEma
    : null;
  const fourHourDown = canDirect
    ? lastFour.close < fourEma && fourEma < prevFourEma
    : null;

  const eligible =
    dailyBullish !== null &&
    fourHourUp !== null &&
    fourAdx !== null &&
    fourRsi !== null;
  const trending = fourAdx !== null && fourAdx >= s.adxTrendThreshold;

  let regime: RegimeDecision["regime"];
  let reason: string;
  if (!eligible) {
    regime = "FLAT";
    reason = "context_unavailable";
  } else if (fourRsi! >= s.rsiTailHigh || fourRsi! <= s.rsiTailLow) {
    regime = "FLAT";
    reason = "rsi_tail_risk";
  } else if (trending && dailyBullish === true && fourHourUp === true) {
    regime = "LONG";
    reason = "daily_and_4h_trending_up";
  } else if (trending && dailyBullish === false && fourHourDown === true) {
    regime = "SHORT";
    reason = "daily_and_4h_trending_down";
  } else if (!trending) {
    regime = "GRID";
    reason = "ranging_no_trend";
  } else {
    regime = "FLAT";
    reason = "trend_conflict";
  }

  const readings: RegimeReading[] = [
    {
      id: "daily_ema",
      name: "Daily EMA20 context",
      timeframe: "1d",
      formatted: dailyBullish === null ? "unavailable" : dailyBullish ? "above" : "below",
      effect: "Sets the directional bias (bull -> long side, bear -> short side).",
    },
    {
      id: "four_hour_dir",
      name: "4h EMA20 slope + close",
      timeframe: "4h",
      formatted:
        fourHourUp === null ? "unavailable" : fourHourUp ? "up" : fourHourDown ? "down" : "flat",
      effect: "Confirms the 4h trend direction that must agree with the daily bias.",
    },
    {
      id: "four_hour_adx",
      name: "4h ADX",
      timeframe: "4h",
      formatted: fourAdx === null ? "unavailable" : fourAdx.toFixed(1),
      effect: `Trend if >= ${s.adxTrendThreshold}; otherwise the market is ranging and the grid runs.`,
    },
    {
      id: "four_hour_rsi",
      name: "4h RSI",
      timeframe: "4h",
      formatted: fourRsi === null ? "unavailable" : fourRsi.toFixed(1),
      effect: `Tail halt outside ${s.rsiTailLow}-${s.rsiTailHigh}; the book goes flat.`,
    },
  ];

  return {
    decisionTime,
    regime,
    reason,
    dailyBullish,
    fourHourUp,
    fourHourDown,
    fourHourAdx: fourAdx,
    fourHourRsi: fourRsi,
    trending,
    eligible,
    readings,
  };
}
