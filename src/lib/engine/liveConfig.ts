import { STRATEGY } from "./spec";

// Server-side runtime configuration read from the environment (.env / .env.local).
// Never returns secret values — only whether credentials are present.

function envNum(key: string, fallback: number): number {
  const raw = process.env[key];
  const value = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === "true";
}

export interface LiveConfig {
  dryRun: boolean;
  liveTradingEnabled: boolean;
  exchange: string;
  accountLabel: string;
  capitalUsd: number;
  maxLeverage: number;
  riskPct: number;
  maxNotionalUsd: number;
  dailyLossLimitUsd: number;
  maxDrawdownPct: number;
  credentialsPresent: boolean;
}

export function paperOnly(): boolean {
  return envBool("PAPER_ONLY", false);
}

export function liveConfig(): LiveConfig {
  return {
    // Dry run defaults ON and is the only supported mode until a write adapter exists.
    dryRun: envBool("DRY_RUN", true),
    liveTradingEnabled: paperOnly() ? false : envBool("LIVE_TRADING_ENABLED", false),
    exchange: process.env.EXCHANGE ?? STRATEGY.venue,
    accountLabel: process.env.EXCHANGE_ACCOUNT_LABEL ?? "",
    capitalUsd: envNum("SG_CAPITAL_USD", STRATEGY.capitalUsd),
    maxLeverage: envNum("SG_MAX_LEVERAGE", STRATEGY.maxLeverage),
    riskPct: envNum("SG_RISK_PCT", STRATEGY.riskPct),
    maxNotionalUsd: envNum("LIVE_MAX_NOTIONAL_USD", 0),
    dailyLossLimitUsd: envNum("LIVE_DAILY_LOSS_LIMIT_USD", 0),
    maxDrawdownPct: envNum("LIVE_MAX_DRAWDOWN_PCT", 0),
    credentialsPresent: Boolean(process.env.EXCHANGE_API_KEY && process.env.EXCHANGE_API_SECRET),
  };
}
