import { describe, expect, it } from "vitest";
import { buildPopulation, summarizeScreens, type ScreenRow } from "./screen";
import { evaluateSetup } from "./decide";
import { defaultSimConfig } from "./simulate";
import { FOUR_HOUR_MS, makeCandle } from "./candles";
import type { Feature } from "./strategy";

function row(bias: ScreenRow["setup"]["bias"], action: ScreenRow["setup"]["action"], error: string | null = null): ScreenRow {
  return {
    base: "X",
    asterSymbol: "XUSDT",
    cashTicker: "X",
    source: "yahoo_public",
    mark: 1,
    warning: null,
    setup: {
      bias,
      action,
      reasons: [],
      gates: {
        dailyDir: 0,
        adxOk: true,
        rsiOk: true,
        macdOk: true,
        slopeOk: true,
        atrOk: true,
        donchianReady: true,
        breakout: action.startsWith("ENTER"),
      },
    },
    indicators: {
      dailyDir: 0,
      dailyEmaSlopePct: null,
      entryHigh: null,
      entryLow: null,
      atr: null,
      adx: null,
      rsi: null,
      macdHist: null,
      close: null,
      barOpenTime: null,
    },
    error,
  };
}

describe("equity screen summary", () => {
  it("counts bias, action, and failures against the full population", () => {
    const screens = [
      row("LONG", "WAIT"),
      row("LONG", "ENTER_LONG"),
      row("SHORT", "FLAT"),
      row("FLAT", "FLAT", "yahoo_empty"),
    ];
    const summary = summarizeScreens(screens, 112);
    expect(summary.population).toBe(112);
    expect(summary.screened).toBe(4);
    expect(summary.failed).toBe(1);
    expect(summary.LONG).toBe(2);
    expect(summary.SHORT).toBe(1);
    expect(summary.FLAT).toBe(1);
    expect(summary.ENTER_LONG).toBe(1);
    expect(summary.WAIT).toBe(1);
  });

  it("builds the Aster equity population from STOCK + ETF bases", () => {
    const population = buildPopulation({
      fetchedAt: 1,
      stockBases: ["AAPL", "NVDA", "QQQ"],
      etfBases: ["QQQ"],
      commodityBases: ["XAU"],
      cryptoBases: ["BTC"],
    });
    expect(population.map((row) => row.base)).toEqual(["AAPL", "NVDA", "QQQ"]);
    expect(population.find((row) => row.base === "QQQ")?.subTypes).toEqual(["STOCK", "ETF"]);
    expect(population.find((row) => row.base === "AAPL")?.asterSymbol).toBe("AAPLUSDT");
  });

  it("keeps screen actions on the shared entry gates", () => {
    const feature: Feature = {
      candle: makeCandle({
        openTime: Date.UTC(2026, 0, 2),
        intervalMs: FOUR_HOUR_MS,
        open: 100,
        high: 111,
        low: 99,
        close: 110,
      }),
      entryHigh: 109,
      entryLow: 90,
      exitHigh: 108,
      exitLow: 92,
      atr: 2,
      adx: 20,
      rsi: 55,
      macdHist: 1,
      dailyDir: 1,
      dailyEmaSlopePct: 1,
    };
    expect(evaluateSetup(feature, defaultSimConfig()).action).toBe("ENTER_LONG");
  });
});
