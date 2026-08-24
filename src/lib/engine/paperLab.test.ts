import { afterEach, describe, expect, it } from "vitest";
import { getExecutor } from "./executor";
import { liveConfig } from "./liveConfig";
import { hyperliquidDex } from "./market-data";
import { DECIBEL_PORTFOLIO_BOOKS, PAPER_BOOKS } from "./paperBooks";
import { overlayEqualDollar, scoreEquityPath } from "./portfolio";

describe("paper books", () => {
  it("covers BTC reference plus ETH, BNB, and xyz equity perps", () => {
    const coins = PAPER_BOOKS.map((b) => b.coin);
    expect(coins).toContain("BTC");
    expect(coins).toContain("ETH");
    expect(coins).toContain("BNB");
    expect(coins.filter((c) => c.startsWith("xyz:")).length).toBeGreaterThanOrEqual(6);
    expect(PAPER_BOOKS.find((b) => b.coin === "BTC")?.role).toBe("reference");
    expect(PAPER_BOOKS.filter((b) => b.sleeve === "crypto").every((b) => !b.coin.includes(":"))).toBe(true);
  });

  it("keeps BTC out of the Decibel portfolio", () => {
    expect(DECIBEL_PORTFOLIO_BOOKS.some((b) => b.coin === "BTC")).toBe(false);
    expect(DECIBEL_PORTFOLIO_BOOKS.map((b) => b.coin)).toEqual(
      expect.arrayContaining(["ETH", "BNB", "xyz:NVDA", "xyz:TSLA"]),
    );
  });

  it("uses HIP-3 dex prefixes only for equities", () => {
    expect(hyperliquidDex("ETH")).toBe("");
    expect(hyperliquidDex("xyz:NVDA")).toBe("xyz");
  });

  it("PAPER_ONLY blocks live Phoenix even if a signer is configured", () => {
    process.env.PAPER_ONLY = "true";
    process.env.LIVE_TRADING_ENABLED = "true";
    process.env.PHOENIX_ADAPTER_VERIFIED = "true";
    process.env.PHOENIX_API_URL = "https://example.invalid";
    process.env.PHOENIX_SOLANA_RPC = "https://example.invalid";
    process.env.PHOENIX_PRIVATE_KEY = "dummy";
    const executor = getExecutor(liveConfig());
    expect(liveConfig().liveTradingEnabled).toBe(false);
    expect(executor.name).toBe("paper");
    expect(executor.canTrade).toBe(false);
  });
});

describe("equal-dollar portfolio overlay", () => {
  const t0 = Date.UTC(2026, 0, 1);
  const step = 4 * 60 * 60 * 1000;
  const path = [
    { t: t0, equity: 1000 },
    { t: t0 + step, equity: 1100 },
    { t: t0 + 2 * step, equity: 1050 },
  ];

  it("doubles two identical sleeves and keeps the same Sharpe", () => {
    const one = scoreEquityPath(path, 1000, "one", ["A"]);
    const two = scoreEquityPath(overlayEqualDollar([path, path], 1000), 2000, "two", ["A", "B"]);
    expect(two.finalEquityUsd).toBeCloseTo(one.finalEquityUsd * 2, 8);
    expect(two.totalReturnPct).toBeCloseTo(one.totalReturnPct, 8);
    expect(two.sharpe).not.toBeNull();
    expect(two.sharpe).toBeCloseTo(one.sharpe as number, 8);
    expect(two.maxDrawdownPct).toBeCloseTo(one.maxDrawdownPct, 8);
  });

  it("holds unlisted sleeves in cash until their first bar", () => {
    const late = [
      { t: t0 + step, equity: 1000 },
      { t: t0 + 2 * step, equity: 1200 },
    ];
    const overlay = overlayEqualDollar([path, late], 1000);
    expect(overlay[0]).toEqual({ t: t0, equity: 2000 });
    expect(overlay[1]?.equity).toBe(2100);
    expect(overlay[2]?.equity).toBe(2250);
  });

  it("returns a null Sharpe on a flat cash book", () => {
    const flat = [
      { t: t0, equity: 1000 },
      { t: t0 + step, equity: 1000 },
    ];
    expect(scoreEquityPath(flat, 1000, "flat", ["CASH"]).sharpe).toBeNull();
  });
});

afterEach(() => {
  delete process.env.PAPER_ONLY;
  delete process.env.LIVE_TRADING_ENABLED;
  delete process.env.PHOENIX_ADAPTER_VERIFIED;
  delete process.env.PHOENIX_API_URL;
  delete process.env.PHOENIX_SOLANA_RPC;
  delete process.env.PHOENIX_PRIVATE_KEY;
});
