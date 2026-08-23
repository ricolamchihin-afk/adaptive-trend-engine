import { usableAt } from "./candles";
import { adxWilder, atr, closesOf, highestHigh, lastEma, lowestLow } from "./indicators";
import { STRATEGY } from "./spec";
import type { Candle, MarketSeries } from "./types";

export interface Feature {
  candle: Candle;
  // Donchian entry channel (highest high / lowest low of the prior N bars).
  entryHigh: number | null;
  entryLow: number | null;
  // Donchian exit channel (prior M bars) used as the trailing stop.
  exitHigh: number | null;
  exitLow: number | null;
  atr: number | null;
  // 4h ADX (trend strength) over the prior bars.
  adx: number | null;
  // Daily trend filter: +1 above the daily EMA, -1 below, 0 unavailable.
  dailyDir: 1 | -1 | 0;
}

export interface FeatureParams {
  donchianEntry: number;
  donchianExit: number;
  atrPeriod: number;
  adxPeriod: number;
  dailyEmaPeriod: number;
}

function dailyDirAt(series: MarketSeries, time: number, emaPeriod: number): 1 | -1 | 0 {
  const daily = usableAt(series.daily, time);
  const closes = closesOf(daily);
  const ema = lastEma(closes, emaPeriod);
  const last = daily[daily.length - 1];
  if (!last || ema === null) {
    return 0;
  }
  return last.close > ema ? 1 : -1;
}

// Precomputes trend-following features on the 4h series using only closed bars
// strictly before each bar (Donchian and ATR look back, never at the current bar).
export function buildFeatures(
  series: MarketSeries,
  params: Partial<FeatureParams> = {},
): Feature[] {
  const n = params.donchianEntry ?? STRATEGY.donchianEntry;
  const m = params.donchianExit ?? STRATEGY.donchianExit;
  const p = params.atrPeriod ?? STRATEGY.atrPeriod;
  const adxPeriod = params.adxPeriod ?? STRATEGY.adxPeriod;
  const dailyEmaPeriod = params.dailyEmaPeriod ?? STRATEGY.dailyEmaPeriod;
  const bars = series.fourHour;
  const adxWindow = adxPeriod * 4;

  return bars.map((candle, i) => {
    const priorEntry = bars.slice(Math.max(0, i - n), i);
    const priorExit = bars.slice(Math.max(0, i - m), i);
    const atrBars = bars.slice(Math.max(0, i - (p + 1)), i);
    const adxBars = bars.slice(Math.max(0, i - adxWindow), i);
    const haveEntry = i >= n;
    const haveExit = i >= m;
    return {
      candle,
      entryHigh: haveEntry ? highestHigh(priorEntry.map((c) => c.high)) : null,
      entryLow: haveEntry ? lowestLow(priorEntry.map((c) => c.low)) : null,
      exitHigh: haveExit ? highestHigh(priorExit.map((c) => c.high)) : null,
      exitLow: haveExit ? lowestLow(priorExit.map((c) => c.low)) : null,
      atr:
        atrBars.length >= p + 1
          ? atr(
              atrBars.map((c) => c.high),
              atrBars.map((c) => c.low),
              atrBars.map((c) => c.close),
              p,
            )
          : null,
      adx: adxWilder(
        adxBars.map((c) => c.high),
        adxBars.map((c) => c.low),
        adxBars.map((c) => c.close),
        adxPeriod,
      ),
      dailyDir: dailyDirAt(series, candle.openTime, dailyEmaPeriod),
    };
  });
}
