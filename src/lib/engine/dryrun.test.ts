import { describe, expect, it } from "vitest";
import { planDryRun } from "./dryrun";
import type { LiveConfig } from "./liveConfig";

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
});
