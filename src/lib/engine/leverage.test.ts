import { describe, expect, it } from "vitest";
import {
  USABLE_EQUITY_FRACTION,
  leverageRow,
  leverageTable,
  phoenixLeverageTable,
} from "./leverage";

const base = {
  collateralUsd: 1000,
  leverage: 10,
  entryPrice: 100_000,
  feeRatePerSide: 0.0004, // Phoenix taker 4bps
};

describe("leverage ROE math", () => {
  it("gross ROE is leverage times the price move", () => {
    expect(leverageRow(base, 1).roePct).toBeCloseTo(10, 6);
    expect(leverageRow(base, -1).roePct).toBeCloseTo(-10, 6);
    expect(leverageRow(base, 2.5).roePct).toBeCloseTo(25, 6);
  });

  it("a flat trade still pays round-trip fees", () => {
    const flat = leverageRow(base, 0);
    expect(flat.pnlUsd).toBeCloseTo(0, 6);
    // entry fee on notional + exit fee on notional = 2 * 1000 * 10 * 0.0004 = $8
    expect(flat.feeUsd).toBeCloseTo(8, 6);
    expect(flat.netRoePct).toBeCloseTo(-0.8, 6);
  });

  it("liquidation distance matches the engine's 0.9 equity haircut", () => {
    const table = leverageTable(base);
    expect(table.liquidationDistancePct).toBeCloseTo(USABLE_EQUITY_FRACTION / 10, 9);
    expect(table.liquidationPrice).toBeCloseTo(100_000 * (1 - 0.09), 6);
    expect(leverageRow(base, -9).liquidated).toBe(true);
    expect(leverageRow(base, -8.5).liquidated).toBe(false);
  });

  it("net ROE is below gross ROE by the fee drag", () => {
    const row = leverageRow(base, 3);
    expect(row.netRoePct).toBeLessThan(row.roePct);
    expect(row.roePct - row.netRoePct).toBeGreaterThan(0);
  });

  it("phoenix helper uses 1000 USDC at 10x", () => {
    const table = phoenixLeverageTable(80_000);
    expect(table.collateralUsd).toBe(1000);
    expect(table.leverage).toBe(10);
    expect(table.notionalUsd).toBe(10_000);
    expect(table.roundTripFeeRoePct).toBeCloseTo(0.8, 6);
  });
});
