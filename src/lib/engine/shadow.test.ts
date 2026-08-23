import { describe, expect, it } from "vitest";
import { DAY_MS, FIFTEEN_MS, FOUR_HOUR_MS, HOUR_MS, MINUTE_MS, makeCandle } from "./candles";
import type { MarketSeries } from "./hierarchy";
import { evaluatePromotion } from "./promotion";
import { LIVE_ACTIONS_ENABLED } from "./spec";
import { advanceRuntime, createEmptyRuntime, mandateSummaries } from "./shadow";

function risingSeries(now: number): MarketSeries {
  const daily = [];
  let price = 80_000;
  for (let i = 0; i < 40; i += 1) {
    const openTime = now - (40 - i) * DAY_MS;
    const close = price * 1.01;
    daily.push(
      makeCandle({
        openTime,
        intervalMs: DAY_MS,
        open: price,
        high: close * 1.01,
        low: price * 0.995,
        close,
      }),
    );
    price = close;
  }
  const fourHour = [];
  for (let i = 0; i < 80; i += 1) {
    const openTime = now - (80 - i) * FOUR_HOUR_MS;
    const close = price * 1.002;
    fourHour.push(
      makeCandle({
        openTime,
        intervalMs: FOUR_HOUR_MS,
        open: price,
        high: close * 1.004,
        low: price * 0.997,
        close,
      }),
    );
    price = close;
  }
  const oneHour = [];
  for (let i = 0; i < 80; i += 1) {
    const openTime = now - (80 - i) * HOUR_MS;
    const close = price * 1.0008;
    oneHour.push(
      makeCandle({
        openTime,
        intervalMs: HOUR_MS,
        open: price,
        high: close * 1.002,
        low: price * 0.998,
        close,
      }),
    );
    price = close;
  }
  const fifteen = [];
  for (let i = 0; i < 80; i += 1) {
    const openTime = now - (80 - i) * FIFTEEN_MS;
    const close = price * (i < 70 ? 0.999 : 1.0003);
    fifteen.push(
      makeCandle({
        openTime,
        intervalMs: FIFTEEN_MS,
        open: price,
        high: Math.max(price, close) * 1.001,
        low: Math.min(price, close) * 0.999,
        close,
      }),
    );
    price = close;
  }
  const oneMinute = [];
  const start = now - 3 * HOUR_MS;
  for (let openTime = start; openTime < now; openTime += MINUTE_MS) {
    const close = price * 1.00005;
    oneMinute.push(
      makeCandle({
        openTime,
        intervalMs: MINUTE_MS,
        open: price,
        high: close * 1.0004,
        low: price * 0.9996,
        close,
      }),
    );
    price = close;
  }
  return { daily, fourHour, oneHour, fifteen, oneMinute, nativeFundingRate: 0.0001 };
}

describe("readiness epoch", () => {
  it("starts at the first closed 1m bar and does not enable live writes", () => {
    const now = Date.UTC(2026, 7, 23, 12, 0, 0);
    const series = risingSeries(now);
    const start = series.oneMinute[0].openTime;
    let state = createEmptyRuntime(now, start);
    state = advanceRuntime(state, series, "hyperliquid_public", false);
    const conservative = mandateSummaries(state).find((row) => row.mandate === "conservative");
    expect(LIVE_ACTIONS_ENABLED).toBe(false);
    expect(state.executionCursor).toBe(series.oneMinute[series.oneMinute.length - 1].openTime);
    expect(state.intents.every((intent) => intent.liveSubmitted === false)).toBe(true);
    expect(state.invariants.everShort).toBe(false);
    expect(conservative?.everShort).toBe(false);
    const promotion = evaluatePromotion(state, conservative, "hyperliquid_public");
    expect(promotion.hold).toBe(true);
    expect(promotion.verdict).toContain("HOLD FOR LIVE CLEARANCE");
    expect(promotion.gates[6]?.passed).toBe(false);
    expect(state.independentLongTransitions).toBe(0);
  });
});
