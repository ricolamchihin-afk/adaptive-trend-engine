import { usableAt } from "./candles";
import {
  adxWilder,
  atr,
  closesOf,
  emaSeries,
  highestHigh,
  lowestLow,
  macdHistogram,
  rsiWilder,
} from "./indicators";
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
  // 4h RSI (momentum) over the prior bars.
  rsi: number | null;
  // 4h MACD histogram (momentum confirmation). Positive = bullish.
  macdHist: number | null;
  // Daily trend filter: +1 above the daily EMA, -1 below, 0 unavailable.
  dailyDir: 1 | -1 | 0;
  // Daily EMA slope over the prior ~10 daily bars, in percent (regime strength).
  dailyEmaSlopePct: number | null;
}

export interface FeatureParams {
  donchianEntry: number;
  donchianExit: number;
  atrPeriod: number;
  adxPeriod: number;
  rsiPeriod: number;
  dailyEmaPeriod: number;
}

function dailyContextAt(
  series: MarketSeries,
  time: number,
  emaPeriod: number,
): { dir: 1 | -1 | 0; slopePct: number | null } {
  const daily = usableAt(series.daily, time);
  const closes = closesOf(daily);
  const emaArr = emaSeries(closes, emaPeriod);
  const last = daily[daily.length - 1];
  if (!last || !emaArr.length) {
    return { dir: 0, slopePct: null };
  }
  const ema = emaArr[emaArr.length - 1];
  const dir: 1 | -1 | 0 = last.close > ema ? 1 : -1;
  const k = 10;
  const prevIdx = emaArr.length - 1 - k;
  const slopePct =
    prevIdx >= 0 && emaArr[prevIdx] > 0 ? ((ema - emaArr[prevIdx]) / emaArr[prevIdx]) * 100 : null;
  return { dir, slopePct };
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
  const rsiPeriod = params.rsiPeriod ?? STRATEGY.rsiPeriod;
  const dailyEmaPeriod = params.dailyEmaPeriod ?? STRATEGY.dailyEmaPeriod;
  const bars = series.fourHour;
  const adxWindow = adxPeriod * 4;
  const rsiWindow = rsiPeriod * 4;

  return bars.map((candle, i) => {
    const priorEntry = bars.slice(Math.max(0, i - n), i);
    const priorExit = bars.slice(Math.max(0, i - m), i);
    const atrBars = bars.slice(Math.max(0, i - (p + 1)), i);
    const adxBars = bars.slice(Math.max(0, i - adxWindow), i);
    const rsiBars = bars.slice(Math.max(0, i - (rsiWindow + 1)), i);
    const macdBars = bars.slice(Math.max(0, i - 60), i);
    const daily = dailyContextAt(series, candle.openTime, dailyEmaPeriod);
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
      rsi: rsiWilder(rsiBars.map((c) => c.close), rsiPeriod),
      macdHist: macdHistogram(macdBars.map((c) => c.close)),
      dailyDir: daily.dir,
      dailyEmaSlopePct: daily.slopePct,
    };
  });
}
