import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  FIFTEEN_MS,
  FOUR_HOUR_MS,
  MINUTE_MS,
  availableAt,
  closedOnly,
  fillIntervalGaps,
  isUsable,
  makeCandle,
  parseBinanceKlines,
  parseHyperliquidCandles,
  pathPrices,
  validateSeries,
} from "./candles";

describe("closed-candle availability", () => {
  it("does not use a candle before open+interval", () => {
    const candle = makeCandle({
      openTime: 1_700_000_000_000,
      intervalMs: FIFTEEN_MS,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
    });
    expect(availableAt(candle)).toBe(1_700_000_000_000 + FIFTEEN_MS);
    expect(isUsable(candle, candle.openTime)).toBe(false);
    expect(isUsable(candle, candle.openTime + FIFTEEN_MS - 1)).toBe(false);
    expect(isUsable(candle, candle.openTime + FIFTEEN_MS)).toBe(true);
  });

  it("drops a partial UTC daily bucket", () => {
    const open = Date.UTC(2026, 7, 23, 0, 0, 0);
    const candle = makeCandle({
      openTime: open,
      intervalMs: DAY_MS,
      open: 1,
      high: 2,
      low: 1,
      close: 1.5,
    });
    const midday = open + 13 * 60 * 60 * 1000;
    expect(closedOnly([candle], midday)).toHaveLength(0);
    expect(closedOnly([candle], open + DAY_MS)).toHaveLength(1);
  });

  it("fails closed on duplicate timestamps", () => {
    const a = makeCandle({
      openTime: 1000,
      intervalMs: MINUTE_MS,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
    });
    expect(validateSeries([a, { ...a }], MINUTE_MS)).toBe("duplicate_open_time");
  });

  it("walks low-first and high-first as a stress envelope", () => {
    const candle = makeCandle({
      openTime: 0,
      intervalMs: MINUTE_MS,
      open: 100,
      high: 102,
      low: 97,
      close: 101,
    });
    expect(pathPrices(candle, "low_first")).toEqual([100, 97, 102, 101]);
    expect(pathPrices(candle, "high_first")).toEqual([100, 102, 97, 101]);
  });

  it("parses Hyperliquid rows and rejects corrupt OHLC", () => {
    const good = parseHyperliquidCandles(
      [
        {
          t: 1000,
          T: 59999,
          o: "1",
          h: "2",
          l: "0.5",
          c: "1.5",
          v: "3",
          n: 1,
        },
      ],
      MINUTE_MS,
    );
    expect(good).toHaveLength(1);
    expect(() =>
      parseHyperliquidCandles(
        [{ t: 1000, T: 2, o: "2", h: "1", l: "0.5", c: "1.5", v: "1", n: 1 }],
        MINUTE_MS,
      ),
    ).toThrow(/corrupt_candle/);
  });

  it("parses Binance Vision klines and fills a 4h hole", () => {
    const rows = [
      [1_000, "10", "11", "9", "10.5", "1", 1_000 + FOUR_HOUR_MS - 1, "0", 2],
      [1_000 + 2 * FOUR_HOUR_MS, "10.5", "12", "10", "11", "1", 1_000 + 3 * FOUR_HOUR_MS - 1, "0", 2],
    ];
    const parsed = parseBinanceKlines(rows, FOUR_HOUR_MS);
    expect(parsed).toHaveLength(2);
    const filled = fillIntervalGaps(parsed, FOUR_HOUR_MS);
    expect(filled).toHaveLength(3);
    expect(filled[1].openTime).toBe(1_000 + FOUR_HOUR_MS);
    expect(filled[1].open).toBe(10.5);
    expect(filled[1].close).toBe(10.5);
  });
});
