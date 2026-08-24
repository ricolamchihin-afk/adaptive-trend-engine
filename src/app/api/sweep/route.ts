import { runBacktest, type BacktestReport } from "@/lib/engine/backtest";
import { loadYearMarket } from "@/lib/engine/market-data";
import type { SimConfig } from "@/lib/engine/simulate";
import type { FeatureParams } from "@/lib/engine/strategy";

export const dynamic = "force-dynamic";

// One-variable-at-a-time sensitivity sweep around the working trend-follower
// baseline. Loads a year of candles once, then re-runs the backtest changing a
// single control per row so the effect on monthly return is isolated.
// Anchored on the current default strategy so the sweep isolates each control's
// effect on trade frequency and risk-adjusted return.
const BASE_SIM: Partial<SimConfig> = {
  riskPct: 0.03,
  maxLeverage: 20,
  atrStopMult: 3,
  adxThreshold: 0,
  liquidationPct: 0.045,
  rsiLongMin: 50,
  rsiShortMax: 50,
};
const BASE_FEAT: Partial<FeatureParams> = {
  donchianEntry: 34,
  donchianExit: 5,
  atrPeriod: 14,
  adxPeriod: 14,
  rsiPeriod: 14,
  dailyEmaPeriod: 150,
};

// Ranges skewed toward the low end to probe higher trade frequency.
const SIM_SWEEPS: Record<string, number[]> = {
  atrStopMult: [1, 1.5, 2, 3],
  rsiLongMin: [0, 40, 50],
};
const FEAT_SWEEPS: Record<string, number[]> = {
  donchianEntry: [8, 12, 20, 34, 55],
  donchianExit: [2, 3, 5, 7, 10],
  dailyEmaPeriod: [20, 50, 100, 150],
};

function metrics(report: BacktestReport) {
  const tradesPerMonth = report.monthsCount > 0 ? report.trades / report.monthsCount : 0;
  return {
    tradesPerMonth: Number(tradesPerMonth.toFixed(1)),
    trades: report.trades,
    sharpe: report.sharpe === null ? null : Number(report.sharpe.toFixed(2)),
    sortino: report.sortino === null ? null : Number(report.sortino.toFixed(2)),
    cagrPct: Number(report.cagrPct.toFixed(1)),
    maxDrawdownPct: Number(report.maxDrawdownPct.toFixed(1)),
    pValue: report.pValue === null ? null : Number(report.pValue.toFixed(3)),
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
