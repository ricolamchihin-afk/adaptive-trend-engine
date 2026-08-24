import { describe, expect, it } from "vitest";
import { btcPositionFromTraderSnapshot, collateralUsdFromTraderSnapshot, markFromMarketStats } from "./phoenixExecutor";

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

describe("btcPositionFromTraderSnapshot", () => {
  it("reads a long from basePositionUnits", () => {
    const p = btcPositionFromTraderSnapshot({
      snapshot: {
        subaccounts: [
          {
            positions: [
              { symbol: "BTC", basePositionLots: "1160", basePositionUnits: "0.116", entryPriceUsd: "79840" },
            ],
          },
        ],
      },
    });
    expect(p.side).toBe("LONG");
    expect(p.sizeBtc).toBeCloseTo(0.116, 6);
    expect(p.entryUsd).toBe(79840);
  });

  it("treats lots-only as side without inventing 1-lot = 1 BTC", () => {
    const p = btcPositionFromTraderSnapshot({
      snapshot: { subaccounts: [{ positions: [{ symbol: "BTC", basePositionLots: "1" }] }] },
    });
    expect(p.side).toBe("LONG");
    expect(p.sizeBtc).toBe(0);
  });

  it("returns flat when there is no BTC book", () => {
    expect(btcPositionFromTraderSnapshot({ snapshot: { subaccounts: [{ positions: [] }] } }).side).toBe(
      "FLAT",
    );
  });
});

describe("markFromMarketStats", () => {
  it("reads snake_case or camelCase mark", () => {
    expect(markFromMarketStats({ mark_price: 77835 })).toBe(77835);
    expect(markFromMarketStats({ markPrice: 77840.5 })).toBe(77840.5);
    expect(markFromMarketStats({ mark_price: 0 })).toBeNull();
  });
});
