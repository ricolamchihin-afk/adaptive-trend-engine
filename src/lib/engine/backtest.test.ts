import { describe, expect, it } from "vitest";
import { runBacktest } from "./backtest";
import { syntheticSeries } from "./market-data";

describe("backtest harness", () => {
  const series = syntheticSeries(Date.UTC(2026, 7, 23, 12, 0, 0));
  const report = runBacktest(series, "offline_synthetic_fallback");

  it("walks the full one-minute series", () => {
    expect(report.candleCount).toBe(series.oneMinute.length);
    expect(report.candleCount).toBeGreaterThan(0);
    expect(report.mandates).toHaveLength(3);
  });

  it("never opens a short and never breaches the exposure cap", () => {
    for (const mandate of report.mandates) {
      expect(mandate.everShort).toBe(false);
      expect(mandate.exposureCapBreached).toBe(false);
      expect(mandate.feesUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports ROE consistent with worst-path P&L", () => {
    for (const mandate of report.mandates) {
      const expectedRoe = (mandate.worstPathPnlUsd / mandate.startingNavUsd) * 100;
      expect(mandate.roePct).toBeCloseTo(expectedRoe, 6);
    }
  });
});
