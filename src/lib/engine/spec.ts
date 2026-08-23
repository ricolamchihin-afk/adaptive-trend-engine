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
  dailyEmaPeriod: 50,
  // Donchian breakout windows (4h bars). Entry on the longer channel, exit on the
  // shorter one so winners run and losers are cut at the reversal. The one-variable
  // sweep found a 10-bar exit is the most robust return/Sharpe improvement across
  // both the 1y and 2y windows (faster loss-cutting).
  donchianEntry: 55,
  donchianExit: 10,
  // ADX trend-strength gate. The sweep showed a strict gate hurt returns, so it is
  // disabled (threshold 0); the ADX is still reported for context.
  adxPeriod: 14,
  adxThreshold: 0,
  // ATR sizing + initial stop.
  atrPeriod: 14,
  atrStopMult: 2,
  // Risk a fixed fraction of equity per trade; volatility sets the size. 5% is the
  // CAGR-maximizing, momentum-capturing setting (validated across 1/2/3y): it roughly
  // doubles return vs 2% and produces several +20% months and ~+48% best months, at
  // the cost of a deeper (~46%) drawdown. Beyond ~10% volatility drag ruins the account.
  riskPct: 0.05,
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
