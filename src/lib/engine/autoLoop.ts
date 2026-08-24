import type { Regime } from "./types";

export type AutoAction = "HOLD" | "OPEN_LONG" | "OPEN_SHORT" | "CLOSE";

export interface AutoBook {
  side: "LONG" | "SHORT";
  sizeBtc: number;
  entry: number;
  stop: number;
  tp: number | null;
  openedBarMs: number;
}

export interface AutoBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface AutoTickInput {
  killed: boolean;
  autoEnabled: boolean;
  canTrade: boolean;
  lastHandledBarMs: number | null;
  barOpenMs: number;
  mark: number;
  bar: AutoBar;
  phoenixSide: "LONG" | "SHORT" | "FLAT";
  phoenixSizeBtc: number;
  book: AutoBook | null;
  // Trailed stop from the last closed Donchian exit channel (already max/min'd).
  stop: number | null;
  tp: number | null;
  freshEntry: boolean;
  signalSide: Regime;
  openSizeBtc: number;
  openStop: number | null;
}

export interface AutoTickResult {
  action: AutoAction;
  reason: string;
  lastHandledBarMs: number | null;
  book: AutoBook | null;
  closeSizeBtc: number;
  closeSide: "LONG" | "SHORT" | "FLAT";
}

function longExit(mark: number, bar: AutoBar, stop: number | null, tp: number | null): string | null {
  if (stop !== null && (mark <= stop || bar.low <= stop || bar.open <= stop)) return "stop";
  if (tp !== null && (mark >= tp || bar.high >= tp || bar.open >= tp)) return "tp";
  return null;
}

function shortExit(mark: number, bar: AutoBar, stop: number | null, tp: number | null): string | null {
  if (stop !== null && (mark >= stop || bar.high >= stop || bar.open >= stop)) return "stop";
  if (tp !== null && (mark <= tp || bar.low <= tp || bar.open <= tp)) return "tp";
  return null;
}

function hold(
  reason: string,
  lastHandledBarMs: number | null,
  book: AutoBook | null,
): AutoTickResult {
  return {
    action: "HOLD",
    reason,
    lastHandledBarMs,
    book,
    closeSizeBtc: 0,
    closeSide: "FLAT",
  };
}

// One poll of the live book: flatten if the stop/TP is hit, otherwise open only on
// a fresh Donchian bar we have not already handled. Kill always wins over entries.
export function planAutoTick(i: AutoTickInput): AutoTickResult {
  const inMarket = i.phoenixSide === "LONG" || i.phoenixSide === "SHORT";
  const size = Math.abs(i.phoenixSizeBtc) > 0 ? Math.abs(i.phoenixSizeBtc) : Math.abs(i.book?.sizeBtc ?? 0);
  const book = i.book;

  if (inMarket && i.canTrade) {
    const why =
      i.phoenixSide === "LONG"
        ? longExit(i.mark, i.bar, i.stop, i.tp)
        : shortExit(i.mark, i.bar, i.stop, i.tp);
    const flatten = i.killed || why !== null;
    if (flatten) {
      return {
        action: "CLOSE",
        reason: i.killed ? "Kill switch — flatten Phoenix." : `${i.phoenixSide} ${why}.`,
        lastHandledBarMs: i.barOpenMs,
        book: null,
        closeSizeBtc: size,
        closeSide: i.phoenixSide,
      };
    }
  }

  if (!i.autoEnabled) return hold("Auto 4h loop off (LIVE_AUTO_4H).", i.lastHandledBarMs, book);
  if (!i.canTrade) return hold("Live submit not armed.", i.lastHandledBarMs, book);

  if (inMarket) {
    return hold("In market; stop/TP not hit.", i.lastHandledBarMs, book);
  }

  if (i.killed) return hold("Kill switch on — no new entries.", i.lastHandledBarMs, null);

  if (i.lastHandledBarMs === i.barOpenMs) {
    return hold("This 4h bar already handled.", i.lastHandledBarMs, null);
  }
  if (
    i.freshEntry &&
    (i.signalSide === "LONG" || i.signalSide === "SHORT") &&
    i.openSizeBtc !== 0
  ) {
    const side = i.signalSide;
    return {
      action: side === "LONG" ? "OPEN_LONG" : "OPEN_SHORT",
      reason: `Fresh Donchian ${side.toLowerCase()} on this 4h bar.`,
      lastHandledBarMs: i.barOpenMs,
      book: {
        side,
        sizeBtc: Math.abs(i.openSizeBtc),
        entry: i.mark,
        stop: i.openStop ?? i.mark,
        tp: i.tp,
        openedBarMs: i.barOpenMs,
      },
      closeSizeBtc: 0,
      closeSide: "FLAT",
    };
  }
  return hold("No new Donchian breakout.", i.lastHandledBarMs, null);
}

export function trailStop(
  side: "LONG" | "SHORT",
  currentStop: number | null,
  exitLow: number | null,
  exitHigh: number | null,
): number | null {
  if (side === "LONG") {
    if (currentStop === null) return exitLow;
    if (exitLow === null) return currentStop;
    return Math.max(currentStop, exitLow);
  }
  if (currentStop === null) return exitHigh;
  if (exitHigh === null) return currentStop;
  return Math.min(currentStop, exitHigh);
}

export function tpPrice(
  side: "LONG" | "SHORT",
  entry: number,
  sizeBtc: number,
  entryEquity: number,
  roePct: number,
): number | null {
  if (sizeBtc <= 0 || entryEquity <= 0 || roePct <= 0) return null;
  const signed = side === "LONG" ? sizeBtc : -sizeBtc;
  return entry + ((roePct / 100) * entryEquity) / signed;
}
