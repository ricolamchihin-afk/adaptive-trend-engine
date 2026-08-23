import { runBacktest, type BacktestReport } from "@/lib/engine/backtest";
import { loadYearMarket } from "@/lib/engine/market-data";
import type { SimConfig } from "@/lib/engine/simulate";
import type { FeatureParams } from "@/lib/engine/strategy";

export const dynamic = "force-dynamic";

// One-variable-at-a-time sensitivity sweep around the working trend-follower
// baseline. Loads a year of candles once, then re-runs the backtest changing a
// single control per row so the effect on monthly return is isolated.
const BASE_SIM: Partial<SimConfig> = {
  riskPct: 0.02,
  maxLeverage: 10,
  atrStopMult: 2,
  adxThreshold: 0,
  liquidationPct: 0.09,
};
const BASE_FEAT: Partial<FeatureParams> = {
  donchianEntry: 55,
  donchianExit: 20,
  atrPeriod: 14,
  adxPeriod: 14,
  dailyEmaPeriod: 50,
};

const SIM_SWEEPS: Record<string, number[]> = {
  riskPct: [0.01, 0.02, 0.03, 0.05, 0.08],
  maxLeverage: [5, 10, 20],
  atrStopMult: [1.5, 2, 3, 4],
  adxThreshold: [0, 15, 20, 25],
};
const FEAT_SWEEPS: Record<string, number[]> = {
  donchianEntry: [20, 34, 55, 89],
  donchianExit: [10, 20, 34],
  dailyEmaPeriod: [20, 50, 100, 200],
  atrPeriod: [10, 14, 20],
};

function metrics(report: BacktestReport) {
  const monthlyPct =
    report.cagrPct > -100 ? ((1 + report.cagrPct / 100) ** (1 / 12) - 1) * 100 : -100;
  return {
    cagrPct: Number(report.cagrPct.toFixed(1)),
    monthlyPct: Number(monthlyPct.toFixed(2)),
    sharpe: report.sharpe === null ? null : Number(report.sharpe.toFixed(2)),
    maxDrawdownPct: Number(report.maxDrawdownPct.toFixed(1)),
    trades: report.trades,
    totalReturnPct: Number(report.totalReturnPct.toFixed(1)),
  };
}

export async function GET(request: Request) {
  const years = Math.min(3, Math.max(1, Number(new URL(request.url).searchParams.get("years")) || 1));
  const market = await loadYearMarket(Date.now(), years * 365);

  const run = (sim: Partial<SimConfig>, feat: Partial<FeatureParams>) =>
    metrics(runBacktest(market.series, market.source, years, sim, feat));

  const baseline = run(BASE_SIM, BASE_FEAT);
  const sweeps: Record<string, Array<{ value: number } & ReturnType<typeof metrics>>> = {};

  for (const [key, values] of Object.entries(SIM_SWEEPS)) {
    sweeps[key] = values.map((value) => ({ value, ...run({ ...BASE_SIM, [key]: value }, BASE_FEAT) }));
  }
  for (const [key, values] of Object.entries(FEAT_SWEEPS)) {
    sweeps[key] = values.map((value) => ({ value, ...run(BASE_SIM, { ...BASE_FEAT, [key]: value }) }));
  }

  return Response.json({
    years,
    window: { start: baselineWindow(market.series), bars: market.series.fourHour.length },
    baseline: { config: { ...BASE_SIM, ...BASE_FEAT }, ...baseline },
    sweeps,
  });
}

function baselineWindow(series: { fourHour: { openTime: number }[] }): string {
  const bars = series.fourHour;
  if (!bars.length) return "";
  return `${new Date(bars[0].openTime).toISOString().slice(0, 10)} -> ${new Date(bars[bars.length - 1].openTime).toISOString().slice(0, 10)}`;
}
