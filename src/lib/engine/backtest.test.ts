import { describe, expect, it } from "vitest";
import { runBacktest } from "./backtest";
import { syntheticSeries } from "./market-data";
import type { Regime } from "./types";

describe("dynamic strategy backtest", () => {
  const series = syntheticSeries(Date.UTC(2026, 7, 23, 12, 0, 0));
  const report = runBacktest(series, "offline_synthetic_fallback");
  const regimes: Regime[] = ["LONG", "SHORT", "GRID", "FLAT"];

  it("executes on the 4h timeframe over every bar", () => {
    expect(report.executionTimeframe).toBe("4h");
    expect(report.bars).toBe(series.fourHour.length);
    const barsSum = regimes.reduce((sum, r) => sum + report.barsInRegime[r], 0);
    expect(barsSum).toBe(report.bars);
  });

  it("reconciles per-regime P&L to the equity change", () => {
    const pnlSum = regimes.reduce((sum, r) => sum + report.perRegimePnlUsd[r], 0);
    expect(pnlSum).toBeCloseTo(report.finalEquityUsd - report.startEquityUsd, 3);
    expect(Number.isFinite(report.finalEquityUsd)).toBe(true);
    expect(report.blownUp).toBe(false);
  });

  it("uses the 1000 USDC capital and 20x leverage cap", () => {
    expect(report.capitalUsd).toBe(1000);
    expect(report.maxLeverage).toBe(20);
  });
});
