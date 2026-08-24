import { describe, expect, it } from "vitest";
import { btcMarkFromAssetCtx } from "./market-data";

function ctx(btc: Record<string, string>, extras: Array<{ name: string; ctx: Record<string, string> }> = []) {
  const universe = [{ name: "ETH" }, { name: "BTC" }, ...extras.map((e) => ({ name: e.name }))];
  const ctxs = [{ markPx: "1" }, btc, ...extras.map((e) => e.ctx)];
  return [{ universe }, ctxs];
}

describe("btcMarkFromAssetCtx", () => {
  it("reads BTC markPx from metaAndAssetCtxs", () => {
    expect(btcMarkFromAssetCtx(ctx({ markPx: "111234.5", funding: "0.0001" }))).toBe(111234.5);
  });

  it("falls back to midPx then oraclePx", () => {
    expect(btcMarkFromAssetCtx(ctx({ midPx: "110000.25" }))).toBe(110000.25);
    expect(btcMarkFromAssetCtx(ctx({ oraclePx: "109000" }))).toBe(109000);
  });

  it("returns null when BTC is missing", () => {
    expect(btcMarkFromAssetCtx([{ universe: [{ name: "ETH" }] }, [{ markPx: "1" }]])).toBeNull();
    expect(btcMarkFromAssetCtx(null)).toBeNull();
  });
});
