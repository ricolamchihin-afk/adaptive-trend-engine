import {
  DAY_MS,
  FIFTEEN_MS,
  FOUR_HOUR_MS,
  HOUR_MS,
  MINUTE_MS,
  closedOnly,
  makeCandle,
  parseHyperliquidCandles,
} from "./candles";
import type { Candle, MarketSource } from "./types";
import type { MarketSeries } from "./hierarchy";

const INFO_URL = "https://api.hyperliquid.xyz/info";

export interface MarketSnapshot {
  series: MarketSeries;
  source: MarketSource;
  fetchedAt: number;
  lastClosed1m: Candle | null;
  mark: number | null;
  warning: string | null;
}

async function postInfo(body: unknown): Promise<unknown> {
  const response = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`hyperliquid_http_${response.status}`);
  }
  return response.json();
}

async function fetchCandles(
  interval: string,
  intervalMs: number,
  lookbackMs: number,
  now: number,
): Promise<Candle[]> {
  const raw = await postInfo({
    type: "candleSnapshot",
    req: {
      coin: "BTC",
      interval,
      startTime: now - lookbackMs,
      endTime: now,
    },
  });
  const parsed = parseHyperliquidCandles(raw, intervalMs);
  return closedOnly(parsed, now);
}

function btcFundingRate(payload: unknown): number | null {
  if (!Array.isArray(payload) || payload.length < 2) {
    return null;
  }
  const universe = (payload[0] as { universe?: Array<{ name: string }> })?.universe;
  const ctxs = payload[1] as Array<{ funding?: string }> | undefined;
  if (!universe || !ctxs) {
    return null;
  }
  const index = universe.findIndex((asset) => asset.name === "BTC");
  if (index < 0 || !ctxs[index]?.funding) {
    return null;
  }
  const rate = Number(ctxs[index].funding);
  return Number.isFinite(rate) ? rate : null;
}

export function syntheticSeries(now: number): MarketSeries {
  const startDaily = now - 120 * DAY_MS;
  const daily: Candle[] = [];
  let price = 95_000;
  for (let i = 0; i < 90; i += 1) {
    const openTime = startDaily + i * DAY_MS;
    if (openTime + DAY_MS > now) {
      break;
    }
    const open = price;
    const close = price * (1.004 + ((i % 7) - 3) * 0.0004);
    const high = Math.max(open, close) * 1.01;
    const low = Math.min(open, close) * 0.992;
    daily.push(makeCandle({ openTime, intervalMs: DAY_MS, open, high, low, close }));
    price = close;
  }

  const fourHour: Candle[] = [];
  const oneHour: Candle[] = [];
  const fifteen: Candle[] = [];
  const oneMinute: Candle[] = [];
  price = daily[daily.length - 1]?.close ?? 100_000;
  const start4h = now - 50 * DAY_MS;
  for (let openTime = start4h - (start4h % FOUR_HOUR_MS); openTime + FOUR_HOUR_MS <= now; openTime += FOUR_HOUR_MS) {
    const open = price;
    const close = price * (1.0015 + Math.sin(openTime / FOUR_HOUR_MS) * 0.001);
    fourHour.push(
      makeCandle({
        openTime,
        intervalMs: FOUR_HOUR_MS,
        open,
        high: Math.max(open, close) * 1.004,
        low: Math.min(open, close) * 0.996,
        close,
      }),
    );
    price = close;
  }
  price = fourHour[fourHour.length - 1]?.close ?? price;
  const start1h = now - 20 * DAY_MS;
  for (let openTime = start1h - (start1h % HOUR_MS); openTime + HOUR_MS <= now; openTime += HOUR_MS) {
    const open = price;
    const close = price * (1.0004 + Math.sin(openTime / HOUR_MS) * 0.0008);
    oneHour.push(
      makeCandle({
        openTime,
        intervalMs: HOUR_MS,
        open,
        high: Math.max(open, close) * 1.002,
        low: Math.min(open, close) * 0.998,
        close,
      }),
    );
    price = close;
  }
  price = oneHour[oneHour.length - 1]?.close ?? price;
  const start15 = now - 8 * DAY_MS;
  for (let openTime = start15 - (start15 % FIFTEEN_MS); openTime + FIFTEEN_MS <= now; openTime += FIFTEEN_MS) {
    const open = price;
    const close = price * (1.0001 + Math.sin(openTime / FIFTEEN_MS) * 0.0006);
    fifteen.push(
      makeCandle({
        openTime,
        intervalMs: FIFTEEN_MS,
        open,
        high: Math.max(open, close) * 1.001,
        low: Math.min(open, close) * 0.999,
        close,
      }),
    );
    price = close;
  }
  price = fifteen[fifteen.length - 1]?.close ?? price;
  const start1m = now - 36 * HOUR_MS;
  for (let openTime = start1m - (start1m % MINUTE_MS); openTime + MINUTE_MS <= now; openTime += MINUTE_MS) {
    const open = price;
    const wave = Math.sin(openTime / MINUTE_MS / 40) * 0.00035;
    const close = price * (1 + wave);
    const low = Math.min(open, close) * 0.9994;
    const high = Math.max(open, close) * 1.0006;
    oneMinute.push(
      makeCandle({
        openTime,
        intervalMs: MINUTE_MS,
        open,
        high,
        low,
        close,
        volume: 12,
      }),
    );
    price = close;
  }
  return {
    daily,
    fourHour,
    oneHour,
    fifteen,
    oneMinute,
    nativeFundingRate: null,
  };
}

export async function loadMarket(now = Date.now()): Promise<MarketSnapshot> {
  try {
    const [daily, fourHour, oneHour, fifteen, oneMinute, assetCtx] = await Promise.all([
      fetchCandles("1d", DAY_MS, 130 * DAY_MS, now),
      fetchCandles("4h", FOUR_HOUR_MS, 70 * DAY_MS, now),
      fetchCandles("1h", HOUR_MS, 25 * DAY_MS, now),
      fetchCandles("15m", FIFTEEN_MS, 12 * DAY_MS, now),
      fetchCandles("1m", MINUTE_MS, 40 * HOUR_MS, now),
      postInfo({ type: "metaAndAssetCtxs" }).catch(() => null),
    ]);
    const series: MarketSeries = {
      daily,
      fourHour,
      oneHour,
      fifteen,
      oneMinute,
      nativeFundingRate: btcFundingRate(assetCtx),
    };
    const lastClosed1m = oneMinute[oneMinute.length - 1] ?? null;
    return {
      series,
      source: "hyperliquid_public",
      fetchedAt: now,
      lastClosed1m,
      mark: lastClosed1m?.close ?? null,
      warning: series.nativeFundingRate === null
        ? "Native funding could not be parsed. P&L still uses the zero placeholder."
        : "Native funding is displayed only. P&L still uses the zero placeholder.",
    };
  } catch (error) {
    const series = syntheticSeries(now);
    const lastClosed1m = series.oneMinute[series.oneMinute.length - 1] ?? null;
    return {
      series,
      source: "offline_synthetic_fallback",
      fetchedAt: now,
      lastClosed1m,
      mark: lastClosed1m?.close ?? null,
      warning: `Public Hyperliquid feed failed (${error instanceof Error ? error.message : "unknown"}). Offline synthetic candles are labeled and excluded from promotion evidence.`,
    };
  }
}
