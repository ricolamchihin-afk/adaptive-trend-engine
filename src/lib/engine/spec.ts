import { createHash } from "node:crypto";
import type { ProductionBoundary, VenueSpec } from "./types";

export const EPOCH_ID = "phase_7_10_dynamic_directional";
export const EPOCH_TITLE = "Phase 7.10 dynamic directional exposure";

export const LIVE_ACTIONS_ENABLED = false as const;

export const PRODUCTION_BOUNDARY = {
  live_actions_enabled: false,
  canary_authorized: false,
  write_adapter: null,
  credential_modules: [],
  kill_switch: "paper_flatten_only",
} as const satisfies ProductionBoundary;

// Phoenix, 1000 USDC. A Turtle-style trend follower on the 4h execution timeframe:
// Donchian breakout entries, opposite (shorter) Donchian breakout as a trailing
// exit, ATR volatility position sizing, and a daily trend filter. Leverage is a
// cap (10x); ATR risk sizing usually keeps effective leverage well below it.
// This is the strategy the trial-and-error search converged on; the fixed 1:1
// take-profit / stop-loss and the persistent grid both lost and were discarded.
export const STRATEGY = {
  venue: "phoenix" as const,
  capitalUsd: 1000,
  // Leverage is a hard ceiling; ATR risk sizing sets the actual position and
  // usually stays well below it. Raised to 20x for more headroom.
  leverage: 20,
  maxLeverage: 20,
  // Higher-timeframe trend filter: only take longs above the daily EMA, shorts below.
  // A long 150-period daily filter with a wide 3x ATR stop and an RSI 50/50 momentum
  // gate was the best robust combination: Sharpe ~1.4-1.8, Sortino ~2-2.9, ~14% drawdown,
  // significant (p<0.05) on the 2y/3y windows.
  dailyEmaPeriod: 150,
  // Donchian breakout windows (4h bars). Responsive 34-bar entry with a fast 5-bar
  // trailing exit: the frequency sweep found a 5-bar exit raises BOTH trade frequency
  // (~3-4/mo) and Sharpe (~1.3-2.0). Forcing 10-15 trades/mo made returns insignificant.
  donchianEntry: 34,
  donchianExit: 5,
  // ADX trend-strength gate. Disabled by default (a strict gate hurt returns); still
  // reported and re-enableable in the lab.
  adxPeriod: 14,
  adxThreshold: 0,
  // RSI momentum confirmation: only long when RSI >= 50, only short when RSI <= 50.
  rsiPeriod: 14,
  rsiLongMin: 50,
  rsiShortMax: 50,
  // Optional fixed take-profit in ROE % of equity at entry. 0 = let winners run to
  // the trailing exit (default). Set e.g. 20 to close a winner at +20% ROE.
  takeProfitRoePct: 0,
  // Dynamic take-profit scaled by trend strength: TP% = tpAdxFactor * ADX(at entry),
  // clamped to [tpMinRoePct, tpMaxRoePct]. Factor 1.0 (TP% ~= the ADX reading) was the
  // best in trial-and-error: neutral at low risk, and a clear lift as leverage rises
  // (e.g. at risk 8% it raised Sharpe 2.0 -> 2.3, CAGR 137% -> 172% at the same drawdown).
  tpAdxFactor: 1.0,
  tpMinRoePct: 10,
  tpMaxRoePct: 60,
  // ATR sizing + initial stop. A wide 3x ATR stop cuts whipsaw exits and lowers drawdown.
  atrPeriod: 14,
  atrStopMult: 3,
  // Risk a fixed fraction of equity per trade; volatility sets the size. 3% balances
  // ~40% CAGR with a Sharpe above 1 and a ~31% drawdown.
  riskPct: 0.03,
  liquidationPct: 0.045,
} as const;

export const VENUES: readonly VenueSpec[] = [
  {
    id: "phoenix",
    label: "Phoenix",
    makerFeeBps: 1.2,
    takerFeeBps: 4.0,
    feeScheduleNote:
      "Research placeholder fee schedule. Not a venue-native verified tier.",
  },
] as const;

export function venueFeeRate(role: "maker" | "taker"): number {
  const phoenix = VENUES[0];
  return (role === "maker" ? phoenix.makerFeeBps : phoenix.takerFeeBps) / 10_000;
}

export const FROZEN_SPEC = {
  epoch: EPOCH_ID,
  live_actions_enabled: LIVE_ACTIONS_ENABLED,
  strategy: "turtle_trend_following",
  regimes: ["LONG", "SHORT", "FLAT"],
  venue: STRATEGY.venue,
  capital_usd: STRATEGY.capitalUsd,
  execution_timeframe: "4h",
  trend_filter: {
    daily_ema_period: STRATEGY.dailyEmaPeriod,
    adx_period: STRATEGY.adxPeriod,
    adx_threshold: STRATEGY.adxThreshold,
  },
  entry: { donchian_window: STRATEGY.donchianEntry },
  exit: { donchian_window: STRATEGY.donchianExit, initial_stop: "2x_ATR" },
  sizing: {
    method: "atr_volatility_risk_parity",
    risk_pct_per_trade: STRATEGY.riskPct,
    atr_period: STRATEGY.atrPeriod,
    atr_stop_mult: STRATEGY.atrStopMult,
    max_leverage: STRATEGY.maxLeverage,
  },
  risk: { liquidation_pct: STRATEGY.liquidationPct },
  retired: ["phase_7_9_persistent_80_level_grid", "fixed_1to1_take_profit_stop_loss"],
} as const;

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function hashFrozenSpec(): string {
  return createHash("sha256").update(stableStringify(FROZEN_SPEC)).digest("hex");
}

export const SPEC_HASH = hashFrozenSpec();

// Directional notional at a given equity, holding leverage constant.
export function directionalNotionalUsd(equityUsd: number): number {
  return equityUsd * STRATEGY.leverage;
}

export function assertLiveActionsDisabled(): void {
  if (PRODUCTION_BOUNDARY.live_actions_enabled !== false) {
    throw new Error("Live exchange writes are forbidden in this repository.");
  }
  if (LIVE_ACTIONS_ENABLED !== false) {
    throw new Error("live_actions_enabled must remain false.");
  }
}
