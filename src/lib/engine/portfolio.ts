export interface EquityBar {
  t: number;
  equity: number;
}

export interface PortfolioScore {
  label: string;
  names: string[];
  startEquityUsd: number;
  finalEquityUsd: number;
  durationDays: number;
  totalReturnPct: number;
  cagrPct: number;
  sharpe: number | null;
  sortino: number | null;
  annualVolPct: number;
  maxDrawdownPct: number;
  tStat: number | null;
  pValue: number | null;
}

const PERIODS_PER_YEAR = 6 * 365;

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

// Equal-dollar overlay: each sleeve sits in `cashUsd` until its first bar, then
// last-known mark-to-market. One Decibel account, names listed when they exist.
export function overlayEqualDollar(series: EquityBar[][], cashUsd: number): EquityBar[] {
  const times = [...new Set(series.flatMap((s) => s.map((b) => b.t)))].sort((a, b) => a - b);
  const idx = series.map(() => 0);
  const last = series.map(() => cashUsd);
  const out: EquityBar[] = [];
  for (const t of times) {
    let sum = 0;
    for (let i = 0; i < series.length; i += 1) {
      const bars = series[i];
      while (idx[i] < bars.length && bars[idx[i]].t <= t) {
        last[i] = bars[idx[i]].equity;
        idx[i] += 1;
      }
      sum += last[i];
    }
    out.push({ t, equity: sum });
  }
  return out;
}

export function scoreEquityPath(
  bars: EquityBar[],
  startEquityUsd: number,
  label: string,
  names: string[],
): PortfolioScore {
  if (bars.length < 2 || startEquityUsd <= 0) {
    return {
      label,
      names,
      startEquityUsd,
      finalEquityUsd: bars[bars.length - 1]?.equity ?? startEquityUsd,
      durationDays: 0,
      totalReturnPct: 0,
      cagrPct: 0,
      sharpe: null,
      sortino: null,
      annualVolPct: 0,
      maxDrawdownPct: 0,
      tStat: null,
      pValue: null,
    };
  }
  const rets: number[] = [];
  let peak = bars[0].equity;
  let maxDrawdownPct = 0;
  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i - 1].equity > 0) rets.push(bars[i].equity / bars[i - 1].equity - 1);
    peak = Math.max(peak, bars[i].equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - bars[i].equity) / peak) * 100);
  }
  const meanRet = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
  const variance = rets.length ? rets.reduce((s, r) => s + (r - meanRet) ** 2, 0) / rets.length : 0;
  const sd = Math.sqrt(variance);
  const sharpe = sd > 0 ? (meanRet / sd) * Math.sqrt(PERIODS_PER_YEAR) : null;
  const downVar = rets.length ? rets.filter((r) => r < 0).reduce((s, r) => s + r * r, 0) / rets.length : 0;
  const downSd = Math.sqrt(downVar);
  const sortino = downSd > 0 ? (meanRet / downSd) * Math.sqrt(PERIODS_PER_YEAR) : null;
  const tStat = sd > 0 && rets.length > 1 ? meanRet / (sd / Math.sqrt(rets.length)) : null;
  const durationDays = (bars[bars.length - 1].t - bars[0].t) / 86_400_000;
  const years = durationDays / 365;
  const finalEquityUsd = bars[bars.length - 1].equity;
  const growth = finalEquityUsd / startEquityUsd;
  return {
    label,
    names,
    startEquityUsd,
    finalEquityUsd,
    durationDays,
    totalReturnPct: (growth - 1) * 100,
    cagrPct: years > 0 && growth > 0 ? (growth ** (1 / years) - 1) * 100 : 0,
    sharpe,
    sortino,
    annualVolPct: sd * Math.sqrt(PERIODS_PER_YEAR) * 100,
    maxDrawdownPct,
    tStat,
    pValue: tStat === null ? null : 1 - normalCdf(tStat),
  };
}
