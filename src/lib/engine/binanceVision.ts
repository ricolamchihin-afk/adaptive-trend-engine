import { DAY_MS, FOUR_HOUR_MS, closedOnly, fillIntervalGaps, parseBinanceKlines } from "./candles";
import type { Candle, MarketSeries } from "./types";

const VISION_KLINES = "https://data-api.binance.vision/api/v3/klines";
const PAGE = 1000;
const BTCUSDT_LISTED = Date.UTC(2017, 7, 17, 4, 0, 0);

const cache = globalThis as typeof globalThis & {
  __binanceSpotResearch?: { fetchedAt: number; series: MarketSeries };
};

async function fetchKlinePage(interval: string, startTime: number, endTime: number): Promise<unknown> {
  const url = `${VISION_KLINES}?symbol=BTCUSDT&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${PAGE}`;
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`binance_vision_http_${response.status}`);
  }
  return response.json();
}

async function fetchAllKlines(interval: string, intervalMs: number, startTime: number, now: number): Promise<Candle[]> {
  const chunks: Candle[] = [];
  let cursor = startTime;
  for (let i = 0; i < 80; i += 1) {
    const raw = await fetchKlinePage(interval, cursor, now);
    const page = parseBinanceKlines(raw, intervalMs);
    if (!page.length) break;
    chunks.push(...page);
    const lastOpen = page[page.length - 1].openTime;
    if (page.length < PAGE || lastOpen + intervalMs >= now) break;
    cursor = lastOpen + intervalMs;
  }
  const byOpen = new Map<number, Candle>();
  for (const c of chunks) byOpen.set(c.openTime, c);
  const merged = [...byOpen.values()].sort((a, b) => a.openTime - b.openTime);
  return fillIntervalGaps(closedOnly(merged, now), intervalMs);
}

export async function loadBinanceSpotResearch(now = Date.now()): Promise<MarketSeries> {
  const hit = cache.__binanceSpotResearch;
  if (hit && now - hit.fetchedAt < 10 * 60_000) {
    return hit.series;
  }
  const [daily, fourHour] = await Promise.all([
    fetchAllKlines("1d", DAY_MS, BTCUSDT_LISTED, now),
    fetchAllKlines("4h", FOUR_HOUR_MS, BTCUSDT_LISTED, now),
  ]);
  const series: MarketSeries = {
    daily,
    fourHour,
    oneHour: [],
    fifteen: [],
    oneMinute: [],
    nativeFundingRate: null,
  };
  cache.__binanceSpotResearch = { fetchedAt: now, series };
  return series;
}
