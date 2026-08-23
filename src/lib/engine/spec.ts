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

// Single venue, single book. Phoenix, 1000 USDC, 10x. Dynamic long / short / grid.
export const STRATEGY = {
  venue: "phoenix" as const,
  capitalUsd: 1000,
  leverage: 10,
  // Regime classification is trend-based on the daily + 4h context only, so the
  // same rule works over a one-year backtest without depending on short-lookback
  // 1h/15m feeds the public API cannot serve for a whole year.
  dailyEmaPeriod: 20,
  fourHourEmaPeriod: 20,
  fourHourAdxPeriod: 14,
  adxTrendThreshold: 20,
  rsiPeriod: 14,
  rsiTailHigh: 85,
  rsiTailLow: 15,
  // Lean neutral grid (NOT the retired 80-level persistent grid).
  gridLevels: 8,
  gridRangePct: 0.04,
  // Risk controls for 10x. Protective stop sits well inside the ~9% liquidation
  // distance so an ordinary adverse swing caps the loss instead of blowing up.
  protectiveStopPct: 0.04,
  liquidationPct: 0.09,
  lotSizeBtc: 0.00001,
  minNotionalUsd: 10,
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
  strategy: "dynamic_directional_exposure",
  regimes: ["LONG", "SHORT", "GRID", "FLAT"],
  venue: STRATEGY.venue,
  capital_usd: STRATEGY.capitalUsd,
  leverage: STRATEGY.leverage,
  directional_notional_usd: STRATEGY.capitalUsd * STRATEGY.leverage,
  grid: { levels: STRATEGY.gridLevels, range_pct: STRATEGY.gridRangePct },
  risk: {
    protective_stop_pct: STRATEGY.protectiveStopPct,
    liquidation_pct: STRATEGY.liquidationPct,
  },
  retired: "phase_7_9_persistent_80_level_grid",
  exits: "regime_flip_or_protective_stop_or_liquidation",
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
