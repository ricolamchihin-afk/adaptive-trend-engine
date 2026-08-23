import { runBacktest } from "@/lib/engine/backtest";
import { loadYearMarket } from "@/lib/engine/market-data";

export const dynamic = "force-dynamic";

function num(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const years = Math.min(5, Math.max(1, num(params, "years") || 1));
    const market = await loadYearMarket(Date.now(), years * 365);
    const sim = {
      riskPct: num(params, "risk"),
      maxLeverage: num(params, "lev"),
      atrStopMult: num(params, "atrMult"),
      adxThreshold: num(params, "adx"),
    };
    const feat = {
      donchianEntry: num(params, "entry"),
      donchianExit: num(params, "exit"),
    };
    const cleanSim = Object.fromEntries(Object.entries(sim).filter(([, v]) => v !== undefined));
    const cleanFeat = Object.fromEntries(Object.entries(feat).filter(([, v]) => v !== undefined));
    const report = runBacktest(market.series, market.source, years, cleanSim, cleanFeat);
    return Response.json(report);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "backtest_failed" },
      { status: 500 },
    );
  }
}
