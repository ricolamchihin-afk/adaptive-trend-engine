import { describe, expect, it } from "vitest";
import { planAutoTick, trailStop, tpPrice, type AutoTickInput } from "./autoLoop";

const bar = { open: 80_000, high: 81_000, low: 79_000, close: 80_500 };

function tick(over: Partial<AutoTickInput>): AutoTickInput {
  return {
    killed: false,
    autoEnabled: true,
    canTrade: true,
    lastHandledBarMs: null,
    barOpenMs: 1_000,
    mark: 80_500,
    bar,
    phoenixSide: "FLAT",
    phoenixSizeBtc: 0,
    book: null,
    stop: null,
    tp: null,
    freshEntry: false,
    signalSide: "FLAT",
    openSizeBtc: 0,
    openStop: null,
    ...over,
  };
}

describe("planAutoTick", () => {
  it("does nothing when auto is off", () => {
    const r = planAutoTick(tick({ autoEnabled: false, freshEntry: true, signalSide: "LONG", openSizeBtc: 0.1 }));
    expect(r.action).toBe("HOLD");
  });

  it("opens a fresh long once per bar", () => {
    const r = planAutoTick(
      tick({
        freshEntry: true,
        signalSide: "LONG",
        openSizeBtc: 0.1,
        openStop: 78_000,
      }),
    );
    expect(r.action).toBe("OPEN_LONG");
    expect(r.lastHandledBarMs).toBe(1_000);
    expect(r.book?.sizeBtc).toBeCloseTo(0.1);
    const again = planAutoTick(tick({ lastHandledBarMs: 1_000, freshEntry: true, signalSide: "LONG", openSizeBtc: 0.1 }));
    expect(again.action).toBe("HOLD");
  });

  it("does not re-enter the same bar after a stop", () => {
    const r = planAutoTick(
      tick({
        lastHandledBarMs: 1_000,
        phoenixSide: "FLAT",
        freshEntry: true,
        signalSide: "LONG",
        openSizeBtc: 0.1,
      }),
    );
    expect(r.action).toBe("HOLD");
  });

  it("closes a long when mark hits the stop", () => {
    const r = planAutoTick(
      tick({
        phoenixSide: "LONG",
        phoenixSizeBtc: 0.11,
        stop: 80_600,
        mark: 80_500,
      }),
    );
    expect(r.action).toBe("CLOSE");
    expect(r.reason).toMatch(/stop/i);
    expect(r.closeSizeBtc).toBeCloseTo(0.11);
    expect(r.lastHandledBarMs).toBe(1_000);
  });

  it("closes a long when the 4h bar tags the trail", () => {
    const r = planAutoTick(
      tick({
        phoenixSide: "LONG",
        phoenixSizeBtc: 0.05,
        stop: 79_500,
        mark: 80_500,
        bar: { open: 80_000, high: 81_000, low: 79_400, close: 80_500 },
      }),
    );
    expect(r.action).toBe("CLOSE");
  });

  it("closes on take-profit", () => {
    const r = planAutoTick(
      tick({
        phoenixSide: "LONG",
        phoenixSizeBtc: 0.1,
        stop: 70_000,
        tp: 80_000,
        mark: 80_500,
      }),
    );
    expect(r.action).toBe("CLOSE");
    expect(r.reason).toMatch(/tp/i);
  });

  it("kill flattens even when auto is off", () => {
    const close = planAutoTick(
      tick({ autoEnabled: false, killed: true, phoenixSide: "LONG", phoenixSizeBtc: 0.05, stop: 90_000 }),
    );
    expect(close.action).toBe("CLOSE");
  });

  it("kill blocks new entries once flat", () => {
    const noOpen = planAutoTick(tick({ killed: true, freshEntry: true, signalSide: "LONG", openSizeBtc: 0.1 }));
    expect(noOpen.action).toBe("HOLD");
  });

  it("holds a live winner that has not hit stop or TP", () => {
    const r = planAutoTick(
      tick({
        phoenixSide: "LONG",
        phoenixSizeBtc: 0.1,
        stop: 78_000,
        tp: 90_000,
        mark: 81_000,
        bar: { open: 80_000, high: 81_200, low: 79_800, close: 81_000 },
      }),
    );
    expect(r.action).toBe("HOLD");
  });
});

describe("trailStop / tpPrice", () => {
  it("trails a long stop up, never down", () => {
    expect(trailStop("LONG", 70_000, 71_000, null)).toBe(71_000);
    expect(trailStop("LONG", 71_000, 70_500, null)).toBe(71_000);
  });

  it("places TP from ROE on the staked slice", () => {
    // 20% of $2000 on 0.1 BTC long from 80k → +$400 / 0.1 = +$4000 → 84k
    expect(tpPrice("LONG", 80_000, 0.1, 2_000, 20)).toBeCloseTo(84_000, 6);
  });
});
