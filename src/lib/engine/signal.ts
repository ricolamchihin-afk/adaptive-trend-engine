import { loadResolvedMarket } from "./asset-market";
import { evaluateSetup } from "./decide";
import { GROK_PLAYBOOK } from "./playbook";
import { defaultSimConfig, runSimulation } from "./simulate";
import { STRATEGY } from "./spec";
import { buildFeatures } from "./strategy";
import {
  US_EQUITY_WATCHLIST,
  fetchAsterUniverse,
  resolveAgainstUniverse,
  type ResolvedSymbol,
} from "./universe";
import type { MarketSource } from "./types";

export interface SignalReport {
  generatedAt: string;
  symbol: string;
  route: ResolvedSymbol;
  source: MarketSource;
  mark: number | null;
  warning: string | null;
  setup: ReturnType<typeof evaluateSetup>;
  indicators: {
    dailyDir: 1 | -1 | 0;
    dailyEmaSlopePct: number | null;
    entryHigh: number | null;
    entryLow: number | null;
    exitHigh: number | null;
    exitLow: number | null;
    atr: number | null;
    adx: number | null;
    rsi: number | null;
    macdHist: number | null;
    close: number | null;
    barOpenTime: string | null;
  };
  paper: {
    side: ReturnType<typeof runSimulation>["finalSide"];
    trades: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
  };
  playbook: {
    name: string;
    systemPrompt: string;
    venueRule: string;
  };
}

let universeCache: { at: number; value: Awaited<ReturnType<typeof fetchAsterUniverse>> | null } = {
  at: 0,
  value: null,
};

async function universe(): Promise<Awaited<ReturnType<typeof fetchAsterUniverse>> | null> {
  if (universeCache.value && Date.now() - universeCache.at < 10 * 60_000) {
    return universeCache.value;
  }
  try {
    const value = await fetchAsterUniverse();
    universeCache = { at: Date.now(), value };
    return value;
  } catch {
    return universeCache.value;
  }
}

export async function buildSignal(raw: string, days = 365, now = Date.now()): Promise<SignalReport> {
  const resolved = resolveAgainstUniverse(raw, await universe());
  const market = await loadResolvedMarket(resolved, now, days);
  const features = buildFeatures(market.series);
  const last = features[features.length - 1];
  const cfg = defaultSimConfig();
  const setup = last
    ? evaluateSetup(last, cfg)
    : {
        bias: "FLAT" as const,
        action: "FLAT" as const,
        reasons: ["No closed 4h features"],
        gates: {
          dailyDir: 0 as const,
          adxOk: false,
          rsiOk: false,
          macdOk: false,
          slopeOk: false,
          atrOk: false,
          donchianReady: false,
          breakout: false,
        },
      };
  const sim = features.length ? runSimulation(features, cfg) : null;
  return {
    generatedAt: new Date(now).toISOString(),
    symbol: resolved.base,
    route: resolved,
    source: market.source,
    mark: market.mark,
    warning: market.warning,
    setup,
    indicators: {
      dailyDir: last?.dailyDir ?? 0,
      dailyEmaSlopePct: last?.dailyEmaSlopePct ?? null,
      entryHigh: last?.entryHigh ?? null,
      entryLow: last?.entryLow ?? null,
      exitHigh: last?.exitHigh ?? null,
      exitLow: last?.exitLow ?? null,
      atr: last?.atr ?? null,
      adx: last?.adx ?? null,
      rsi: last?.rsi ?? null,
      macdHist: last?.macdHist ?? null,
      close: last?.candle.close ?? null,
      barOpenTime: last ? new Date(last.candle.openTime).toISOString() : null,
    },
    paper: {
      side: sim?.finalSide ?? "FLAT",
      trades: sim?.trades ?? 0,
      totalReturnPct: sim?.totalReturnPct ?? 0,
      maxDrawdownPct: sim?.maxDrawdownPct ?? 0,
    },
    playbook: {
      name: GROK_PLAYBOOK.name,
      systemPrompt: GROK_PLAYBOOK.systemPrompt,
      venueRule: GROK_PLAYBOOK.venue.rule,
    },
  };
}

export async function scanWatchlist(symbols: string[] = [...US_EQUITY_WATCHLIST], days = 365) {
  const out: SignalReport[] = [];
  for (const symbol of symbols.slice(0, 20)) {
    out.push(await buildSignal(symbol, days));
  }
  return out;
}

export { STRATEGY, GROK_PLAYBOOK };
