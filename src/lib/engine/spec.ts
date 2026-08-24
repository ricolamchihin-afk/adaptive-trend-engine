import { createHash } from "node:crypto";
import type { ProductionBoundary, VenueSpec } from "./types";

export const EPOCH_ID = "adaptive_trend_engine_v1";
export const EPOCH_TITLE = "Adaptive Trend Engine";

export const LIVE_ACTIONS_ENABLED = false as const;

export const PRODUCTION_BOUNDARY = {
  live_actions_enabled: false,
  canary_authorized: false,
  write_adapter: null,
  credential_modules: [],
  kill_switch: "paper_flatten_only",
} as const satisfies ProductionBoundary;

// Phoenix, 1000 USDC. Turtle-style trend follower on 4h:
// Donchian 55/7, daily EMA(150), ATR(14)×2 stop, 10% equity risk, RSI 50/50,
// dynamic TP = 1.2×ADX (clamped 10–60%). Leverage 20x is a cap; ATR sizing
// typically runs ~4x. In-sample 2.28y: Sharpe ~1.9, ~15x, ~38% DD.
export const STRATEGY = {
  venue: "phoenix" as const,
  capitalUsd: 1000,
  // Leverage is a hard ceiling; ATR risk sizing sets the actual position.
  leverage: 20,
  maxLeverage: 20,
  dailyEmaPeriod: 150,
  donchianEntry: 55,
  donchianExit: 7,
  adxPeriod: 14,
  adxThreshold: 0,
  rsiPeriod: 14,
  rsiLongMin: 50,
  rsiShortMax: 50,
  takeProfitRoePct: 0,
  tpAdxFactor: 1.2,
  tpMinRoePct: 10,
  tpMaxRoePct: 60,
  macdFilter: 0,
  emaSlopeMinPct: 0,
  atrPeriod: 14,
  atrStopMult: 2,
  riskPct: 0.10,
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
