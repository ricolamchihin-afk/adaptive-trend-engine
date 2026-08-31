import { describe, expect, it } from "vitest";
import { FOUR_HOUR_MS, HOUR_MS, makeCandle } from "./candles";
import { parseBinanceKlines, parseYahooChart, resample } from "./feeds";

describe("public candle parsers", () => {
  it("parses Binance/Aster kline rows", () => {
    const candles = parseBinanceKlines(
      [[1_700_000_000_000, "10", "12", "9", "11", "100", 1_700_014_399_999]],
      FOUR_HOUR_MS,
    );
    expect(candles).toHaveLength(1);
    expect(candles[0].open).toBe(10);
    expect(candles[0].high).toBe(12);
    expect(candles[0].close).toBe(11);
    expect(candles[0].intervalMs).toBe(FOUR_HOUR_MS);
  });

  it("parses Yahoo chart payloads and skips null bars", () => {
    const candles = parseYahooChart(
      {
        chart: {
          result: [
            {
              timestamp: [1_700_000_000, 1_700_086_400],
              indicators: {
                quote: [
                  {
                    open: [100, null],
                    high: [101, null],
                    low: [99, null],
                    close: [100.5, null],
                    volume: [10, null],
                  },
                ],
              },
            },
          ],
        },
      },
      86_400_000,
    );
    expect(candles).toHaveLength(1);
    expect(candles[0].openTime).toBe(1_700_000_000_000);
    expect(candles[0].close).toBe(100.5);
  });

  it("resamples hourly bars into UTC 4h buckets", () => {
    const t0 = Date.UTC(2026, 0, 2, 14, 30);
    const hourly = [
      makeCandle({ openTime: t0, intervalMs: HOUR_MS, open: 10, high: 11, low: 9, close: 10.5, volume: 1 }),
      makeCandle({
        openTime: t0 + HOUR_MS,
        intervalMs: HOUR_MS,
        open: 10.5,
        high: 12,
        low: 10,
        close: 11,
        volume: 2,
      }),
    ];
    const four = resample(hourly, FOUR_HOUR_MS);
    expect(four).toHaveLength(1);
    expect(four[0].open).toBe(10);
    expect(four[0].high).toBe(12);
    expect(four[0].low).toBe(9);
    expect(four[0].close).toBe(11);
    expect(four[0].volume).toBe(3);
  });
});
