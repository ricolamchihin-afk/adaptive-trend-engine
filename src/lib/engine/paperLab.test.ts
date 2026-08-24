import { afterEach, describe, expect, it } from "vitest";
import { getExecutor } from "./executor";
import { liveConfig } from "./liveConfig";
import { hyperliquidDex } from "./market-data";
import { PAPER_BOOKS } from "./paperBooks";

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

afterEach(() => {
  delete process.env.PAPER_ONLY;
  delete process.env.LIVE_TRADING_ENABLED;
  delete process.env.PHOENIX_ADAPTER_VERIFIED;
  delete process.env.PHOENIX_API_URL;
  delete process.env.PHOENIX_SOLANA_RPC;
  delete process.env.PHOENIX_PRIVATE_KEY;
});
