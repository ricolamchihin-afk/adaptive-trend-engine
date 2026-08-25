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
  auto4h: boolean;
  compound: boolean;
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

export function liveConfig(): LiveConfig {
  return {
    // Dry run defaults ON and is the only supported mode until a write adapter exists.
    dryRun: envBool("DRY_RUN", true),
    liveTradingEnabled: envBool("LIVE_TRADING_ENABLED", false),
    auto4h: envBool("LIVE_AUTO_4H", true),
    compound: envBool("LIVE_COMPOUND", true),
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

// Live stake. Compound: next trade sizes on real Phoenix collateral (wins grow
// the bet, losses shrink it). Cap: never more than SG_CAPITAL_USD.
export function liveEquityUsd(capitalUsd: number, collateralUsd?: number, compound = false): number {
  if (typeof collateralUsd === "number" && Number.isFinite(collateralUsd) && collateralUsd > 0) {
    return compound ? collateralUsd : Math.min(capitalUsd, collateralUsd);
  }
  return capitalUsd;
}

// Daily loss budget: $400 on $2000 = two 10% stops. When compounding, scale with equity.
export function scaledDailyLossUsd(cfg: LiveConfig, equityUsd: number): number {
  if (cfg.dailyLossLimitUsd <= 0) return 0;
  if (!cfg.compound || cfg.capitalUsd <= 0) return cfg.dailyLossLimitUsd;
  return cfg.dailyLossLimitUsd * (equityUsd / cfg.capitalUsd);
}

export function drawdownHalted(peakUsd: number, equityUsd: number, maxDrawdownPct: number): boolean {
  if (maxDrawdownPct <= 0 || peakUsd <= 0) return false;
  return ((peakUsd - equityUsd) / peakUsd) * 100 >= maxDrawdownPct;
}
