import { pathPrices } from "./candles";
import { liquidationBufferPct } from "./sizing";
import { MANDATES, SHARED_CONTROLS, VENUES, maxNotionalUsd } from "./spec";
import type {
  BookState,
  Candle,
  DryRunIntent,
  FillRecord,
  MandateId,
  PathMode,
  VenueId,
  WorkingOrder,
} from "./types";
import { qtyForNotional, roundLot } from "./sizing";

export interface ApplyResult {
  book: BookState;
  fills: FillRecord[];
  intents: DryRunIntent[];
}

function venueFees(venue: VenueId) {
  const spec = VENUES.find((item) => item.id === venue);
  if (!spec) {
    throw new Error(`unknown_venue:${venue}`);
  }
  return spec;
}

function feeRate(venue: VenueId, role: "maker" | "taker"): number {
  const spec = venueFees(venue);
  const bps = role === "maker" ? spec.makerFeeBps : spec.takerFeeBps;
  return bps / 10_000;
}

function emptyBook(
  mandate: MandateId,
  venue: VenueId,
  pathMode: PathMode,
): BookState {
  return {
    mandate,
    venue,
    pathMode,
    capitalUsd: MANDATES[mandate].venueCapitalUsd,
    cashUsd: MANDATES[mandate].venueCapitalUsd,
    inventoryBtc: 0,
    avgEntry: 0,
    anchorPrice: 0,
    lastMark: 0,
    paused: false,
    pauseReason: null,
    targetNotional: 0,
    immediateNotional: 0,
    exposureUsd: 0,
    gridHarvestGross: 0,
    inventoryMtmPnl: 0,
    fees: 0,
    funding: 0,
    totalPnl: 0,
    liquidationBufferPct: 1,
    deploymentStatus: "flat",
    workingOrders: [],
    lastFillTime: null,
    flattenEvents: 0,
    starterFills: 0,
    longTransitionCount: 0,
  };
}

export function createBook(
  mandate: MandateId,
  venue: VenueId,
  pathMode: PathMode,
): BookState {
  return emptyBook(mandate, venue, pathMode);
}

function markToMarket(book: BookState, mark: number): BookState {
  const inventoryMtmPnl =
    book.inventoryBtc === 0 ? 0 : book.inventoryBtc * (mark - book.avgEntry);
  const equity = book.cashUsd + book.inventoryBtc * mark;
  const totalPnl = equity - book.capitalUsd;
  const exposureUsd = book.inventoryBtc * mark;
  const buffer = liquidationBufferPct(
    mark,
    book.avgEntry,
    book.inventoryBtc,
    equity,
  );
  return {
    ...book,
    lastMark: mark,
    inventoryMtmPnl,
    totalPnl,
    exposureUsd,
    liquidationBufferPct: buffer,
    funding: SHARED_CONTROLS.fundingPlaceholderUsd,
  };
}

function deploymentStatus(book: BookState, thesisLong: boolean): string {
  if (book.paused) {
    return `paused:${book.pauseReason ?? "unspecified"}`;
  }
  if (!thesisLong && book.inventoryBtc <= 0) {
    return "flat";
  }
  if (book.inventoryBtc <= 0) {
    return "long_pending_fill";
  }
  const gap = book.targetNotional - book.exposureUsd;
  if (gap <= SHARED_CONTROLS.minNotionalUsd) {
    return "long_at_target";
  }
  if (book.exposureUsd < book.immediateNotional * 0.8) {
    return "long_staging_immediate";
  }
  return "long_grid_working";
}

function clientOrderId(parts: Array<string | number>): string {
  return parts.join("|");
}

function placeOrder(
  book: BookState,
  order: WorkingOrder,
  time: number,
  intents: DryRunIntent[],
): BookState {
  const exists = book.workingOrders.some((item) => item.id === order.id);
  if (exists) {
    return book;
  }
  intents.push({
    clientOrderId: order.id,
    time,
    mandate: book.mandate,
    venue: book.venue,
    pathMode: book.pathMode,
    kind: order.kind,
    side: order.side,
    price: order.price,
    qty: order.qty,
    reduceOnly: order.reduceOnly,
    liveSubmitted: false,
    note: "Dry-run intent only. Compared with the shadow book; never sent.",
  });
  return { ...book, workingOrders: [...book.workingOrders, order] };
}

function applyFill(
  book: BookState,
  fill: FillRecord,
): BookState {
  let cashUsd = book.cashUsd;
  let inventoryBtc = book.inventoryBtc;
  let avgEntry = book.avgEntry;
  let gridHarvestGross = book.gridHarvestGross;
  const fees = book.fees + fill.feeUsd;
  let starterFills = book.starterFills;
  let flattenEvents = book.flattenEvents;

  if (fill.side === "buy") {
    if (fill.reduceOnly) {
      return book;
    }
    const cost = fill.price * fill.qty + fill.feeUsd;
    const newInventory = inventoryBtc + fill.qty;
    avgEntry =
      newInventory <= 0
        ? 0
        : (inventoryBtc * avgEntry + fill.price * fill.qty) / newInventory;
    inventoryBtc = newInventory;
    cashUsd -= cost;
    if (fill.kind === "market_starter") {
      starterFills += 1;
    }
  } else {
    const sellQty = Math.min(fill.qty, inventoryBtc);
    if (sellQty <= 0) {
      return { ...book, workingOrders: book.workingOrders.filter((o) => o.id !== fill.orderId) };
    }
    const realized = (fill.price - avgEntry) * sellQty;
    gridHarvestGross += realized;
    cashUsd += fill.price * sellQty - fill.feeUsd;
    inventoryBtc = roundLot(inventoryBtc - sellQty);
    if (inventoryBtc <= 0) {
      inventoryBtc = 0;
      avgEntry = 0;
    }
    if (fill.kind === "flatten") {
      flattenEvents += 1;
    }
  }

  return {
    ...book,
    cashUsd,
    inventoryBtc,
    avgEntry,
    gridHarvestGross,
    fees,
    starterFills,
    flattenEvents,
    lastFillTime: fill.time,
    workingOrders: book.workingOrders.filter((order) => order.id !== fill.orderId),
  };
}

function maybeFill(
  book: BookState,
  price: number,
  time: number,
  fills: FillRecord[],
): BookState {
  let next = book;
  const orders = [...next.workingOrders].sort((a, b) => {
    if (a.side === b.side) {
      return a.side === "buy" ? b.price - a.price : a.price - b.price;
    }
    return a.side === "buy" ? 1 : -1;
  });
  for (const order of orders) {
    const touches = order.side === "buy" ? price <= order.price : price >= order.price;
    if (!touches) {
      continue;
    }
    if (order.side === "sell" && next.inventoryBtc <= 0) {
      next = {
        ...next,
        workingOrders: next.workingOrders.filter((item) => item.id !== order.id),
      };
      continue;
    }
    const qty =
      order.side === "sell" ? Math.min(order.qty, next.inventoryBtc) : order.qty;
    if (qty <= 0) {
      continue;
    }
    const feeUsd = order.price * qty * feeRate(next.venue, order.feeRole);
    const realized =
      order.side === "sell" ? (order.price - next.avgEntry) * qty : 0;
    const fill: FillRecord = {
      time,
      orderId: order.id,
      kind: order.kind,
      side: order.side,
      price: order.price,
      qty,
      feeUsd,
      reduceOnly: order.reduceOnly,
      realizedHarvestUsd: realized,
    };
    fills.push(fill);
    next = applyFill(next, fill);
    if (SHARED_CONTROLS.replenishment === "aggressive_persistent") {
      next = replenish(next, order, time);
    }
  }
  return next;
}

function replenish(
  book: BookState,
  filled: WorkingOrder,
  time: number,
): BookState {
  if (!book.anchorPrice || filled.levelIndex === null) {
    return book;
  }
  const levels = gridPrices(book.anchorPrice);
  const intents: DryRunIntent[] = [];
  let next = book;
  if (filled.side === "buy") {
    const up = filled.levelIndex + 1;
    if (up < levels.length && next.inventoryBtc > 0) {
      const qty = Math.min(filled.qty, next.inventoryBtc);
      next = placeOrder(
        next,
        {
          id: clientOrderId([
            "ask",
            next.mandate,
            next.venue,
            next.pathMode,
            up,
            levels[up].toFixed(2),
          ]),
          kind: "reduce_only_ask",
          side: "sell",
          price: levels[up],
          qty,
          reduceOnly: true,
          levelIndex: up,
          feeRole: "maker",
        },
        time,
        intents,
      );
    }
  } else if (next.targetNotional > next.inventoryBtc * next.lastMark + SHARED_CONTROLS.minNotionalUsd) {
    const down = filled.levelIndex - 1;
    if (down >= 0) {
      const remaining = next.targetNotional - next.inventoryBtc * (next.lastMark || filled.price);
      const qty = qtyForNotional(Math.min(remaining, filled.qty * filled.price), levels[down]);
      if (qty > 0) {
        next = placeOrder(
          next,
          {
            id: clientOrderId([
              "bid",
              next.mandate,
              next.venue,
              next.pathMode,
              down,
              levels[down].toFixed(2),
            ]),
            kind: "grid_bid",
            side: "buy",
            price: levels[down],
            qty,
            reduceOnly: false,
            levelIndex: down,
            feeRole: "maker",
          },
          time,
          intents,
        );
      }
    }
  }
  void intents;
  return next;
}

export function gridPrices(anchor: number): number[] {
  const low = anchor * (1 - SHARED_CONTROLS.rangePct);
  const high = anchor * (1 + SHARED_CONTROLS.rangePct);
  const steps = SHARED_CONTROLS.gridLevels - 1;
  const spacing = (high - low) / steps;
  return Array.from({ length: SHARED_CONTROLS.gridLevels }, (_, index) =>
    Number((low + spacing * index).toFixed(2)),
  );
}

function rebuildGrid(
  book: BookState,
  mark: number,
  time: number,
  intents: DryRunIntent[],
): BookState {
  const levels = gridPrices(book.anchorPrice);
  let next: BookState = { ...book, workingOrders: [] };
  const remaining = Math.max(0, book.targetNotional - book.inventoryBtc * mark);
  const bidLevels = levels
    .map((price, index) => ({ price, index }))
    .filter((level) => level.price < mark);
  const perLevel = bidLevels.length ? remaining / bidLevels.length : 0;
  for (const level of bidLevels) {
    const qty = qtyForNotional(perLevel, level.price);
    if (qty <= 0) {
      continue;
    }
    next = placeOrder(
      next,
      {
        id: clientOrderId([
          "bid",
          next.mandate,
          next.venue,
          next.pathMode,
          level.index,
          level.price.toFixed(2),
          Math.floor(time / 60_000),
        ]),
        kind: "grid_bid",
        side: "buy",
        price: level.price,
        qty,
        reduceOnly: false,
        levelIndex: level.index,
        feeRole: "maker",
      },
      time,
      intents,
    );
  }
  if (next.inventoryBtc > 0) {
    const askLevels = levels
      .map((price, index) => ({ price, index }))
      .filter((level) => level.price > mark);
    const qty = roundLot(next.inventoryBtc / Math.max(1, askLevels.length));
    for (const level of askLevels) {
      const levelQty = Math.min(qty, next.inventoryBtc);
      if (levelQty <= 0) {
        continue;
      }
      next = placeOrder(
        next,
        {
          id: clientOrderId([
            "ask",
            next.mandate,
            next.venue,
            next.pathMode,
            level.index,
            level.price.toFixed(2),
            Math.floor(time / 60_000),
          ]),
          kind: "reduce_only_ask",
          side: "sell",
          price: level.price,
          qty: levelQty,
          reduceOnly: true,
          levelIndex: level.index,
          feeRole: "maker",
        },
        time,
        intents,
      );
    }
  }
  return next;
}

function marketFill(
  book: BookState,
  side: "buy" | "sell",
  qty: number,
  price: number,
  time: number,
  kind: WorkingOrder["kind"],
  fills: FillRecord[],
): BookState {
  const useQty = side === "sell" ? Math.min(qty, book.inventoryBtc) : qty;
  if (useQty <= 0) {
    return book;
  }
  const orderId = clientOrderId([
    kind,
    book.mandate,
    book.venue,
    book.pathMode,
    time,
    side,
    price.toFixed(2),
  ]);
  const fill: FillRecord = {
    time,
    orderId,
    kind,
    side,
    price,
    qty: useQty,
    feeUsd: price * useQty * feeRate(book.venue, "taker"),
    reduceOnly: side === "sell",
    realizedHarvestUsd: side === "sell" ? (price - book.avgEntry) * useQty : 0,
  };
  fills.push(fill);
  return applyFill(book, fill);
}

export function flattenBook(
  book: BookState,
  mark: number,
  time: number,
  reason: string,
  fills: FillRecord[],
  intents: DryRunIntent[],
): BookState {
  let next: BookState = {
    ...book,
    workingOrders: [],
    paused: true,
    pauseReason: reason,
    targetNotional: 0,
    immediateNotional: 0,
  };
  if (next.inventoryBtc > 0) {
    intents.push({
      clientOrderId: clientOrderId(["flatten", next.mandate, next.venue, next.pathMode, time]),
      time,
      mandate: next.mandate,
      venue: next.venue,
      pathMode: next.pathMode,
      kind: "flatten",
      side: "sell",
      price: mark,
      qty: next.inventoryBtc,
      reduceOnly: true,
      liveSubmitted: false,
      note: `Paper flatten: ${reason}. Reduce-only. Not sent to any venue.`,
    });
    next = marketFill(next, "sell", next.inventoryBtc, mark, time, "flatten", fills);
  }
  next.anchorPrice = mark;
  return markToMarket(next, mark);
}

export function syncBookToThesis(
  book: BookState,
  input: {
    thesisLong: boolean;
    hardHalt: boolean;
    dataEligible: boolean;
    extensionScore: number | null;
    pace: number | null;
    mark: number;
    time: number;
    paperKill: boolean;
    longTransition: boolean;
  },
  fills: FillRecord[],
  intents: DryRunIntent[],
): BookState {
  const mandate = MANDATES[book.mandate];
  let next = markToMarket(book, input.mark);

  if (input.paperKill) {
    return flattenBook(next, input.mark, input.time, "paper_kill_switch", fills, intents);
  }
  if (!input.dataEligible) {
    return flattenBook(next, input.mark, input.time, "data_ineligible", fills, intents);
  }
  if (input.hardHalt) {
    return flattenBook(next, input.mark, input.time, "hard_halt", fills, intents);
  }
  if (!input.thesisLong) {
    return flattenBook(next, input.mark, input.time, "thesis_not_long", fills, intents);
  }

  const score = input.extensionScore ?? 100;
  const pace = (input.pace ?? 0.25) as 0.25 | 0.5 | 1;
  const maxNotional = maxNotionalUsd(book.mandate);
  const floorNotional = maxNotional * mandate.floorPct;
  const target = floorNotional + (1 - score / 100) * (maxNotional - floorNotional);
  const immediate = target * pace;
  next = {
    ...next,
    paused: false,
    pauseReason: null,
    targetNotional: target,
    immediateNotional: immediate,
    longTransitionCount: next.longTransitionCount + (input.longTransition ? 1 : 0),
  };

  if (!next.anchorPrice) {
    next.anchorPrice = input.mark;
  } else if (
    next.inventoryBtc === 0 &&
    Math.abs(input.mark / next.anchorPrice - 1) >= SHARED_CONTROLS.reanchorThresholdPct
  ) {
    next.anchorPrice = input.mark;
  }

  const gapToImmediate = immediate - next.exposureUsd;
  if (gapToImmediate >= SHARED_CONTROLS.minNotionalUsd) {
    const qty = qtyForNotional(gapToImmediate, input.mark);
    if (qty > 0) {
      intents.push({
        clientOrderId: clientOrderId([
          "starter",
          next.mandate,
          next.venue,
          next.pathMode,
          input.time,
        ]),
        time: input.time,
        mandate: next.mandate,
        venue: next.venue,
        pathMode: next.pathMode,
        kind: "market_starter",
        side: "buy",
        price: input.mark,
        qty,
        reduceOnly: false,
        liveSubmitted: false,
        note: "Staged 15m market allocation at the next closed-candle action open.",
      });
      next = marketFill(next, "buy", qty, input.mark, input.time, "market_starter", fills);
      next = markToMarket(next, input.mark);
    }
  }

  if (next.liquidationBufferPct < mandate.liquidationBufferFloor) {
    return flattenBook(
      next,
      input.mark,
      input.time,
      "liquidation_buffer_breach",
      fills,
      intents,
    );
  }

  next = rebuildGrid(next, input.mark, input.time, intents);
  next = markToMarket(next, input.mark);
  next.deploymentStatus = deploymentStatus(next, true);
  return next;
}

export function advanceBookOnCandle(
  book: BookState,
  candle: Candle,
  fills: FillRecord[],
): BookState {
  let next = book;
  const prices = pathPrices(candle, book.pathMode);
  for (const price of prices) {
    next = maybeFill(next, price, candle.openTime, fills);
    next = markToMarket(next, price);
  }
  next = markToMarket(next, candle.close);
  if (next.inventoryBtc < -SHARED_CONTROLS.lotSizeBtc) {
    throw new Error("short_inventory_forbidden");
  }
  if (next.inventoryBtc < 0) {
    next.inventoryBtc = 0;
  }
  const mandate = MANDATES[next.mandate];
  if (
    next.inventoryBtc > 0 &&
    next.liquidationBufferPct < mandate.liquidationBufferFloor
  ) {
    const flattenFills: FillRecord[] = [];
    const intents: DryRunIntent[] = [];
    next = flattenBook(
      next,
      candle.close,
      candle.openTime,
      "liquidation_buffer_breach",
      flattenFills,
      intents,
    );
    fills.push(...flattenFills);
  }
  next.deploymentStatus = deploymentStatus(next, next.targetNotional > 0);
  return next;
}

export function bookInvariantErrors(book: BookState): string[] {
  const errors: string[] = [];
  if (book.inventoryBtc < -1e-8) {
    errors.push("short_inventory");
  }
  const cap = maxNotionalUsd(book.mandate) * 1.02;
  if (book.exposureUsd > cap) {
    errors.push("exposure_cap_breached");
  }
  const identity = book.gridHarvestGross + book.inventoryMtmPnl - book.fees + book.funding;
  if (Math.abs(identity - book.totalPnl) > 1.5) {
    errors.push("pnl_identity_drift");
  }
  if (book.workingOrders.some((order) => order.side === "sell" && !order.reduceOnly)) {
    errors.push("opening_short_order");
  }
  return errors;
}
