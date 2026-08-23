export type MandateId = "conservative" | "moderate" | "aggressive";
export type PathMode = "low_first" | "high_first";
export type Thesis = "LONG" | "FLAT";
export type PacePct = 0.25 | 0.5 | 1;
export type MarketSource = "hyperliquid_public" | "offline_synthetic_fallback";
export type VenueId = "decibel" | "n1" | "phoenix" | "popdex" | "risex";

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

export interface VenueSpec {
  id: VenueId;
  label: string;
  makerFeeBps: number;
  takerFeeBps: number;
  feeScheduleNote: string;
}

export interface MandateSpec {
  id: MandateId;
  name: string;
  role: "selected_production_candidate" | "research_benchmark";
  floorPct: number;
  leverage: number;
  liquidationBufferFloor: number;
  startingNavUsd: number;
  venueCapitalUsd: number;
}

export interface HierarchyThresholds {
  dailyEmaPeriod: number;
  fourHourEmaPeriod: number;
  fourHourAdxPeriod: number;
  adxTrendThreshold: number;
  adxHaltThreshold: number;
  zScorePeriod: number;
  rsiPeriod: number;
  bbwPeriod: number;
  bbwStd: number;
  rsiTailHigh: number;
  rsiTailLow: number;
  paceFullZ: number;
  paceFullRsi: number;
  paceHalfZ: number;
  paceHalfRsi: number;
  bbwLookback: number;
  bbwExtremeQuantile: number;
}

export interface ProductionBoundary {
  live_actions_enabled: false;
  canary_authorized: false;
  write_adapter: null;
  credential_modules: [];
  kill_switch: "paper_flatten_only";
}

export interface IndicatorReading {
  id: string;
  name: string;
  timeframe: string;
  value: number | null;
  formatted: string;
  threshold: string;
  effect: string;
  authority: string;
  status: "active" | "inactive" | "unavailable" | "halt";
}

export interface HierarchyDecision {
  decisionTime: number;
  availableAt: number;
  thesis: Thesis;
  hardHalt: boolean;
  haltReason: string | null;
  dataEligible: boolean;
  ineligibilityReason: string | null;
  extensionScore: number | null;
  pace: PacePct | null;
  dailyBullish: boolean | null;
  fourHourLong: boolean | null;
  fourHourAdx: number | null;
  fourHourZ: number | null;
  fourHourRsi: number | null;
  oneHourRsi: number | null;
  oneHourBbw: number | null;
  fifteenZ: number | null;
  fifteenRsi: number | null;
  nativeFundingRate: number | null;
  fundingApplied: false;
  indicators: IndicatorReading[];
  explanation: string;
}

export type OrderKind =
  | "market_starter"
  | "grid_bid"
  | "reduce_only_ask"
  | "flatten";

export interface WorkingOrder {
  id: string;
  kind: OrderKind;
  side: "buy" | "sell";
  price: number;
  qty: number;
  reduceOnly: boolean;
  levelIndex: number | null;
  feeRole: "maker" | "taker";
}

export interface FillRecord {
  time: number;
  orderId: string;
  kind: OrderKind;
  side: "buy" | "sell";
  price: number;
  qty: number;
  feeUsd: number;
  reduceOnly: boolean;
  realizedHarvestUsd: number;
}

export interface BookState {
  mandate: MandateId;
  venue: VenueId;
  pathMode: PathMode;
  capitalUsd: number;
  cashUsd: number;
  inventoryBtc: number;
  avgEntry: number;
  anchorPrice: number;
  lastMark: number;
  paused: boolean;
  pauseReason: string | null;
  targetNotional: number;
  immediateNotional: number;
  exposureUsd: number;
  gridHarvestGross: number;
  inventoryMtmPnl: number;
  fees: number;
  funding: number;
  totalPnl: number;
  liquidationBufferPct: number;
  deploymentStatus: string;
  workingOrders: WorkingOrder[];
  lastFillTime: number | null;
  flattenEvents: number;
  starterFills: number;
  longTransitionCount: number;
}

export interface MandateSummary {
  mandate: MandateId;
  name: string;
  role: MandateSpec["role"];
  selected: boolean;
  targetNotionalPerVenue: number;
  targetNotionalAggregate: number;
  immediateNotionalPerVenue: number;
  gridRemainderPerVenue: number;
  worstPathNav: number;
  worstPathPnl: number;
  bestPathNav: number;
  gridHarvestGross: number;
  inventoryMtmPnl: number;
  fees: number;
  funding: number;
  maxExposureUsd: number;
  minBufferPct: number;
  everShort: boolean;
  everLiquidated: boolean;
  exposureCapBreached: boolean;
  deploymentStatus: string;
  books: BookState[];
}

export interface PromotionGate {
  id: number;
  title: string;
  passed: boolean;
  detail: string;
}

export interface VenueConfirmation {
  id: VenueId;
  label: string;
  confirmed: boolean;
  accountLabel: string;
  reportedFreeCollateralUsd: number | null;
  btcContract: string;
  collateralMode: string;
  notes: string;
  updatedAt: number | null;
}

export interface DryRunIntent {
  clientOrderId: string;
  time: number;
  mandate: MandateId;
  venue: VenueId;
  pathMode: PathMode;
  kind: OrderKind;
  side: "buy" | "sell";
  price: number;
  qty: number;
  reduceOnly: boolean;
  liveSubmitted: false;
  note: string;
}

export interface ShadowEvent {
  time: number;
  type: string;
  message: string;
  mandate?: MandateId;
}

export interface RuntimeState {
  epoch: string;
  specHash: string;
  createdAt: number;
  updatedAt: number;
  executionCursor: number;
  epochStartOpenTime: number;
  marketSource: MarketSource;
  paperDurationMs: number;
  independentLongTransitions: number;
  lastHierarchy: HierarchyDecision | null;
  books: BookState[];
  intents: DryRunIntent[];
  events: ShadowEvent[];
  paperKillSwitch: boolean;
  invariants: {
    everShort: boolean;
    everLiquidated: boolean;
    exposureCapBreached: boolean;
  };
}
