export function sma(values: number[], period: number): number | null {
  if (values.length < period) {
    return null;
  }
  const window = values.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / period;
}

export function stdev(values: number[], period: number): number | null {
  if (values.length < period) {
    return null;
  }
  const mean = sma(values, period);
  if (mean === null) {
    return null;
  }
  const window = values.slice(-period);
  const variance =
    window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
  return Math.sqrt(variance);
}

export function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) {
    return [];
  }
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out.push(ema);
  for (let i = period; i < values.length; i += 1) {
    ema = values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

export function lastEma(values: number[], period: number): number | null {
  const series = emaSeries(values, period);
  return series.length ? series[series.length - 1] : null;
}

export function zScore(values: number[], period: number): number | null {
  const mean = sma(values, period);
  const deviation = stdev(values, period);
  if (mean === null || deviation === null || deviation === 0) {
    return null;
  }
  return (values[values.length - 1] - mean) / deviation;
}

export function rsiWilder(values: number[], period: number): number | null {
  if (values.length < period + 1) {
    return null;
  }
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) {
      gain += change;
    } else {
      loss -= change;
    }
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const up = change > 0 ? change : 0;
    const down = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
  }
  if (avgLoss === 0) {
    return 100;
  }
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function trueRange(
  high: number,
  low: number,
  previousClose: number,
): number {
  return Math.max(
    high - low,
    Math.abs(high - previousClose),
    Math.abs(low - previousClose),
  );
}

// Wilder ATR over the given period. Needs period + 1 candles.
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number | null {
  if (highs.length < period + 1) {
    return null;
  }
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i += 1) {
    trs.push(trueRange(highs[i], lows[i], closes[i - 1]));
  }
  let value = trs.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
  for (let i = period; i < trs.length; i += 1) {
    value = (value * (period - 1) + trs[i]) / period;
  }
  return value;
}

export function highestHigh(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

export function lowestLow(values: number[]): number | null {
  return values.length ? Math.min(...values) : null;
}

export function adxWilder(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number | null {
  if (highs.length < period * 2 + 1) {
    return null;
  }
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < highs.length; i += 1) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(trueRange(highs[i], lows[i], closes[i - 1]));
  }
  let smoothTr = tr.slice(0, period).reduce((sum, value) => sum + value, 0);
  let smoothPlus = plusDm.slice(0, period).reduce((sum, value) => sum + value, 0);
  let smoothMinus = minusDm
    .slice(0, period)
    .reduce((sum, value) => sum + value, 0);
  const dx: number[] = [];
  const firstPlusDi = smoothTr === 0 ? 0 : (100 * smoothPlus) / smoothTr;
  const firstMinusDi = smoothTr === 0 ? 0 : (100 * smoothMinus) / smoothTr;
  const firstDenom = firstPlusDi + firstMinusDi;
  dx.push(firstDenom === 0 ? 0 : (100 * Math.abs(firstPlusDi - firstMinusDi)) / firstDenom);
  for (let i = period; i < tr.length; i += 1) {
    smoothTr = smoothTr - smoothTr / period + tr[i];
    smoothPlus = smoothPlus - smoothPlus / period + plusDm[i];
    smoothMinus = smoothMinus - smoothMinus / period + minusDm[i];
    const plusDi = smoothTr === 0 ? 0 : (100 * smoothPlus) / smoothTr;
    const minusDi = smoothTr === 0 ? 0 : (100 * smoothMinus) / smoothTr;
    const denom = plusDi + minusDi;
    dx.push(denom === 0 ? 0 : (100 * Math.abs(plusDi - minusDi)) / denom);
  }
  if (dx.length < period) {
    return null;
  }
  let adx = dx.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < dx.length; i += 1) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }
  return adx;
}

export function bollingerWidth(
  values: number[],
  period: number,
  stdMultiplier: number,
): number | null {
  const mean = sma(values, period);
  const deviation = stdev(values, period);
  if (mean === null || deviation === null || mean === 0) {
    return null;
  }
  const upper = mean + stdMultiplier * deviation;
  const lower = mean - stdMultiplier * deviation;
  return (upper - lower) / mean;
}

export function quantile(values: number[], q: number): number | null {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[index];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function closesOf(candles: { close: number }[]): number[] {
  return candles.map((candle) => candle.close);
}
