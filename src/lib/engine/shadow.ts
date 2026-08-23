import { findExecutionGap, MINUTE_MS } from "./candles";
import {
  advanceBookOnCandle,
  bookInvariantErrors,
  createBook,
  flattenBook,
  syncBookToThesis,
} from "./grid";
import { evaluateHierarchy, isFifteenDecisionBoundary } from "./hierarchy";
import type { MarketSeries } from "./hierarchy";
import { EPOCH_ID, MANDATES, SPEC_HASH, VENUES } from "./spec";
import type {
  BookState,
  DryRunIntent,
  FillRecord,
  MandateId,
  MandateSummary,
  PathMode,
  RuntimeState,
} from "./types";

const PATHS: PathMode[] = ["low_first", "high_first"];
const MANDATE_IDS = Object.keys(MANDATES) as MandateId[];

export function createEmptyRuntime(now: number, epochStart: number): RuntimeState {
  const books: BookState[] = [];
  for (const mandate of MANDATE_IDS) {
    for (const venue of VENUES) {
      for (const path of PATHS) {
        books.push(createBook(mandate, venue.id, path));
      }
    }
  }
  return {
    epoch: EPOCH_ID,
    specHash: SPEC_HASH,
    createdAt: now,
    updatedAt: now,
    executionCursor: epochStart - MINUTE_MS,
    epochStartOpenTime: epochStart,
    marketSource: "hyperliquid_public",
    paperDurationMs: 0,
    independentLongTransitions: 0,
    lastHierarchy: null,
    books,
    intents: [],
    events: [
      {
        time: now,
        type: "epoch_start",
        message:
          "Phase 7.9 readiness epoch created. Conservative LONG is the selected candidate. live_actions_enabled remains false.",
      },
    ],
    paperKillSwitch: false,
    invariants: {
      everShort: false,
      everLiquidated: false,
      exposureCapBreached: false,
    },
  };
}

function summarizeMandate(books: BookState[], mandate: MandateId): MandateSummary {
  const subset = books.filter((book) => book.mandate === mandate);
  const spec = MANDATES[mandate];
  const byPath = (path: PathMode) =>
    subset.filter((book) => book.pathMode === path);
  const nav = (path: PathMode) =>
    byPath(path).reduce((sum, book) => sum + book.capitalUsd + book.totalPnl, 0);
  const lowNav = nav("low_first");
  const highNav = nav("high_first");
  const worstPathNav = Math.min(lowNav, highNav);
  const bestPathNav = Math.max(lowNav, highNav);
  const worstBooks = lowNav <= highNav ? byPath("low_first") : byPath("high_first");
  const sample = subset[0];
  return {
    mandate,
    name: spec.name,
    role: spec.role,
    selected: mandate === "conservative",
    targetNotionalPerVenue: sample?.targetNotional ?? 0,
    targetNotionalAggregate: (sample?.targetNotional ?? 0) * VENUES.length,
    immediateNotionalPerVenue: sample?.immediateNotional ?? 0,
    gridRemainderPerVenue: Math.max(
      0,
      (sample?.targetNotional ?? 0) - (sample?.immediateNotional ?? 0),
    ),
    worstPathNav,
    worstPathPnl: worstPathNav - spec.startingNavUsd,
    bestPathNav,
    gridHarvestGross: worstBooks.reduce((sum, book) => sum + book.gridHarvestGross, 0),
    inventoryMtmPnl: worstBooks.reduce((sum, book) => sum + book.inventoryMtmPnl, 0),
    fees: worstBooks.reduce((sum, book) => sum + book.fees, 0),
    funding: 0,
    maxExposureUsd: Math.max(0, ...subset.map((book) => book.exposureUsd)),
    minBufferPct: Math.min(1, ...subset.map((book) => book.liquidationBufferPct)),
    everShort: subset.some((book) => book.inventoryBtc < -1e-8),
    everLiquidated: subset.some((book) => book.pauseReason === "liquidation_buffer_breach"),
    exposureCapBreached: subset.some((book) =>
      bookInvariantErrors(book).includes("exposure_cap_breached"),
    ),
    deploymentStatus: sample?.deploymentStatus ?? "flat",
    books: subset,
  };
}

export function mandateSummaries(state: RuntimeState): MandateSummary[] {
  return MANDATE_IDS.map((id) => summarizeMandate(state.books, id));
}

export function advanceRuntime(
  state: RuntimeState,
  series: MarketSeries,
  marketSource: RuntimeState["marketSource"],
  paperKill: boolean,
): RuntimeState {
  const candles = series.oneMinute.filter(
    (candle) => candle.openTime >= state.epochStartOpenTime && candle.openTime > state.executionCursor,
  );
  if (!candles.length) {
    return {
      ...state,
      marketSource,
      paperKillSwitch: paperKill,
      updatedAt: Date.now(),
    };
  }

  const gap = findExecutionGap(
    series.oneMinute.filter((candle) => candle.openTime >= state.epochStartOpenTime),
    MINUTE_MS,
  );

  const next: RuntimeState = {
    ...state,
    marketSource,
    paperKillSwitch: paperKill,
    books: state.books.map((book) => ({ ...book, workingOrders: [...book.workingOrders] })),
    intents: [...state.intents],
    events: [...state.events],
  };

  let previousThesis = state.lastHierarchy?.thesis ?? "FLAT";

  if (gap) {
    const fills: FillRecord[] = [];
    const intents: DryRunIntent[] = [];
    next.books = next.books.map((book) =>
      flattenBook(
        book,
        candles[0].open,
        candles[0].openTime,
        "one_minute_gap",
        fills,
        intents,
      ),
    );
    next.events.push({
      time: candles[0].openTime,
      type: "data_gap",
      message: `Fail-closed on a 1m gap from ${new Date(gap.from).toISOString()} to ${new Date(gap.to).toISOString()}.`,
    });
    next.intents.push(...intents);
    next.lastHierarchy = {
      ...(next.lastHierarchy ?? evaluateHierarchy(series, candles[0].openTime)),
      thesis: "FLAT",
      hardHalt: true,
      haltReason: "one_minute_gap",
      dataEligible: false,
      ineligibilityReason: "one_minute_gap",
    };
  }

  for (const candle of candles) {
    const actionTime = candle.openTime;
    const shouldDecide = isFifteenDecisionBoundary(actionTime) || !next.lastHierarchy;
    const decision = shouldDecide
      ? evaluateHierarchy(series, actionTime)
      : next.lastHierarchy;
    if (!decision) {
      continue;
    }
    const longTransition =
      isFifteenDecisionBoundary(actionTime) &&
      next.lastHierarchy !== null &&
      previousThesis !== "LONG" &&
      decision.thesis === "LONG";

    if (shouldDecide) {
      if (longTransition && marketSource === "hyperliquid_public") {
        next.independentLongTransitions += 1;
        next.events.push({
          time: actionTime,
          type: "long_transition",
          message: `Independent closed-candle LONG transition #${next.independentLongTransitions}.`,
        });
      }
      if (
        previousThesis === "LONG" &&
        decision.thesis !== "LONG" &&
        isFifteenDecisionBoundary(actionTime)
      ) {
        next.events.push({
          time: actionTime,
          type: "flatten_thesis",
          message: `LONG thesis lost (${decision.haltReason ?? decision.ineligibilityReason ?? "not_long"}). Reduce-only flatten.`,
        });
      }
      previousThesis = decision.thesis;
      next.lastHierarchy = decision;

      const fills: FillRecord[] = [];
      const intents: DryRunIntent[] = [];
      next.books = next.books.map((book) =>
        syncBookToThesis(
          book,
          {
            thesisLong: decision.thesis === "LONG",
            hardHalt: decision.hardHalt,
            dataEligible: decision.dataEligible,
            extensionScore: decision.extensionScore,
            pace: decision.pace,
            mark: candle.open,
            time: actionTime,
            paperKill,
            longTransition,
          },
          fills,
          intents,
        ),
      );
      next.intents.push(...intents);
    }

    const fills: FillRecord[] = [];
    next.books = next.books.map((book) => advanceBookOnCandle(book, candle, fills));
    next.executionCursor = candle.openTime;

    for (const book of next.books) {
      const errors = bookInvariantErrors(book);
      if (errors.includes("short_inventory") || book.inventoryBtc < -1e-8) {
        next.invariants.everShort = true;
      }
      if (errors.includes("exposure_cap_breached")) {
        next.invariants.exposureCapBreached = true;
      }
      if (book.pauseReason === "liquidation_buffer_breach") {
        next.invariants.everLiquidated = true;
      }
    }
  }

  const last = candles[candles.length - 1];
  next.paperDurationMs = Math.max(0, last.openTime - next.epochStartOpenTime);
  next.updatedAt = Date.now();
  next.intents = next.intents.slice(-250);
  next.events = next.events.slice(-200);
  return next;
}

export function applyPaperKill(state: RuntimeState, mark: number, time: number): RuntimeState {
  const fills: FillRecord[] = [];
  const intents: DryRunIntent[] = [];
  return {
    ...state,
    paperKillSwitch: true,
    books: state.books.map((book) =>
      flattenBook(book, mark, time, "paper_kill_switch", fills, intents),
    ),
    intents: [...state.intents, ...intents].slice(-250),
    events: [
      ...state.events,
      {
        time,
        type: "paper_kill",
        message:
          "Paper kill switch flattened simulated inventory. This does not cancel or submit exchange orders.",
      },
    ].slice(-200),
    updatedAt: Date.now(),
  };
}
