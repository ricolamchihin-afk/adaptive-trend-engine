import { defaultSimConfig, runSimulation } from "./simulate";
import { buildFeatures } from "./strategy";
import type { Feature } from "./strategy";
import type { MarketSeries } from "./types";

export const HL_4H_START_MS = Date.UTC(2024, 4, 13);

export interface ResearchWindow {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
  role: "holdout" | "overlap" | "full" | "cycle";
}

export interface ResearchReport {
  id: string;
  label: string;
  role: ResearchWindow["role"];
  epochStart: string;
  epochEnd: string;
  bars: number;
  durationDays: number;
  startEquityUsd: number;
  finalEquityUsd: number;
  totalReturnPct: number;
  cagrPct: number;
  sharpe: number | null;
  sortino: number | null;
  tStat: number | null;
  pValue: number | null;
  maxDrawdownPct: number;
  trades: number;
  winRatePct: number | null;
  liquidations: number;
  buyHoldReturnPct: number;
  monthsUp: number;
  monthsCount: number;
}

export function researchWindows(now: number, firstBarMs: number): ResearchWindow[] {
  return [
    { id: "full", label: "Full Binance spot 4h", startMs: firstBarMs, endMs: now, role: "full" },
    {
      id: "holdout_pre_hl",
      label: "Holdout before Hyperliquid",
      startMs: firstBarMs,
      endMs: HL_4H_START_MS,
      role: "holdout",
    },
    {
      id: "overlap_hl",
      label: "Overlap with Hyperliquid tape",
      startMs: HL_4H_START_MS,
      endMs: now,
      role: "overlap",
    },
    {
      id: "cycle_2018_22",
      label: "2018–2022 (bear, COVID, blow-off, winter)",
      startMs: Date.UTC(2018, 0, 1),
      endMs: Date.UTC(2023, 0, 1),
      role: "cycle",
    },
    {
      id: "cycle_2023_now",
      label: "2023 → now",
      startMs: Date.UTC(2023, 0, 1),
      endMs: now,
      role: "cycle",
    },
  ];
}

export function runResearchWindow(features: Feature[], window: ResearchWindow): ResearchReport | null {
  const slice = features.filter((f) => f.candle.openTime >= window.startMs && f.candle.openTime < window.endMs);
  if (slice.length < 80) return null;
  const sim = runSimulation(slice, defaultSimConfig());
  const first = slice[0].candle;
  const last = slice[slice.length - 1].candle;
  const durationDays = (last.openTime - first.openTime) / 86_400_000;
  const years = durationDays / 365;
  const growth = sim.startEquityUsd > 0 ? sim.finalEquityUsd / sim.startEquityUsd : 0;
  const cagrPct = years > 0 && growth > 0 ? (growth ** (1 / years) - 1) * 100 : 0;
  const buyHoldReturnPct = first.close > 0 ? (last.close / first.close - 1) * 100 : 0;
  const monthsUp = sim.monthly.filter((m) => m.returnPct > 0).length;
  return {
    id: window.id,
    label: window.label,
    role: window.role,
    epochStart: new Date(first.openTime).toISOString(),
    epochEnd: new Date(last.openTime).toISOString(),
    bars: slice.length,
    durationDays,
    startEquityUsd: sim.startEquityUsd,
    finalEquityUsd: sim.finalEquityUsd,
    totalReturnPct: sim.totalReturnPct,
    cagrPct,
    sharpe: sim.sharpe,
    sortino: sim.sortino,
    tStat: sim.tStat,
    pValue: sim.pValue,
    maxDrawdownPct: sim.maxDrawdownPct,
    trades: sim.trades,
    winRatePct: sim.winRatePct,
    liquidations: sim.liquidations,
    buyHoldReturnPct,
    monthsUp,
    monthsCount: sim.monthsCount,
  };
}

export function runResearchBook(series: MarketSeries, now = Date.now()): ResearchReport[] {
  const features = buildFeatures(series);
  const firstBar = series.fourHour[0]?.openTime ?? 0;
  return researchWindows(now, firstBar)
    .map((w) => runResearchWindow(features, w))
    .filter((r): r is ResearchReport => r !== null);
}
