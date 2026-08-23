import { describe, expect, it } from "vitest";
import { FOUR_HOUR_MS, makeCandle } from "./candles";
import { defaultSimConfig, runSimulation } from "./simulate";
import type { Feature } from "./strategy";

const cfg = defaultSimConfig();
let t = Date.UTC(2026, 0, 1, 0, 0, 0);

function feat(
  o: number,
  h: number,
  l: number,
  c: number,
  extra: Partial<Feature>,
): Feature {
  t += FOUR_HOUR_MS;
  return {
    candle: makeCandle({ openTime: t, intervalMs: FOUR_HOUR_MS, open: o, high: h, low: l, close: c }),
    entryHigh: null,
    entryLow: null,
    exitHigh: null,
    exitLow: null,
    atr: 500,
    adx: 30, // above the trend-strength gate so entries can fire in tests
    rsi: 60,
    dailyDir: 0,
    ...extra,
  };
}

describe("turtle trend simulator", () => {
  it("rides an uptrend long and profits, never short", () => {
    const feats: Feature[] = [];
    let price = 100_000;
    for (let i = 0; i < 8; i += 1) {
      const open = price;
      const close = price * 1.01;
      feats.push(
        feat(open, close * 1.001, open * 0.999, close, {
          entryHigh: i === 0 ? open * 0.9999 : price * 0.9, // triggers the initial breakout
          exitLow: open * 0.97, // trails below, never stops out in the uptrend
          dailyDir: 1,
        }),
      );
      price = close;
    }
    const r = runSimulation(feats, cfg);
    expect(r.finalEquityUsd).toBeGreaterThan(r.startEquityUsd);
    expect(r.everShort).toBe(false);
    expect(r.everLiquidated).toBe(false);
  });

  it("rides a downtrend short and profits", () => {
    const feats: Feature[] = [];
    let price = 100_000;
    for (let i = 0; i < 8; i += 1) {
      const open = price;
      const close = price * 0.99;
      feats.push(
        feat(open, open * 1.001, close * 0.999, close, {
          entryLow: i === 0 ? open * 1.0001 : price * 1.1, // triggers the initial breakdown
          exitHigh: open * 1.03, // trails above, never stops out in the downtrend
          dailyDir: -1,
        }),
      );
      price = close;
    }
    const r = runSimulation(feats, cfg);
    expect(r.finalEquityUsd).toBeGreaterThan(r.startEquityUsd);
    expect(r.everShort).toBe(true);
    expect(r.everLiquidated).toBe(false);
  });

  it("caps a losing trade near the risk-per-trade budget", () => {
    const feats: Feature[] = [
      feat(100_000, 100_200, 99_900, 100_050, { entryHigh: 99_990, exitLow: 98_000, dailyDir: 1 }),
      feat(99_500, 99_600, 98_000, 98_500, { exitLow: 98_000, dailyDir: 1 }),
    ];
    const r = runSimulation(feats, cfg);
    // A full stop-out loses ~riskPct of equity (plus fees), whatever riskPct is set to.
    const loss = r.startEquityUsd - r.finalEquityUsd;
    const budget = cfg.capitalUsd * cfg.riskPct;
    expect(r.everLiquidated).toBe(false);
    expect(loss).toBeGreaterThan(budget * 0.8);
    expect(loss).toBeLessThan(budget * 1.5);
  });

  it("stays flat when the daily filter is neutral", () => {
    const feats: Feature[] = [];
    for (let i = 0; i < 6; i += 1) {
      feats.push(feat(100_000, 101_000, 99_000, 100_500, { entryHigh: 99_000, entryLow: 99_500, dailyDir: 0 }));
    }
    const r = runSimulation(feats, cfg);
    expect(r.trades).toBe(0);
    expect(r.finalEquityUsd).toBe(r.startEquityUsd);
  });

  it("caps leverage so a tiny ATR cannot oversize the position", () => {
    const feats: Feature[] = [
      feat(100_000, 100_100, 99_950, 100_050, { entryHigh: 99_990, exitLow: 98_000, atr: 10, dailyDir: 1 }),
      feat(100_050, 101_050, 100_000, 101_000, { exitLow: 98_000, atr: 10, dailyDir: 1 }),
    ];
    const r = runSimulation(feats, cfg);
    // +~1% price move; at the 10x cap that is ~+10% ROE, not +100%+ if uncapped.
    expect(r.totalReturnPct).toBeLessThan(20);
    expect(r.blownUp).toBe(false);
  });
});
