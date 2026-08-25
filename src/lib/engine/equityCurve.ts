export type EquitySource = "phoenix" | "fill" | "mark" | "local" | "live";

export interface EquityPoint {
  t: number;
  equity: number;
  source: EquitySource;
}

export interface CollateralEventLite {
  t: number;
  type: string;
  amountUsd: number;
  afterUsd: number;
}

export interface FillLite {
  t: number;
  price: number;
  realizedPnl: number;
  fees: number;
  posAfter: number;
}

export interface CandleLite {
  t: number;
  close: number;
}

const RANK: Record<EquitySource, number> = { local: 0, mark: 1, fill: 2, phoenix: 3, live: 4 };

export function fillLiteFromPhoenix(raw: {
  timestamp: number | string;
  price: string | number;
  realizedPnl: string | number;
  fees: string | number;
  baseLotsAfter: string | number;
}): FillLite {
  return {
    t: asMs(Number(raw.timestamp)),
    price: Number(raw.price),
    realizedPnl: Number(raw.realizedPnl),
    fees: Number(raw.fees),
    posAfter: Number(raw.baseLotsAfter),
  };
}

export function collateralLiteFromPhoenix(raw: {
  timestamp: number | string;
  eventType: string;
  amount: number | string;
  collateralAfter: number | string;
}): CollateralEventLite {
  return {
    t: asMs(Number(raw.timestamp)),
    type: String(raw.eventType),
    amountUsd: quoteLotsToUsd(Number(raw.amount)),
    afterUsd: quoteLotsToUsd(Number(raw.collateralAfter)),
  };
}

export function asMs(t: number): number {
  return t >= 1e9 && t < 1e12 ? t * 1000 : t;
}

export function quoteLotsToUsd(lots: number): number {
  return lots / 1_000_000;
}

export function mergeEquitySeries(series: EquityPoint[][], live?: EquityPoint | null): EquityPoint[] {
  const map = new Map<number, EquityPoint>();
  for (const points of series) {
    for (const p of points) {
      if (!Number.isFinite(p.t) || !Number.isFinite(p.equity) || p.equity < 0) continue;
      const t = asMs(p.t);
      const next = { ...p, t };
      const prev = map.get(t);
      if (!prev || RANK[next.source] >= RANK[prev.source]) map.set(t, next);
    }
  }
  if (live && Number.isFinite(live.equity) && live.equity > 0) {
    map.set(asMs(live.t), { ...live, t: asMs(live.t), source: "live" });
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

export function downsampleEquity(points: EquityPoint[], max = 400): EquityPoint[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out: EquityPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export function curveStats(points: EquityPoint[], startUsd: number) {
  const start = startUsd > 0 ? startUsd : points[0]?.equity ?? 0;
  const last = points[points.length - 1]?.equity ?? start;
  let peak = start;
  let maxDdPct = 0;
  for (const p of points) {
    peak = Math.max(peak, p.equity);
    if (peak > 0) maxDdPct = Math.max(maxDdPct, ((peak - p.equity) / peak) * 100);
  }
  return {
    startUsd: start,
    lastUsd: last,
    pnlUsd: last - start,
    returnPct: start > 0 ? ((last - start) / start) * 100 : 0,
    maxDdPct,
    n: points.length,
  };
}

// Last flatten-to-zero on Phoenix is the live-book start (test deposits before that
// are a different account life).
export function netExternalUsd(events: CollateralEventLite[], startMs: number | null): number {
  return events
    .filter((e) => startMs === null || e.t > startMs)
    .reduce((sum, e) => {
      if (e.type === "deposit") return sum + e.amountUsd;
      if (e.type === "withdrawal") return sum - e.amountUsd;
      return sum;
    }, 0);
}

export function unrealizedPnlUsd(
  side: "LONG" | "SHORT" | "FLAT" | undefined,
  sizeBtc: number | undefined,
  entryUsd: number | null | undefined,
  mark: number | null | undefined,
): number {
  if (side !== "LONG" && side !== "SHORT") return 0;
  const size = Math.abs(sizeBtc ?? 0);
  const entry = entryUsd ?? 0;
  const px = mark ?? 0;
  if (size <= 0 || entry <= 0 || px <= 0) return 0;
  return (side === "LONG" ? 1 : -1) * size * (px - entry);
}

export function markedEquityUsd(collateralUsd: number | undefined, upnl: number): number | null {
  if (typeof collateralUsd !== "number" || !Number.isFinite(collateralUsd) || collateralUsd <= 0) {
    return null;
  }
  return collateralUsd + upnl;
}

export function liveBookStartMs(events: CollateralEventLite[]): number | null {
  const ordered = [...events].sort((a, b) => a.t - b.t);
  let start: number | null = null;
  for (const e of ordered) {
    if (e.afterUsd <= 0.01) start = e.t;
  }
  return start;
}

function applyFill(
  cash: number,
  pos: number,
  entry: number,
  fill: FillLite,
): { cash: number; pos: number; entry: number } {
  const cashNext = cash + fill.realizedPnl - fill.fees;
  const posNext = fill.posAfter;
  if (posNext === 0) return { cash: cashNext, pos: 0, entry: 0 };
  if (pos === 0 || Math.sign(posNext) !== Math.sign(pos)) {
    return { cash: cashNext, pos: posNext, entry: fill.price };
  }
  return { cash: cashNext, pos: posNext, entry };
}

// Venue-backed curve: Phoenix deposits/withdrawals are cash snapshots; fills
// move cash by realized PnL; open risk is marked on closed 4h candles so a
// desktop gap still shows the path. No interpolated fantasy between unknown points.
export function rebuildEquity(args: {
  events: CollateralEventLite[];
  fills: FillLite[];
  candles: CandleLite[];
  live?: EquityPoint | null;
  genesisUsd?: number;
}): EquityPoint[] {
  const startMs = liveBookStartMs(args.events);
  const events = [...args.events].filter((e) => startMs === null || e.t > startMs).sort((a, b) => a.t - b.t);
  const fills = [...args.fills].filter((f) => startMs === null || f.t > startMs).sort((a, b) => a.t - b.t);
  const candles = [...args.candles].filter((c) => startMs === null || c.t > startMs).sort((a, b) => a.t - b.t);

  type Item =
    | { t: number; kind: "cash"; e: CollateralEventLite }
    | { t: number; kind: "fill"; f: FillLite }
    | { t: number; kind: "candle"; c: CandleLite };
  const items: Item[] = [
    ...events.map((e) => ({ t: e.t, kind: "cash" as const, e })),
    ...fills.map((f) => ({ t: f.t, kind: "fill" as const, f })),
    ...candles.map((c) => ({ t: c.t, kind: "candle" as const, c })),
  ].sort((a, b) => a.t - b.t || (a.kind === "candle" ? 1 : -1));

  let cash = args.genesisUsd ?? 0;
  let pos = 0;
  let entry = 0;
  const points: EquityPoint[] = [];
  const emit = (t: number, source: EquitySource, mark: number) => {
    const upnl = pos !== 0 && mark > 0 ? pos * (mark - entry) : 0;
    const equity = cash + upnl;
    if (equity < 0 || !Number.isFinite(equity)) return;
    points.push({ t, equity, source });
  };

  let lastMark = 0;
  for (const item of items) {
    if (item.kind === "cash") {
      cash = item.e.afterUsd;
      emit(item.t, "phoenix", lastMark);
    } else if (item.kind === "fill") {
      const next = applyFill(cash, pos, entry, item.f);
      cash = next.cash;
      pos = next.pos;
      entry = next.entry;
      lastMark = item.f.price || lastMark;
      emit(item.t, "fill", lastMark);
    } else {
      lastMark = item.c.close;
      if (pos !== 0) emit(item.t, "mark", lastMark);
    }
  }
  return mergeEquitySeries([points], args.live ?? null);
}
