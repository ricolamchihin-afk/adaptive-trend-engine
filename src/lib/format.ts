export function usd(value: number, digits = 2): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function hours(value: number): string {
  if (value < 1) {
    return `${Math.round(value * 60)}m`;
  }
  if (value < 48) {
    return `${value.toFixed(1)}h`;
  }
  return `${(value / 24).toFixed(1)}d`;
}
