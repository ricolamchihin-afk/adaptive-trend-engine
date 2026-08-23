import { describe, expect, it } from "vitest";
import { makeCandle, MINUTE_MS } from "./candles";
import {
  advanceBookOnCandle,
  bookInvariantErrors,
  createBook,
  flattenBook,
  syncBookToThesis,
} from "./grid";
import type { DryRunIntent, FillRecord } from "./types";

describe("persistent Conservative book", () => {
  it("deploys a staged long and never opens a short", () => {
    const fills: FillRecord[] = [];
    const intents: DryRunIntent[] = [];
    let book = createBook("conservative", "decibel", "low_first");
    book = syncBookToThesis(
      book,
      {
        thesisLong: true,
        hardHalt: false,
        dataEligible: true,
        extensionScore: 100,
        pace: 0.25,
        mark: 100_000,
        time: 1_000,
        paperKill: false,
        longTransition: true,
      },
      fills,
      intents,
    );
    expect(book.inventoryBtc).toBeGreaterThan(0);
    expect(book.exposureUsd).toBeGreaterThan(90);
    expect(book.exposureUsd).toBeLessThan(120);
    expect(book.workingOrders.every((order) => order.side === "sell" ? order.reduceOnly : true)).toBe(true);
    expect(intents.every((intent) => intent.liveSubmitted === false)).toBe(true);
    expect(bookInvariantErrors(book)).toEqual([]);
  });

  it("flattens on loss of LONG thesis", () => {
    const fills: FillRecord[] = [];
    const intents: DryRunIntent[] = [];
    let book = createBook("conservative", "phoenix", "high_first");
    book = syncBookToThesis(
      book,
      {
        thesisLong: true,
        hardHalt: false,
        dataEligible: true,
        extensionScore: 0,
        pace: 1,
        mark: 100_000,
        time: 1_000,
        paperKill: false,
        longTransition: true,
      },
      fills,
      intents,
    );
    expect(book.inventoryBtc).toBeGreaterThan(0);
    book = syncBookToThesis(
      book,
      {
        thesisLong: false,
        hardHalt: false,
        dataEligible: true,
        extensionScore: 0,
        pace: 1,
        mark: 100_500,
        time: 2_000,
        paperKill: false,
        longTransition: false,
      },
      fills,
      intents,
    );
    expect(book.inventoryBtc).toBe(0);
    expect(book.paused).toBe(true);
    expect(book.pauseReason).toBe("thesis_not_long");
    expect(book.flattenEvents).toBeGreaterThan(0);
    expect(intents.some((intent) => intent.kind === "flatten" && intent.reduceOnly)).toBe(true);
  });

  it("keeps the P&L identity after a round-trip fill", () => {
    const fills: FillRecord[] = [];
    let book = createBook("conservative", "n1", "low_first");
    book = syncBookToThesis(
      book,
      {
        thesisLong: true,
        hardHalt: false,
        dataEligible: true,
        extensionScore: 80,
        pace: 0.5,
        mark: 100_000,
        time: 0,
        paperKill: false,
        longTransition: true,
      },
      fills,
      [],
    );
    const candle = makeCandle({
      openTime: MINUTE_MS,
      intervalMs: MINUTE_MS,
      open: 100_000,
      high: 101_000,
      low: 99_000,
      close: 100_200,
    });
    book = advanceBookOnCandle(book, candle, fills);
    const identity = book.gridHarvestGross + book.inventoryMtmPnl - book.fees + book.funding;
    expect(Math.abs(identity - book.totalPnl)).toBeLessThan(1.5);
    expect(book.inventoryBtc).toBeGreaterThanOrEqual(0);
    expect(flattenBook(book, candle.close, candle.openTime, "test", [], []).inventoryBtc).toBe(0);
  });
});
