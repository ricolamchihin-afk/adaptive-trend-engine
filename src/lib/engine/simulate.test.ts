import { describe, expect, it } from "vitest";
import { FOUR_HOUR_MS, makeCandle } from "./candles";
import { defaultSimConfig, runSimulation, type RegimeBar } from "./simulate";
import type { Regime } from "./types";

let t = Date.UTC(2026, 0, 1, 0, 0, 0);
function bar(regime: Regime, open: number, high: number, low: number, close: number): RegimeBar {
  t += FOUR_HOUR_MS;
  return {
    regime,
    pathMode: "low_first",
    candle: makeCandle({ openTime: t, intervalMs: FOUR_HOUR_MS, open, high, low, close }),
  };
}

const cfg = defaultSimConfig();

describe("dynamic directional simulator", () => {
  it("profits from a clean uptrend while LONG and never goes short", () => {
    let price = 100_000;
    const bars: RegimeBar[] = [];
    for (let i = 0; i < 10; i += 1) {
      const open = price;
      const close = price * 1.02;
      bars.push(bar("LONG", open, close * 1.001, open * 0.999, close));
      price = close;
    }
    const r = runSimulation(bars, cfg);
    expect(r.finalEquityUsd).toBeGreaterThan(r.startEquityUsd);
    expect(r.everShort).toBe(false);
    expect(r.everLiquidated).toBe(false);
    expect(r.blownUp).toBe(false);
    expect(r.perRegimePnlUsd.LONG).toBeGreaterThan(0);
  });

  it("profits from a downtrend while SHORT and marks everShort", () => {
    let price = 100_000;
    const bars: RegimeBar[] = [];
    for (let i = 0; i < 10; i += 1) {
      const open = price;
      const close = price * 0.98;
      bars.push(bar("SHORT", open, open * 1.001, close, close));
      price = close;
    }
    const r = runSimulation(bars, cfg);
    expect(r.finalEquityUsd).toBeGreaterThan(r.startEquityUsd);
    expect(r.everShort).toBe(true);
    expect(r.everLiquidated).toBe(false);
    expect(r.perRegimePnlUsd.SHORT).toBeGreaterThan(0);
  });

  it("caps a loss at the protective stop before liquidation", () => {
    const bars: RegimeBar[] = [
      bar("LONG", 100_000, 100_500, 99_800, 100_200),
      // adverse 5% intrabar: below the 4% stop, above the 9% liquidation
      bar("LONG", 100_200, 100_300, 95_000, 96_000),
    ];
    const r = runSimulation(bars, cfg);
    expect(r.everLiquidated).toBe(false);
    // ~4% adverse on 10x = ~ -40% of the $1,000 book, plus fees
    expect(r.finalEquityUsd).toBeGreaterThan(540);
    expect(r.finalEquityUsd).toBeLessThan(620);
  });

  it("records a liquidation on a violent adverse gap", () => {
    const bars: RegimeBar[] = [
      bar("LONG", 100_000, 100_500, 99_800, 100_200),
      bar("LONG", 100_200, 100_300, 88_000, 90_000),
    ];
    const r = runSimulation(bars, cfg);
    expect(r.everLiquidated).toBe(true);
    expect(r.liquidations).toBeGreaterThanOrEqual(1);
    expect(r.finalEquityUsd).toBeLessThan(r.startEquityUsd);
  });

  it("harvests a bounded range in GRID without blowing up or going short-net", () => {
    const bars: RegimeBar[] = [bar("GRID", 100_000, 100_100, 99_900, 100_000)];
    for (let i = 0; i < 12; i += 1) {
      // oscillate down to a buy rung then back up through the sell target
      bars.push(bar("GRID", 100_000, 100_300, 98_500, 100_000));
    }
    const r = runSimulation(bars, cfg);
    expect(r.blownUp).toBe(false);
    expect(r.everShort).toBe(false);
    expect(r.everLiquidated).toBe(false);
    expect(r.trades).toBeGreaterThan(0);
    expect(Number.isFinite(r.finalEquityUsd)).toBe(true);
  });
});
