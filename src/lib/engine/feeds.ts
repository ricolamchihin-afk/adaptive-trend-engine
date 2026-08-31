import {
  DAY_MS,
  FOUR_HOUR_MS,
  HOUR_MS,
  closedOnly,
  makeCandle,
  parseHyperliquidCandles,
} from "./candles";
import type { Candle, MarketSource } from "./types";

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";
const BINANCE = ["https://api.binance.com", "https://api.binance.us"];
const ASTER = "https://fapi.asterdex.com";
const HL_INFO = "https://api.hyperliquid.xyz/info";
const UA = "AdaptiveTrendEngine/0.9 (research; paper-only)";

export function parseBinanceKlines(raw: unknown, intervalMs: number): Candle[] {
  if (!Array.isArray(raw)) {
    throw new Error("kline_payload_not_array");
  }
  const candles: Candle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) {
      throw new Error("kline_row_invalid");
    }
    const openTime = Number(row[0]);
    candles.push(
      makeCandle({
        openTime,
        intervalMs,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      }),
    );
  }
  candles.sort((a, b) => a.openTime - b.openTime);
  return candles;
}

export function parseYahooChart(raw: unknown, intervalMs: number): Candle[] {
  const chart = raw as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<Record<string, Array<number | null>>> };
      }>;
      error?: { description?: string };
    };
  };
  const result = chart.chart?.result?.[0];
  if (!result?.timestamp?.length) {
    throw new Error(chart.chart?.error?.description ?? "yahoo_empty");
  }
  const quote = result.indicators?.quote?.[0];
  if (!quote) {
    throw new Error("yahoo_quote_missing");
  }
  const candles: Candle[] = [];
  for (let i = 0; i < result.timestamp.length; i += 1) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    if (
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      ![open, high, low, close].every((value) => Number.isFinite(value))
    ) {
      continue;
    }
    candles.push(
      makeCandle({
        openTime: result.timestamp[i] * 1000,
        intervalMs,
        open,
        high,
        low,
        close,
        volume: Number(quote.volume?.[i] ?? 0),
      }),
    );
  }
  return candles;
}

// Calendar-bucket resample. For US cash hours this yields ~1–2 4h bars per session.
export function resample(candles: Candle[], intervalMs: number): Candle[] {
  const buckets = new Map<number, Candle[]>();
  for (const candle of candles) {
    const key = Math.floor(candle.openTime / intervalMs) * intervalMs;
    const list = buckets.get(key);
    if (list) list.push(candle);
    else buckets.set(key, [candle]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([openTime, rows]) =>
      makeCandle({
        openTime,
        intervalMs,
        open: rows[0].open,
        high: Math.max(...rows.map((row) => row.high)),
        low: Math.min(...rows.map((row) => row.low)),
        close: rows[rows.length - 1].close,
        volume: rows.reduce((sum, row) => sum + row.volume, 0),
      }),
    );
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`http_${response.status}`);
  }
  return response.json();
}

export async function fetchYahooBars(
  ticker: string,
  interval: "1d" | "1h",
  range: string,
  now: number,
): Promise<Candle[]> {
  const intervalMs = interval === "1d" ? DAY_MS : HOUR_MS;
  const url = `${YAHOO}/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}&includePrePost=false`;
  const candles = parseYahooChart(await getJson(url), intervalMs);
  return closedOnly(candles, now);
}

async function fetchKlinePages(
  urlFor: (startTime: number) => string,
  intervalMs: number,
  startTime: number,
  now: number,
  pageLimit: number,
): Promise<Candle[]> {
  const all: Candle[] = [];
  let cursor = startTime;
  // ponytail: 10 pages × 1000 4h bars ≈ 4.5y. Raise the cap if the lookback grows.
  for (let page = 0; page < 10; page += 1) {
    const batch = parseBinanceKlines(await getJson(urlFor(cursor)), intervalMs);
    if (!batch.length) break;
    all.push(...batch);
    const lastOpen = batch[batch.length - 1].openTime;
    if (batch.length < pageLimit || lastOpen + intervalMs >= now) break;
    cursor = lastOpen + intervalMs;
  }
  const seen = new Set<number>();
  const unique = all.filter((candle) => {
    if (seen.has(candle.openTime)) return false;
    seen.add(candle.openTime);
    return true;
  });
  unique.sort((a, b) => a.openTime - b.openTime);
  return closedOnly(unique, now);
}

async function fetchBinanceHost(
  host: string,
  symbol: string,
  interval: string,
  intervalMs: number,
  startTime: number,
  now: number,
): Promise<Candle[]> {
  return fetchKlinePages(
    (cursor) =>
      `${host}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${cursor}&endTime=${now}&limit=1000`,
    intervalMs,
    startTime,
    now,
    1000,
  );
}

export async function fetchBinanceBars(
  symbol: string,
  interval: "1d" | "4h",
  lookbackMs: number,
  now: number,
): Promise<{ candles: Candle[]; source: MarketSource }> {
  const intervalMs = interval === "1d" ? DAY_MS : FOUR_HOUR_MS;
  const startTime = now - lookbackMs;
  let lastError: unknown;
  for (const host of BINANCE) {
    try {
      const candles = await fetchBinanceHost(host, symbol, interval, intervalMs, startTime, now);
      if (candles.length) {
        return { candles, source: "binance_public" };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("binance_failed");
}

export async function fetchAsterBars(
  symbol: string,
  interval: "1d" | "4h",
  lookbackMs: number,
  now: number,
): Promise<Candle[]> {
  const intervalMs = interval === "1d" ? DAY_MS : FOUR_HOUR_MS;
  return fetchKlinePages(
    (cursor) =>
      `${ASTER}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${cursor}&endTime=${now}&limit=1500`,
    intervalMs,
    now - lookbackMs,
    now,
    1500,
  );
}

export async function fetchHyperliquidBars(
  coin: string,
  interval: string,
  intervalMs: number,
  lookbackMs: number,
  now: number,
): Promise<Candle[]> {
  const response = await fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin, interval, startTime: now - lookbackMs, endTime: now },
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`hyperliquid_http_${response.status}`);
  }
  return closedOnly(parseHyperliquidCandles(await response.json(), intervalMs), now);
}
