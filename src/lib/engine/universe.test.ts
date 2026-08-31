import { describe, expect, it } from "vitest";
import {
  asterEquityBases,
  cashTickerFor,
  describeRoute,
  resolveAgainstUniverse,
  resolveSymbol,
  stripQuote,
} from "./universe";

describe("symbol router", () => {
  it("routes US stocks to Yahoo cash and an Aster perp", () => {
    const aapl = resolveSymbol("AAPLUSDT");
    expect(aapl.assetClass).toBe("equity");
    expect(aapl.cashTicker).toBe("AAPL");
    expect(aapl.preferredFeed).toBe("yahoo");
    expect(aapl.asterSymbol).toBe("AAPLUSDT");
    expect(aapl.binanceSymbol).toBeNull();
  });

  it("routes crypto to Binance then Hyperliquid", () => {
    const btc = resolveSymbol("btc");
    expect(btc.assetClass).toBe("crypto");
    expect(btc.preferredFeed).toBe("binance");
    expect(btc.fallbackFeeds).toEqual(["hyperliquid", "aster"]);
    expect(btc.hyperliquidCoin).toBe("BTC");
    expect(btc.asterSymbol).toBe("BTCUSDT");
  });

  it("maps Aster aliases onto cash tickers", () => {
    expect(cashTickerFor("PAYP")).toBe("PYPL");
    expect(cashTickerFor("BRKB")).toBe("BRK-B");
    expect(stripQuote("nvda-usdt")).toBe("NVDA");
  });

  it("uses a live Aster STOCK list when provided", () => {
    const live = resolveAgainstUniverse("SNDK", {
      fetchedAt: 1,
      stockBases: ["SNDK"],
      etfBases: [],
      commodityBases: [],
      cryptoBases: ["BTC"],
    });
    expect(live.assetClass).toBe("equity");
    expect(live.preferredFeed).toBe("yahoo");
    expect(live.asterSymbol).toBe("SNDKUSDT");
  });

  it("unions STOCK and ETF bases for the equity population", () => {
    expect(
      asterEquityBases({
        fetchedAt: 1,
        stockBases: ["AAPL", "QQQ"],
        etfBases: ["QQQ", "SPY"],
        commodityBases: [],
        cryptoBases: [],
      }),
    ).toEqual(["AAPL", "QQQ", "SPY"]);
  });

  it("describes every asset class", () => {
    expect(describeRoute("crypto")).toMatch(/Binance/);
    expect(describeRoute("equity")).toMatch(/US/);
    expect(describeRoute("commodity")).toMatch(/cash/);
    expect(describeRoute("unknown")).toMatch(/Unclassified/);
  });
});
