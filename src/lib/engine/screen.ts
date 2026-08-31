import { loadResolvedMarket } from "./asset-market";
import { evaluateSetup, type Setup, type SetupAction } from "./decide";
import { GROK_PLAYBOOK } from "./playbook";
import { defaultSimConfig } from "./simulate";
import { buildFeatures } from "./strategy";
import type { Regime } from "./types";
import type { MarketSource } from "./types";
import {
  asterEquityBases,
  fetchAsterUniverse,
  resolveAgainstUniverse,
  type AsterUniverse,
} from "./universe";

export interface PopulationRow {
  base: string;
  asterSymbol: string;
  cashTicker: string | null;
  subTypes: string[];
  status: "TRADING";
}

export interface ScreenRow {
  base: string;
  asterSymbol: string;
  cashTicker: string | null;
  source: MarketSource | "unavailable";
  mark: number | null;
  warning: string | null;
  setup: Setup;
  indicators: {
    dailyDir: 1 | -1 | 0;
    dailyEmaSlopePct: number | null;
    entryHigh: number | null;
    entryLow: number | null;
    atr: number | null;
    adx: number | null;
    rsi: number | null;
    macdHist: number | null;
    close: number | null;
    barOpenTime: string | null;
  };
  error: string | null;
}

export interface ScreenSummary {
  population: number;
  screened: number;
  failed: number;
  LONG: number;
  SHORT: number;
  FLAT: number;
  GRID: number;
  ENTER_LONG: number;
  ENTER_SHORT: number;
  WAIT: number;
}

export interface EquityScreenReport {
  generatedAt: string;
  venue: "aster_usdt_perps";
  playbook: string;
  venueRule: string;
  population: PopulationRow[];
  screens: ScreenRow[];
  summary: ScreenSummary;
  errors: Array<{ base: string; error: string }>;
}

const FLAT_SETUP: Setup = {
  bias: "FLAT",
  action: "FLAT",
  reasons: ["No closed 4h features"],
  gates: {
    dailyDir: 0,
    adxOk: false,
    rsiOk: false,
    macdOk: false,
    slopeOk: false,
    atrOk: false,
    donchianReady: false,
    breakout: false,
  },
};

export function emptySummary(): ScreenSummary {
  return {
    population: 0,
    screened: 0,
    failed: 0,
    LONG: 0,
    SHORT: 0,
    FLAT: 0,
    GRID: 0,
    ENTER_LONG: 0,
    ENTER_SHORT: 0,
    WAIT: 0,
  };
}

function bumpBias(summary: ScreenSummary, bias: Regime): void {
  switch (bias) {
    case "LONG":
      summary.LONG += 1;
      return;
    case "SHORT":
      summary.SHORT += 1;
      return;
    case "FLAT":
      summary.FLAT += 1;
      return;
    case "GRID":
      summary.GRID += 1;
      return;
    default: {
      const neverBias: never = bias;
      void neverBias;
    }
  }
}

function bumpAction(summary: ScreenSummary, action: SetupAction): void {
  switch (action) {
    case "ENTER_LONG":
      summary.ENTER_LONG += 1;
      return;
    case "ENTER_SHORT":
      summary.ENTER_SHORT += 1;
      return;
    case "WAIT":
      summary.WAIT += 1;
      return;
    case "FLAT":
      return;
    default: {
      const neverAction: never = action;
      void neverAction;
    }
  }
}

export function summarizeScreens(screens: ScreenRow[], population = screens.length): ScreenSummary {
  const summary = emptySummary();
  summary.population = population;
  summary.screened = screens.length;
  for (const row of screens) {
    if (row.error) summary.failed += 1;
    bumpBias(summary, row.setup.bias);
    bumpAction(summary, row.setup.action);
  }
  return summary;
}

export function buildPopulation(universe: AsterUniverse): PopulationRow[] {
  const etf = new Set(universe.etfBases);
  return asterEquityBases(universe).map((base) => {
    const resolved = resolveAgainstUniverse(base, universe);
    const subTypes = ["STOCK"];
    if (etf.has(base)) subTypes.push("ETF");
    return {
      base,
      asterSymbol: resolved.asterSymbol,
      cashTicker: resolved.cashTicker,
      subTypes,
      status: "TRADING",
    };
  });
}

async function screenOne(base: string, universe: AsterUniverse, now: number): Promise<ScreenRow> {
  const resolved = resolveAgainstUniverse(base, universe);
  const market = await loadResolvedMarket(resolved, now, 365);
  const features = buildFeatures(market.series);
  const last = features[features.length - 1];
  const setup = last ? evaluateSetup(last, defaultSimConfig()) : FLAT_SETUP;
  return {
    base,
    asterSymbol: resolved.asterSymbol,
    cashTicker: resolved.cashTicker,
    source: market.source,
    mark: market.mark,
    warning: market.warning,
    setup,
    indicators: {
      dailyDir: last?.dailyDir ?? 0,
      dailyEmaSlopePct: last?.dailyEmaSlopePct ?? null,
      entryHigh: last?.entryHigh ?? null,
      entryLow: last?.entryLow ?? null,
      atr: last?.atr ?? null,
      adx: last?.adx ?? null,
      rsi: last?.rsi ?? null,
      macdHist: last?.macdHist ?? null,
      close: last?.candle.close ?? null,
      barOpenTime: last ? new Date(last.candle.openTime).toISOString() : null,
    },
    error: last ? null : "no_four_hour_features",
  };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return out;
}

export async function screenAsterEquities(
  now = Date.now(),
  limit = 0,
  concurrency = 3,
): Promise<EquityScreenReport> {
  const universe = await fetchAsterUniverse(now);
  const population = buildPopulation(universe);
  const slice = limit > 0 ? population.slice(0, limit) : population;
  const screens = await mapPool(slice, concurrency, async (row) => {
    try {
      return await screenOne(row.base, universe, now);
    } catch (error) {
      return {
        base: row.base,
        asterSymbol: row.asterSymbol,
        cashTicker: row.cashTicker,
        source: "unavailable" as const,
        mark: null,
        warning: null,
        setup: { ...FLAT_SETUP, reasons: ["Screen failed"] },
        indicators: {
          dailyDir: 0 as const,
          dailyEmaSlopePct: null,
          entryHigh: null,
          entryLow: null,
          atr: null,
          adx: null,
          rsi: null,
          macdHist: null,
          close: null,
          barOpenTime: null,
        },
        error: error instanceof Error ? error.message : "screen_failed",
      };
    }
  });
  const errors = screens.filter((row) => row.error).map((row) => ({ base: row.base, error: row.error as string }));
  return {
    generatedAt: new Date(now).toISOString(),
    venue: "aster_usdt_perps",
    playbook: GROK_PLAYBOOK.version,
    venueRule: GROK_PLAYBOOK.venue.rule,
    population,
    screens,
    summary: summarizeScreens(screens, population.length),
    errors,
  };
}
