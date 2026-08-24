export type PathMode = "low_first" | "high_first";
export type MarketSource =
  | "hyperliquid_public"
  | "binance_spot_public"
  | "offline_synthetic_fallback";
export type VenueId = "phoenix";

// Dynamic directional exposure. The strategy is one of these at any decision:
//   LONG: trending up, hold +leverage notional
//   SHORT: trending down, hold -leverage notional
//   GRID: ranging, run a lean neutral grid around the anchor
//   FLAT: halt / ineligible / conflict, hold no exposure
export type Regime = "LONG" | "SHORT" | "GRID" | "FLAT";

export interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
  intervalMs: number;
}

export interface MarketSeries {
  daily: Candle[];
  fourHour: Candle[];
  oneHour: Candle[];
  fifteen: Candle[];
  oneMinute: Candle[];
  nativeFundingRate: number | null;
}

export interface VenueSpec {
  id: VenueId;
  label: string;
  makerFeeBps: number;
  takerFeeBps: number;
  feeScheduleNote: string;
}

export interface ProductionBoundary {
  live_actions_enabled: false;
  canary_authorized: false;
  write_adapter: null;
  credential_modules: [];
  kill_switch: "paper_flatten_only";
}

export interface RegimeReading {
  id: string;
  name: string;
  timeframe: string;
  formatted: string;
  effect: string;
}

export interface RegimeDecision {
  decisionTime: number;
  regime: Regime;
  reason: string;
  dailyBullish: boolean | null;
  fourHourUp: boolean | null;
  fourHourDown: boolean | null;
  fourHourAdx: number | null;
  fourHourRsi: number | null;
  trending: boolean;
  eligible: boolean;
  readings: RegimeReading[];
}
