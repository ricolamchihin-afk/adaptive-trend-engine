import { DAY_MS, FOUR_HOUR_MS } from "./candles";
import {
  fetchAsterBars,
  fetchBinanceBars,
  fetchHyperliquidBars,
  fetchYahooBars,
  resample,
} from "./feeds";
import { syntheticSeries } from "./market-data";
import type { MarketSnapshot } from "./market-data";
import type { ResolvedSymbol } from "./universe";
import type { Candle, MarketSeries, MarketSource } from "./types";

function emptySeries(daily: Candle[], fourHour: Candle[], funding: number | null = null): MarketSeries {
  return {
    daily,
    fourHour,
    oneHour: [],
    fifteen: [],
    oneMinute: [],
    nativeFundingRate: funding,
  };
}

function snapshot(
  series: MarketSeries,
  source: MarketSource,
  now: number,
  warning: string | null,
): MarketSnapshot {
  const last = series.fourHour[series.fourHour.length - 1] ?? series.daily[series.daily.length - 1] ?? null;
  return {
    series,
    source,
    fetchedAt: now,
    lastClosed1m: last,
    mark: last?.close ?? null,
    warning,
  };
}

async function loadYahooPair(ticker: string, days: number, now: number): Promise<{
  daily: Candle[];
  fourHour: Candle[];
}> {
  const dailyRange = days <= 365 ? "2y" : days <= 730 ? "5y" : "10y";
  const hourlyRange = days <= 365 ? "1y" : "2y";
  const [daily, hourly] = await Promise.all([
    fetchYahooBars(ticker, "1d", dailyRange, now),
    fetchYahooBars(ticker, "1h", hourlyRange, now),
  ]);
  return { daily, fourHour: resample(hourly, FOUR_HOUR_MS) };
}

async function loadCryptoPair(
  resolved: ResolvedSymbol,
  days: number,
  now: number,
): Promise<{ daily: Candle[]; fourHour: Candle[]; source: MarketSource }> {
  const lookback = days * DAY_MS;
  const dailyLookback = (days + 200) * DAY_MS;
  if (resolved.binanceSymbol) {
    try {
      const [daily, fourHour] = await Promise.all([
        fetchBinanceBars(resolved.binanceSymbol, "1d", dailyLookback, now),
        fetchBinanceBars(resolved.binanceSymbol, "4h", lookback, now),
      ]);
      if (daily.candles.length && fourHour.candles.length) {
        return { daily: daily.candles, fourHour: fourHour.candles, source: "binance_public" };
      }
    } catch {
      // listed-exchange miss → Hyperliquid, then Aster
    }
  }
  if (resolved.hyperliquidCoin) {
    try {
      const [daily, fourHour] = await Promise.all([
        fetchHyperliquidBars(resolved.hyperliquidCoin, "1d", DAY_MS, dailyLookback, now),
        fetchHyperliquidBars(resolved.hyperliquidCoin, "4h", FOUR_HOUR_MS, lookback, now),
      ]);
      if (daily.length && fourHour.length) {
        return { daily, fourHour, source: "hyperliquid_public" };
      }
    } catch {
      // HL miss → Aster venue
    }
  }
  const [daily, fourHour] = await Promise.all([
    fetchAsterBars(resolved.asterSymbol, "1d", dailyLookback, now),
    fetchAsterBars(resolved.asterSymbol, "4h", lookback, now),
  ]);
  return { daily, fourHour, source: "aster_public" };
}

export async function loadResolvedMarket(
  resolved: ResolvedSymbol,
  now = Date.now(),
  days = 365,
): Promise<MarketSnapshot> {
  try {
    if (resolved.assetClass === "equity" || resolved.assetClass === "commodity") {
      if (resolved.cashTicker && resolved.preferredFeed === "yahoo") {
        try {
          const { daily, fourHour } = await loadYahooPair(resolved.cashTicker, days, now);
          if (daily.length && fourHour.length) {
            return snapshot(
              emptySeries(daily, fourHour),
              "yahoo_public",
              now,
              "US/cash session bars resampled to 4h. Aster is the execution venue only.",
            );
          }
        } catch {
          // fall through to Aster venue candles
        }
      }
      const lookback = days * DAY_MS;
      const [daily, fourHour] = await Promise.all([
        fetchAsterBars(resolved.asterSymbol, "1d", (days + 200) * DAY_MS, now),
        fetchAsterBars(resolved.asterSymbol, "4h", lookback, now),
      ]);
      return snapshot(
        emptySeries(daily, fourHour),
        "aster_public",
        now,
        resolved.cashTicker
          ? "Yahoo cash feed missed; using Aster stock-perp candles."
          : "No cash ticker map; using Aster venue candles.",
      );
    }

    const crypto = await loadCryptoPair(resolved, days, now);
    return snapshot(emptySeries(crypto.daily, crypto.fourHour), crypto.source, now, null);
  } catch (error) {
    const series = syntheticSeries(now);
    return snapshot(
      series,
      "offline_synthetic_fallback",
      now,
      `Feed failed (${error instanceof Error ? error.message : "unknown"}). Synthetic candles are not evidence.`,
    );
  }
}
