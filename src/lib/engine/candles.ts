import type { Candle, PathMode } from "./types";

export const MINUTE_MS = 60_000;
export const FIFTEEN_MS = 15 * MINUTE_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const FOUR_HOUR_MS = 4 * HOUR_MS;
export const DAY_MS = 24 * HOUR_MS;

export function availableAt(candle: Candle): number {
  return candle.openTime + candle.intervalMs;
}

export function isUsable(candle: Candle, decisionTime: number): boolean {
  return availableAt(candle) <= decisionTime;
}

export function closedOnly(candles: Candle[], now: number): Candle[] {
  return candles.filter((candle) => availableAt(candle) <= now);
}

export function usableAt(candles: Candle[], decisionTime: number): Candle[] {
  return candles.filter((candle) => isUsable(candle, decisionTime));
}

export function lastUsable(
  candles: Candle[],
  decisionTime: number,
): Candle | null {
  const usable = usableAt(candles, decisionTime);
  return usable.length ? usable[usable.length - 1] : null;
}

export function validateCandleGeometry(candle: Candle): string | null {
  if (!Number.isFinite(candle.openTime) || !Number.isFinite(candle.closeTime)) {
    return "non_finite_timestamp";
  }
  if (
    ![candle.open, candle.high, candle.low, candle.close].every((value) =>
      Number.isFinite(value),
    )
  ) {
    return "non_finite_ohlc";
  }
  if (candle.high < candle.low) {
    return "high_below_low";
  }
  if (candle.high < Math.max(candle.open, candle.close)) {
    return "high_below_body";
  }
  if (candle.low > Math.min(candle.open, candle.close)) {
    return "low_above_body";
  }
  if (candle.closeTime < candle.openTime) {
    return "close_before_open";
  }
  return null;
}

export function validateSeries(candles: Candle[], intervalMs: number): string | null {
  if (!candles.length) {
    return "empty_series";
  }
  const seen = new Set<number>();
  let previous = -1;
  for (const candle of candles) {
    if (candle.intervalMs !== intervalMs) {
      return "interval_mismatch";
    }
    const geometry = validateCandleGeometry(candle);
    if (geometry) {
      return geometry;
    }
    if (seen.has(candle.openTime)) {
      return "duplicate_open_time";
    }
    if (candle.openTime <= previous) {
      return "non_monotonic";
    }
    seen.add(candle.openTime);
    previous = candle.openTime;
  }
  return null;
}

export function findExecutionGap(
  candles: Candle[],
  intervalMs: number,
): { from: number; to: number } | null {
  for (let i = 1; i < candles.length; i += 1) {
    const expected = candles[i - 1].openTime + intervalMs;
    if (candles[i].openTime !== expected) {
      return { from: candles[i - 1].openTime, to: candles[i].openTime };
    }
  }
  return null;
}

export function pathPrices(candle: Candle, path: PathMode): number[] {
  if (path === "low_first") {
    return uniquePath([candle.open, candle.low, candle.high, candle.close]);
  }
  return uniquePath([candle.open, candle.high, candle.low, candle.close]);
}

function uniquePath(prices: number[]): number[] {
  const out: number[] = [];
  for (const price of prices) {
    if (!out.length || out[out.length - 1] !== price) {
      out.push(price);
    }
  }
  return out;
}

export function parseHyperliquidCandles(
  raw: unknown,
  intervalMs: number,
): Candle[] {
  if (!Array.isArray(raw)) {
    throw new Error("candle_payload_not_array");
  }
  const candles: Candle[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      throw new Error("candle_row_invalid");
    }
    const row = item as Record<string, unknown>;
    const candle: Candle = {
      openTime: Number(row.t),
      closeTime: Number(row.T),
      open: Number(row.o),
      high: Number(row.h),
      low: Number(row.l),
      close: Number(row.c),
      volume: Number(row.v),
      trades: Number(row.n ?? 0),
      intervalMs,
    };
    const geometry = validateCandleGeometry(candle);
    if (geometry) {
      throw new Error(`corrupt_candle:${geometry}`);
    }
    candles.push(candle);
  }
  candles.sort((a, b) => a.openTime - b.openTime);
  const seriesError = validateSeries(candles, intervalMs);
  if (seriesError) {
    throw new Error(`corrupt_series:${seriesError}`);
  }
  return candles;
}

export function makeCandle(input: {
  openTime: number;
  intervalMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}): Candle {
  return {
    openTime: input.openTime,
    closeTime: input.openTime + input.intervalMs - 1,
    open: input.open,
    high: input.high,
    low: input.low,
    close: input.close,
    volume: input.volume ?? 0,
    trades: 0,
    intervalMs: input.intervalMs,
  };
}
