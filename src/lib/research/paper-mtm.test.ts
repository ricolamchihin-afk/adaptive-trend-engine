import { describe, expect, it } from "vitest";
import { LIVE_ACTIONS_ENABLED, PRODUCTION_BOUNDARY, SPEC_HASH, hashFrozenSpec } from "../engine/spec";
import {
  PAPER_ONLY,
  PAPER_OVERLAY,
  chooseWorkingTape,
  enterRowsFromBrief,
  scoreCioBrief,
  sizeEnterCard,
  waitRowsFromBrief,
  type CompactRow,
} from "./paper-mtm";

function row(extra: Partial<CompactRow> = {}): CompactRow {
  return {
    base: "AAPL",
    asterSymbol: "AAPLUSDT",
    cashTicker: "AAPL",
    mark: 200,
    action: "ENTER_LONG",
    atr: 2,
    ...extra,
  };
}

describe("paper-only research pack", () => {
  it("does not touch the frozen engine spec or live boundary", () => {
    expect(PAPER_ONLY).toBe(true);
    expect(LIVE_ACTIONS_ENABLED).toBe(false);
    expect(PRODUCTION_BOUNDARY.live_actions_enabled).toBe(false);
    expect(PRODUCTION_BOUNDARY.write_adapter).toBeNull();
    expect(hashFrozenSpec()).toBe(SPEC_HASH);
  });

  it("uses the existing overlay: $10k, $100 risk, 1.5R/2R, 20x cap", () => {
    expect(PAPER_OVERLAY.equityUsd).toBe(10_000);
    expect(PAPER_OVERLAY.stopRiskUsd).toBe(100);
    expect(PAPER_OVERLAY.tpR).toEqual([1.5, 2]);
    expect(PAPER_OVERLAY.maxLeverage).toBe(20);
    expect(PAPER_OVERLAY.atrStopMult).toBe(3);
  });
});

describe("sizeEnterCard", () => {
  it("sizes ENTER_LONG at $100 / (3×ATR) and places TP in price", () => {
    const card = sizeEnterCard(row());
    expect(card).not.toBeNull();
    expect(card?.qty).toBeCloseTo(100 / 6, 10);
    expect(card?.stop).toBeCloseTo(194, 10);
    expect(card?.tp1).toBeCloseTo(209, 10);
    expect(card?.tp2).toBeCloseTo(212, 10);
    expect(card?.rescaled).toBe(false);
  });

  it("rescales when $100 risk would exceed 20×", () => {
    const card = sizeEnterCard(row({ mark: 100, atr: 0.01 }));
    expect(card).not.toBeNull();
    expect(card?.leverage).toBeCloseTo(20, 10);
    expect(card?.notional).toBeCloseTo(200_000, 6);
    expect(card?.rescaled).toBe(true);
  });

  it("returns no sized card on WAIT or FLAT", () => {
    expect(sizeEnterCard(row({ action: "WAIT" }))).toBeNull();
    expect(sizeEnterCard(row({ action: "FLAT" }))).toBeNull();
  });
});

describe("chooseWorkingTape", () => {
  it("keeps Yahoo when the cash print is up", () => {
    expect(chooseWorkingTape({ yahooOk: true, asterOk: true }).source).toBe("yahoo_public");
  });

  it("falls to Aster klines on Yahoo 429 — does not invent a print", () => {
    const tape = chooseWorkingTape({ yahooOk: false, yahooStatus: 429, asterOk: true });
    expect(tape).toEqual({ source: "aster_public", reason: "yahoo_429_aster_klines" });
  });

  it("is unavailable when both tapes miss", () => {
    expect(chooseWorkingTape({ yahooOk: false, yahooStatus: 429, asterOk: false }).source).toBe(
      "unavailable",
    );
  });
});

describe("scoreCioBrief", () => {
  const brief = {
    paperOnly: true,
    enterLong: [row({ base: "AAPL", asterSymbol: "AAPLUSDT", mark: 200, atr: 2 })],
    enterShort: [],
    waitLong: [row({ base: "MSFT", action: "WAIT", mark: 400, atr: 3 })],
    waitShort: [],
  };

  it("marks ENTER inventory and never sizes WAIT", () => {
    const scored = scoreCioBrief(brief, { AAPL: 206 });
    expect(scored.waitCount).toBe(1);
    expect(scored.skippedWait).toBe(1);
    expect(scored.sized).toHaveLength(1);
    expect(waitRowsFromBrief(brief)[0]?.action).toBe("WAIT");
    expect(enterRowsFromBrief(brief)).toHaveLength(1);
    expect(sizeEnterCard(waitRowsFromBrief(brief)[0])).toBeNull();
    // qty = 100/6; pnl = (100/6) * 6 = 100 → +1% on 10k
    expect(scored.returnPct).toBeCloseTo(1, 8);
    expect(scored.endingValue).toBeCloseTo(10_100, 6);
    expect(scored.finalScore).toBeCloseTo(1, 8);
    expect(scored.markedToMarket).toBe(true);
  });

  it("does not promote WAIT even if a later mark is supplied for it", () => {
    const scored = scoreCioBrief(brief, { AAPL: 200, MSFT: 500 });
    expect(scored.sized.map((c) => c.base)).toEqual(["AAPL"]);
    expect(scored.returnPct).toBeCloseTo(0, 8);
  });

  it("gives no rank score when the snapshot has no ENTER", () => {
    const empty = scoreCioBrief({ waitLong: [row({ action: "WAIT" })] }, { AAPL: 210 });
    expect(empty.tradeCount).toBe(0);
    expect(empty.finalScore).toBeNull();
    expect(empty.sized).toHaveLength(0);
  });
});
