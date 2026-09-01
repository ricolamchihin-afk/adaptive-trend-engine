// Paper-only research scorer. Does not import executor / golive / Phoenix.
// Does not change ENTER/WAIT gates. Principal clicks; this never sends an order.

export const PAPER_ONLY = true as const;

export const PAPER_OVERLAY = {
  equityUsd: 10_000,
  stopRiskUsd: 100,
  tpR: [1.5, 2] as const,
  maxLeverage: 20,
  atrStopMult: 3,
} as const;

export type SetupAction = "ENTER_LONG" | "ENTER_SHORT" | "WAIT" | "FLAT";
export type TapeSource = "yahoo_public" | "aster_public" | "unavailable";

export interface CompactRow {
  base: string;
  asterSymbol: string;
  cashTicker: string | null;
  mark: number | null;
  source?: string | null;
  action: SetupAction;
  atr: number | null;
}

export interface CioBrief {
  paperOnly?: boolean;
  fourHourBucket?: string;
  enterLong?: CompactRow[];
  enterShort?: CompactRow[];
  waitLong?: CompactRow[];
  waitShort?: CompactRow[];
}

export interface SizedCard {
  base: string;
  asterSymbol: string;
  action: "ENTER_LONG" | "ENTER_SHORT";
  entry: number;
  qty: number;
  stop: number;
  tp1: number;
  tp2: number;
  stopDist: number;
  notional: number;
  leverage: number;
  rescaled: boolean;
}

export interface PaperScore {
  startingCash: number;
  endingValue: number;
  returnPct: number;
  maxDrawdown: number;
  riskAdjustedScore: number;
  scoringMethod: "return-only" | "risk-adjusted";
  finalScore: number | null;
  tradeCount: number;
  waitCount: number;
  markedToMarket: boolean;
  disqualifiedReason: string | null;
  equityCurve: number[];
}

export function chooseWorkingTape(input: {
  yahooOk: boolean;
  yahooStatus?: number;
  asterOk: boolean;
}): { source: TapeSource; reason: string } {
  if (input.yahooOk) {
    return { source: "yahoo_public", reason: "preferred_us_cash_print" };
  }
  if (input.asterOk) {
    const status = input.yahooStatus;
    const reason =
      status === 429 ? "yahoo_429_aster_klines" : "yahoo_miss_aster_klines";
    return { source: "aster_public", reason };
  }
  return { source: "unavailable", reason: "no_usable_tape" };
}

export function enterRowsFromBrief(brief: CioBrief): CompactRow[] {
  return [...(brief.enterLong ?? []), ...(brief.enterShort ?? [])];
}

export function waitRowsFromBrief(brief: CioBrief): CompactRow[] {
  return [...(brief.waitLong ?? []), ...(brief.waitShort ?? [])];
}

export function sizeEnterCard(row: CompactRow): SizedCard | null {
  switch (row.action) {
    case "WAIT":
    case "FLAT":
      return null;
    case "ENTER_LONG":
    case "ENTER_SHORT":
      break;
    default: {
      const neverAction: never = row.action;
      void neverAction;
      return null;
    }
  }

  const mark = row.mark;
  const atr = row.atr;
  if (mark == null || mark <= 0 || atr == null || atr <= 0) {
    return null;
  }

  const stopDist = PAPER_OVERLAY.atrStopMult * atr;
  if (stopDist <= 0) return null;

  let qty = PAPER_OVERLAY.stopRiskUsd / stopDist;
  let notional = qty * mark;
  let leverage = notional / PAPER_OVERLAY.equityUsd;
  let rescaled = false;
  if (leverage > PAPER_OVERLAY.maxLeverage) {
    notional = PAPER_OVERLAY.equityUsd * PAPER_OVERLAY.maxLeverage;
    qty = notional / mark;
    leverage = PAPER_OVERLAY.maxLeverage;
    rescaled = true;
  }

  const sign = row.action === "ENTER_LONG" ? 1 : -1;
  return {
    base: row.base,
    asterSymbol: row.asterSymbol,
    action: row.action,
    entry: mark,
    qty: sign * qty,
    stop: mark - sign * stopDist,
    tp1: mark + sign * PAPER_OVERLAY.tpR[0] * stopDist,
    tp2: mark + sign * PAPER_OVERLAY.tpR[1] * stopDist,
    stopDist,
    notional,
    leverage,
    rescaled,
  };
}

function safeFloat(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function updateDrawdown(peak: number, equity: number, maxDrawdown: number): {
  peak: number;
  maxDrawdown: number;
} {
  const nextPeak = Math.max(peak, equity);
  const dd = nextPeak > 0 ? Math.max(maxDrawdown, ((nextPeak - equity) / nextPeak) * 100) : maxDrawdown;
  return { peak: nextPeak, maxDrawdown: dd };
}

// Perp MTM: cash stays starting equity; inventory is signedQty * (mark - entry).
// Narrower than AI-Trader's spot cash-debit replay; same return / DD / score fields.
export function scoreSizedBook(
  cards: SizedCard[],
  laterMarks: Record<string, number>,
  opts: { scoringMethod?: PaperScore["scoringMethod"]; allowedDrawdown?: number; drawdownPenalty?: number } = {},
): PaperScore {
  const startingCash = PAPER_OVERLAY.equityUsd;
  const scoringMethod = opts.scoringMethod ?? "return-only";
  const allowedDrawdown = opts.allowedDrawdown ?? 100;
  const drawdownPenalty = opts.drawdownPenalty ?? 1;

  let disqualifiedReason: string | null = null;
  const equityCurve = [startingCash];
  let peak = startingCash;
  let maxDrawdown = 0;

  let unrealized = 0;
  let marked = 0;
  for (const card of cards) {
    const mark = laterMarks[card.base] ?? laterMarks[card.asterSymbol];
    if (mark == null || mark <= 0) {
      disqualifiedReason = disqualifiedReason ?? `missing_mark:${card.base}`;
      continue;
    }
    unrealized += card.qty * (mark - card.entry);
    marked += 1;
  }

  const endingValue = startingCash + safeFloat(unrealized);
  equityCurve.push(endingValue);
  const dd = updateDrawdown(peak, endingValue, maxDrawdown);
  peak = dd.peak;
  maxDrawdown = dd.maxDrawdown;

  const returnPct = startingCash > 0 ? ((endingValue - startingCash) / startingCash) * 100 : 0;
  const riskAdjustedScore = returnPct - Math.max(0, maxDrawdown - allowedDrawdown) * drawdownPenalty;
  const finalScore =
    disqualifiedReason || cards.length === 0
      ? null
      : scoringMethod === "risk-adjusted"
        ? riskAdjustedScore
        : returnPct;

  return {
    startingCash,
    endingValue,
    returnPct,
    maxDrawdown,
    riskAdjustedScore,
    scoringMethod,
    finalScore,
    tradeCount: cards.length,
    waitCount: 0,
    markedToMarket: marked > 0,
    disqualifiedReason,
    equityCurve,
  };
}

export function scoreCioBrief(
  brief: CioBrief,
  laterMarks: Record<string, number>,
): PaperScore & { sized: SizedCard[]; skippedWait: number } {
  const waits = waitRowsFromBrief(brief);
  const enters = enterRowsFromBrief(brief);
  const sized: SizedCard[] = [];
  for (const row of enters) {
    const card = sizeEnterCard(row);
    if (card) sized.push(card);
  }
  const score = scoreSizedBook(sized, laterMarks);
  return { ...score, waitCount: waits.length, sized, skippedWait: waits.length };
}
