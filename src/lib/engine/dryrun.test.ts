import { describe, expect, it } from "vitest";
import { planDryRun } from "./dryrun";
import { liveEquityUsd, scaledDailyLossUsd, drawdownHalted, type LiveConfig } from "./liveConfig";

const cfg: LiveConfig = {
  dryRun: true,
  liveTradingEnabled: false,
  exchange: "phoenix",
  accountLabel: "",
  capitalUsd: 1000,
  maxLeverage: 20,
  riskPct: 0.03,
  maxNotionalUsd: 2000,
  dailyLossLimitUsd: 100,
  maxDrawdownPct: 25,
  credentialsPresent: false,
  auto4h: false,
  compound: false,
};

describe("dry-run planner", () => {
  it("never submits and is never live", () => {
    const plan = planDryRun({ side: "LONG", sizeBtc: 0.05, stopPrice: 74000 }, 77000, cfg, 1000);
    expect(plan.liveSubmitted).toBe(false);
    expect(plan.dryRun).toBe(true);
  });

  it("holds (no order) when the signal is flat", () => {
    const plan = planDryRun({ side: "FLAT", sizeBtc: 0, stopPrice: null }, 77000, cfg, 1000);
    expect(plan.action).toBe("HOLD");
    expect(plan.notionalUsd).toBe(0);
  });

  it("plans a long and respects the max-notional risk limit", () => {
    // 0.1 BTC @ 77000 = $7700 notional, but the cap is $2000
    const plan = planDryRun({ side: "LONG", sizeBtc: 0.1, stopPrice: 74000 }, 77000, cfg, 1000);
    expect(plan.action).toBe("OPEN_LONG");
    expect(plan.notionalUsd).toBeLessThanOrEqual(2000 + 1e-6);
    expect(plan.notionalCapped).toBe(true);
    expect(plan.sizeBtc).toBeCloseTo(2000 / 77000, 6);
  });

  it("plans a short below the cap without clamping", () => {
    const plan = planDryRun({ side: "SHORT", sizeBtc: -0.02, stopPrice: 79000 }, 77000, cfg, 1000);
    expect(plan.action).toBe("OPEN_SHORT");
    expect(plan.notionalCapped).toBe(false);
    expect(plan.sizeBtc).toBeCloseTo(-0.02, 6);
  });

  it("sizes a live open from $1000 equity, not a compounded paper size", () => {
    const liveCfg = { ...cfg, riskPct: 0.1, maxNotionalUsd: 20_000 };
    const plan = planDryRun(
      { side: "LONG", sizeBtc: 0.2, stopPrice: 68_000 },
      70_224,
      liveCfg,
      1000,
      { equityUsd: 1000, atr: 1013, atrStopMult: 2, freshEntry: true },
    );
    const expected = (1000 * 0.1) / (2 * 1013);
    expect(plan.action).toBe("OPEN_LONG");
    expect(plan.sizeBtc).toBeCloseTo(expected, 6);
    expect(plan.sizeBtc).toBeLessThan(0.1);
  });

  it("holds when the paper book is long from an earlier bar", () => {
    const plan = planDryRun(
      { side: "LONG", sizeBtc: 0.07, stopPrice: 68_000 },
      76_000,
      { ...cfg, riskPct: 0.1, maxNotionalUsd: 20_000 },
      1000,
      { equityUsd: 1000, atr: 1078, atrStopMult: 2, freshEntry: false, paperSide: "LONG" },
    );
    expect(plan.action).toBe("HOLD");
    expect(plan.sizeBtc).toBe(0);
    expect(plan.note).toMatch(/earlier bar/i);
  });

  it("caps live equity at Phoenix collateral unless compounding", () => {
    expect(liveEquityUsd(1000, 999.56)).toBeCloseTo(999.56, 6);
    expect(liveEquityUsd(1000, 2000)).toBe(1000);
    expect(liveEquityUsd(2000, 999.56)).toBeCloseTo(999.56, 6);
    expect(liveEquityUsd(2000, 2000)).toBe(2000);
    expect(liveEquityUsd(1000, undefined)).toBe(1000);
    expect(liveEquityUsd(1000, 0)).toBe(1000);
  });

  it("compounds on full collateral, and still cannot size above cash", () => {
    expect(liveEquityUsd(2000, 2500, true)).toBe(2500);
    expect(liveEquityUsd(2000, 999.56, true)).toBeCloseTo(999.56, 6);
    expect(liveEquityUsd(2000, undefined, true)).toBe(2000);
  });

  it("scales the daily-loss budget with compounded equity", () => {
    const live = { ...cfg, compound: true, capitalUsd: 2000, dailyLossLimitUsd: 400 };
    expect(scaledDailyLossUsd(live, 2000)).toBe(400);
    expect(scaledDailyLossUsd(live, 4000)).toBe(800);
    expect(drawdownHalted(2000, 1200, 40)).toBe(true);
    expect(drawdownHalted(2000, 1300, 40)).toBe(false);
  });
});
