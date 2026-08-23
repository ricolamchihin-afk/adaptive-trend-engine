import { createHash } from "node:crypto";
import type {
  HierarchyThresholds,
  MandateId,
  MandateSpec,
  ProductionBoundary,
  VenueSpec,
} from "./types";

export const EPOCH_ID = "phase_7_9_conservative_readiness";
export const EPOCH_TITLE = "Phase 7.9 Conservative LONG production boundary";
export const SELECTED_CANDIDATE = "conservative" as const satisfies MandateId;

export const LIVE_ACTIONS_ENABLED = false as const;

export const PRODUCTION_BOUNDARY = {
  live_actions_enabled: false,
  canary_authorized: false,
  write_adapter: null,
  credential_modules: [],
  kill_switch: "paper_flatten_only",
} as const satisfies ProductionBoundary;

export const SHARED_CONTROLS = {
  marginAllocation: 0.2,
  gridLevels: 80,
  rangePct: 0.05,
  replenishment: "aggressive_persistent",
  reanchorThresholdPct: 0.04,
  reanchorOnlyWhenFlat: true,
  // ponytail: funding stays $0 until a venue-native rate is stressed into P&L (promotion gate 9).
  fundingPlaceholderUsd: 0,
  closedCandleOnly: true,
  openingShortsProhibited: true,
  lotSizeBtc: 0.00001,
  minNotionalUsd: 10,
  researchCapitalPerVenueUsd: 800,
  researchPortfolioUsd: 4000,
  venueCount: 5,
} as const;

export const HIERARCHY_THRESHOLDS = {
  dailyEmaPeriod: 20,
  fourHourEmaPeriod: 20,
  fourHourAdxPeriod: 14,
  adxTrendThreshold: 20,
  adxHaltThreshold: 15,
  zScorePeriod: 20,
  rsiPeriod: 14,
  bbwPeriod: 20,
  bbwStd: 2,
  rsiTailHigh: 85,
  rsiTailLow: 15,
  paceFullZ: 0,
  paceFullRsi: 50,
  paceHalfZ: 1,
  paceHalfRsi: 65,
  bbwLookback: 50,
  bbwExtremeQuantile: 0.9,
} as const satisfies HierarchyThresholds;

export const VENUES: readonly VenueSpec[] = [
  {
    id: "decibel",
    label: "Decibel",
    makerFeeBps: 1.5,
    takerFeeBps: 4.5,
    feeScheduleNote:
      "Research placeholder fee schedule. Not a venue-native verified tier.",
  },
  {
    id: "n1",
    label: "N1",
    makerFeeBps: 2.0,
    takerFeeBps: 5.0,
    feeScheduleNote:
      "Research placeholder fee schedule. Not a venue-native verified tier.",
  },
  {
    id: "phoenix",
    label: "Phoenix",
    makerFeeBps: 1.2,
    takerFeeBps: 4.0,
    feeScheduleNote:
      "Research placeholder fee schedule. Not a venue-native verified tier.",
  },
  {
    id: "popdex",
    label: "Popdex",
    makerFeeBps: 2.5,
    takerFeeBps: 5.5,
    feeScheduleNote:
      "Research placeholder fee schedule. Not a venue-native verified tier.",
  },
  {
    id: "risex",
    label: "RiseX",
    makerFeeBps: 1.8,
    takerFeeBps: 4.8,
    feeScheduleNote:
      "Research placeholder fee schedule. Not a venue-native verified tier.",
  },
] as const;

export const MANDATES: Record<MandateId, MandateSpec> = {
  conservative: {
    id: "conservative",
    name: "Conservative",
    role: "selected_production_candidate",
    floorPct: 0.25,
    leverage: 10,
    liquidationBufferFloor: 0.4,
    startingNavUsd: 4000,
    venueCapitalUsd: 800,
  },
  moderate: {
    id: "moderate",
    name: "Moderate",
    role: "research_benchmark",
    floorPct: 0.5,
    leverage: 15,
    liquidationBufferFloor: 0.25,
    startingNavUsd: 4000,
    venueCapitalUsd: 800,
  },
  aggressive: {
    id: "aggressive",
    name: "Aggressive",
    role: "research_benchmark",
    floorPct: 0.75,
    leverage: 20,
    liquidationBufferFloor: 0.15,
    startingNavUsd: 4000,
    venueCapitalUsd: 800,
  },
};

export const FROZEN_SPEC = {
  epoch: EPOCH_ID,
  candidate: SELECTED_CANDIDATE,
  direction: "long_only_while_eligible_daily_4h_hierarchy_is_LONG",
  live_actions_enabled: LIVE_ACTIONS_ENABLED,
  shared: SHARED_CONTROLS,
  hierarchy: HIERARCHY_THRESHOLDS,
  venues: VENUES,
  mandates: MANDATES,
  selected_live_shape: {
    isolated_accounts: 5,
    capital_per_account_usd: "600-800",
    aggregate_capital_usd: "3000-4000",
    research_reference_usd: 4000,
    leverage_on_deployed_margin: 10,
    margin_allocation: 0.2,
    max_notional_per_venue_usd: "1200-1600",
    max_notional_aggregate_usd: "6000-8000",
    score_100_floor_pct: 0.25,
    immediate_pace: [0.25, 0.5, 1],
    remaining_deployment: "persistent_pullback_grid",
    opening_shorts: "prohibited",
    exits: "reduce_only_grid_or_hard_invalidation",
    evidence_timing: "strict_closed_candle",
  },
  promotion_requirement: {
    independent_long_transitions: 20,
    venue_native_funding: "placeholder_zero",
    live_clearance: "not_authorized",
  },
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

export function mandateSpec(id: MandateId): MandateSpec {
  return MANDATES[id];
}

export function maxNotionalUsd(id: MandateId): number {
  const mandate = MANDATES[id];
  return (
    mandate.venueCapitalUsd * SHARED_CONTROLS.marginAllocation * mandate.leverage
  );
}

export function assertLiveActionsDisabled(): void {
  if (PRODUCTION_BOUNDARY.live_actions_enabled !== false) {
    throw new Error("Live exchange writes are forbidden in this repository.");
  }
  if (LIVE_ACTIONS_ENABLED !== false) {
    throw new Error("live_actions_enabled must remain false.");
  }
}
