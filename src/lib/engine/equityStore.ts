import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FOUR_HOUR_MS } from "./candles";
import {
  curveStats,
  downsampleEquity,
  liveBookStartMs,
  mergeEquitySeries,
  netExternalUsd,
  rebuildEquity,
  type EquityPoint,
} from "./equityCurve";
import { liveConfig } from "./liveConfig";
import { loadYearMarket } from "./market-data";
import { PhoenixPerpExecutor } from "./phoenixExecutor";

const PATH = path.join(process.cwd(), "data", "equity-curve.json");

export async function loadLocalEquity(): Promise<EquityPoint[]> {
  try {
    const parsed = JSON.parse(await readFile(PATH, "utf8")) as { points?: EquityPoint[] };
    return Array.isArray(parsed.points) ? parsed.points : [];
  } catch {
    return [];
  }
}

export async function saveLocalEquity(points: EquityPoint[]): Promise<void> {
  await mkdir(path.dirname(PATH), { recursive: true });
  await writeFile(
    PATH,
    JSON.stringify({ points: downsampleEquity(points, 2_000), updatedAt: new Date().toISOString() }, null, 2),
  );
}

export async function recordLocalSample(equityUsd: number): Promise<void> {
  if (!Number.isFinite(equityUsd) || equityUsd <= 0) return;
  const points = await loadLocalEquity();
  const last = points[points.length - 1];
  const now = Date.now();
  if (last && now - last.t < 50_000 && Math.abs(last.equity - equityUsd) < 0.5) return;
  points.push({ t: now, equity: equityUsd, source: "local" });
  await saveLocalEquity(points);
}

const g = globalThis as typeof globalThis & {
  __ateEquityVenue?: { at: number; points: EquityPoint[]; note: string; venueOk: boolean; netExternalUsd: number };
};

export async function liveEquityReport(): Promise<{
  points: EquityPoint[];
  startUsd: number;
  lastUsd: number;
  pnlUsd: number;
  tradingPnlUsd: number;
  returnPct: number;
  maxDdPct: number;
  note: string;
  venueOk: boolean;
}> {
  const cfg = liveConfig();
  const phoenix = new PhoenixPerpExecutor();
  const [local, funded] = await Promise.all([
    loadLocalEquity(),
    phoenix.accountState().catch(() => ({ collateralUsd: undefined as number | undefined })),
  ]);
  const live =
    typeof funded.collateralUsd === "number" && funded.collateralUsd > 0
      ? { t: Date.now(), equity: funded.collateralUsd, source: "live" as const }
      : null;

  let cached = g.__ateEquityVenue;
  if (!cached || Date.now() - cached.at >= 10 * 60_000) {
    try {
      const [events, fills, market] = await Promise.all([
        phoenix.collateralEvents(),
        phoenix.btcFills(),
        loadYearMarket(Date.now(), 365),
      ]);
      const candles = market.series.fourHour.map((c) => ({ t: c.openTime + FOUR_HOUR_MS, close: c.close }));
      const startMs = liveBookStartMs(events);
      const points = rebuildEquity({ events, fills, candles, live, genesisUsd: cfg.capitalUsd });
      const venueOk = events.length > 0 || fills.length > 0;
      cached = {
        at: Date.now(),
        points,
        venueOk,
        netExternalUsd: netExternalUsd(events, startMs),
        note: venueOk
          ? "Phoenix deposits/fills backfill disconnects. 4h marks fill open-risk gaps. Local ticks add resolution while this app is running."
          : "Phoenix history empty — showing live collateral and local ticks only.",
      };
      g.__ateEquityVenue = cached;
    } catch (error) {
      cached = {
        at: Date.now(),
        points: [],
        venueOk: false,
        netExternalUsd: 0,
        note: `Phoenix history failed (${error instanceof Error ? error.message : "unknown"}). Graph is local ticks + live collateral.`,
      };
      g.__ateEquityVenue = cached;
    }
  }

  const points = downsampleEquity(
    mergeEquitySeries([local, cached.points.filter((p) => p.source !== "live")], live),
    400,
  );
  await saveLocalEquity(mergeEquitySeries([local, cached.points.filter((p) => p.source !== "live")], live));
  const start = points[0]?.equity || cfg.capitalUsd;
  const stats = curveStats(points, start);
  const tradingPnlUsd = stats.lastUsd - (cached.netExternalUsd || 0);
  return { points, ...stats, tradingPnlUsd, note: cached.note, venueOk: cached.venueOk };
}
