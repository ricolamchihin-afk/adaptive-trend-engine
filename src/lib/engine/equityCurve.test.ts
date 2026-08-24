import { describe, expect, it } from "vitest";
import {
  collateralLiteFromPhoenix,
  curveStats,
  fillLiteFromPhoenix,
  liveBookStartMs,
  mergeEquitySeries,
  quoteLotsToUsd,
  rebuildEquity,
  netExternalUsd,
  type CollateralEventLite,
} from "./equityCurve";

describe("quoteLotsToUsd", () => {
  it("uses Rise 1e6 quote lots per dollar", () => {
    expect(quoteLotsToUsd(2_003_592_827)).toBeCloseTo(2003.592827, 6);
  });
});

describe("phoenix history parsers", () => {
  it("converts collateral lots and fill strings", () => {
    const c = collateralLiteFromPhoenix({
      timestamp: 1_787_567_854_000,
      eventType: "deposit",
      amount: 1_004_030_000,
      collateralAfter: 2_003_592_827,
    });
    expect(c.afterUsd).toBeCloseTo(2003.592827, 6);
    expect(c.amountUsd).toBeCloseTo(1004.03, 6);
    const f = fillLiteFromPhoenix({
      timestamp: 1_787_544_964_000,
      price: "77164",
      realizedPnl: "0.0116",
      fees: "0.002701",
      baseLotsAfter: "0",
    });
    expect(f.price).toBe(77164);
    expect(f.posAfter).toBe(0);
    expect(f.realizedPnl).toBeCloseTo(0.0116, 6);
  });
});

describe("mergeEquitySeries", () => {
  it("lets venue points win the same timestamp and appends live", () => {
    const merged = mergeEquitySeries(
      [
        [{ t: 1_000, equity: 2000, source: "local" }],
        [{ t: 1_000, equity: 1990, source: "phoenix" }],
      ],
      { t: 2_000, equity: 2010, source: "live" },
    );
    expect(merged).toEqual([
      { t: 1_000, equity: 1990, source: "phoenix" },
      { t: 2_000, equity: 2010, source: "live" },
    ]);
  });
});

describe("rebuildEquity", () => {
  it("starts after a flatten-to-zero and marks open risk on 4h closes", () => {
    const events: CollateralEventLite[] = [
      { t: 1_000, type: "deposit", amountUsd: 800, afterUsd: 800 },
      { t: 2_000, type: "withdrawal", amountUsd: 800, afterUsd: 0 },
      { t: 3_000, type: "deposit", amountUsd: 2000, afterUsd: 2000 },
    ];
    const points = rebuildEquity({
      events,
      fills: [{ t: 4_000, price: 80_000, realizedPnl: 0, fees: 8, posAfter: 0.1 }],
      candles: [
        { t: 3_500, close: 80_000 },
        { t: 5_000, close: 82_000 },
      ],
    });
    expect(liveBookStartMs(events)).toBe(2_000);
    expect(points[0]).toMatchObject({ t: 3_000, equity: 2000, source: "phoenix" });
    const afterFill = points.find((p) => p.source === "fill");
    expect(afterFill?.equity).toBeCloseTo(1992, 6);
    const marked = points.find((p) => p.source === "mark");
    expect(marked?.t).toBe(5_000);
    expect(marked?.equity).toBeCloseTo(1992 + 0.1 * (82_000 - 80_000), 4);
  });

  it("reports pnl vs the first live-book point", () => {
    const points = rebuildEquity({
      events: [{ t: 1, type: "deposit", amountUsd: 2000, afterUsd: 2000 }],
      fills: [],
      candles: [],
      live: { t: 2, equity: 2100, source: "live" },
    });
    const s = curveStats(points, points[0].equity);
    expect(s.pnlUsd).toBeCloseTo(100, 6);
    expect(s.returnPct).toBeCloseTo(5, 6);
    expect(netExternalUsd([{ t: 1, type: "deposit", amountUsd: 2000, afterUsd: 2000 }], null)).toBe(2000);
  });
});
