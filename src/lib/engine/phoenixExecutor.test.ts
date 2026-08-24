import { describe, expect, it } from "vitest";
import { collateralUsdFromTraderSnapshot } from "./phoenixExecutor";

describe("collateralUsdFromTraderSnapshot", () => {
  it("converts Rise quote lots (1e6 = $1) from subaccount collateral", () => {
    expect(
      collateralUsdFromTraderSnapshot({ snapshot: { subaccounts: [{ collateral: "6754" }] } }),
    ).toBeCloseTo(0.006754, 8);
  });

  it("prefers collateralUsd when the snapshot already has it", () => {
    expect(collateralUsdFromTraderSnapshot({ snapshot: { collateralUsd: 12.5 } })).toBe(12.5);
  });
});
