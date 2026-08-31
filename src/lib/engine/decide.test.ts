import { describe, expect, it } from "vitest";
import { FOUR_HOUR_MS, makeCandle } from "./candles";
import { canEnterLong, canEnterShort, evaluateSetup } from "./decide";
import { defaultSimConfig } from "./simulate";
import type { Feature } from "./strategy";

let t = Date.UTC(2026, 0, 1);

function feat(extra: Partial<Feature> = {}): Feature {
  t += FOUR_HOUR_MS;
  return {
    candle: makeCandle({
      openTime: t,
      intervalMs: FOUR_HOUR_MS,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
    }),
    entryHigh: 109,
    entryLow: 91,
    exitHigh: 108,
    exitLow: 92,
    atr: 2,
    adx: 25,
    rsi: 50,
    macdHist: 1,
    dailyDir: 1,
    dailyEmaSlopePct: 1,
    ...extra,
  };
}

describe("shared entry gates", () => {
  const cfg = defaultSimConfig();

  it("enters long only on a regime-aligned Donchian breakout", () => {
    const long = feat({ dailyDir: 1, rsi: 55, entryHigh: 109, candle: makeCandle({
      openTime: t + FOUR_HOUR_MS,
      intervalMs: FOUR_HOUR_MS,
      open: 108,
      high: 111,
      low: 107,
      close: 110,
    }) });
    expect(canEnterLong(long, cfg)).toBe(true);
    expect(canEnterShort(long, cfg)).toBe(false);
    expect(evaluateSetup(long, cfg).action).toBe("ENTER_LONG");
  });

  it("enters short only on a regime-aligned Donchian breakdown", () => {
    const short = feat({
      dailyDir: -1,
      rsi: 45,
      macdHist: -1,
      entryLow: 91,
      candle: makeCandle({
        openTime: t + FOUR_HOUR_MS,
        intervalMs: FOUR_HOUR_MS,
        open: 92,
        high: 93,
        low: 88,
        close: 89,
      }),
    });
    expect(canEnterShort(short, cfg)).toBe(true);
    expect(canEnterLong(short, cfg)).toBe(false);
    expect(evaluateSetup(short, cfg).action).toBe("ENTER_SHORT");
  });

  it("waits when the daily regime is valid but price is inside the channel", () => {
    const wait = feat({
      dailyDir: 1,
      rsi: 60,
      entryHigh: 200,
      candle: makeCandle({
        openTime: t + FOUR_HOUR_MS,
        intervalMs: FOUR_HOUR_MS,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
      }),
    });
    expect(canEnterLong(wait, cfg)).toBe(false);
    expect(evaluateSetup(wait, cfg)).toMatchObject({ bias: "LONG", action: "WAIT" });
  });

  it("blocks a long when RSI fails the 50 gate", () => {
    const blocked = feat({ dailyDir: 1, rsi: 40, entryHigh: 100 });
    expect(canEnterLong(blocked, cfg)).toBe(false);
    expect(evaluateSetup(blocked, cfg).bias).toBe("FLAT");
  });
});
