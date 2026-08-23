import {
  USABLE_EQUITY_FRACTION,
  phoenixLeverageTable,
  phoenixMakerRoundTripRoePct,
} from "./leverage";
import { loadMarket } from "./market-data";
import { productionBoundary } from "./production";
import { EPOCH_ID, EPOCH_TITLE, SPEC_HASH, STRATEGY } from "./spec";
import { buildFeatures } from "./strategy";
import { defaultSimConfig, runSimulation } from "./simulate";
import type { RegimeReading } from "./types";

const globalForRuntime = globalThis as typeof globalThis & {
  __smartGridPaperKill?: boolean;
};

function paperKilled(): boolean {
  return globalForRuntime.__smartGridPaperKill === true;
}

function priceLabel(value: number | null): string {
  return value === null ? "unavailable" : `$${Math.round(value).toLocaleString("en-US")}`;
}

export async function getSnapshot() {
  const market = await loadMarket();
  const features = buildFeatures(market.series);
  const sim = runSimulation(features, defaultSimConfig());
  const last = features[features.length - 1];
  const killed = paperKilled();
  const mark = market.mark ?? 0;

  const side = killed ? "FLAT" : sim.finalSide;
  const sizeBtc = side === "FLAT" ? 0 : sim.finalSizeBtc;
  const notionalUsd = Math.abs(sizeBtc) * mark;
  const liquidationDistancePct = USABLE_EQUITY_FRACTION / STRATEGY.maxLeverage;

  const readings: RegimeReading[] = [
    {
      id: "daily_trend",
      name: `Daily EMA${STRATEGY.dailyEmaPeriod} trend filter`,
      timeframe: "1d",
      formatted:
        last?.dailyDir === 1
          ? "above (longs only)"
          : last?.dailyDir === -1
            ? "below (shorts only)"
            : "unavailable",
      effect: "Gates trade direction; only trend-aligned breakouts are taken.",
    },
    {
      id: "donchian_entry",
      name: `Donchian ${STRATEGY.donchianEntry}-bar entry channel`,
      timeframe: "4h",
      formatted: `${priceLabel(last?.entryLow ?? null)} / ${priceLabel(last?.entryHigh ?? null)}`,
      effect: "A close beyond the channel is the breakout entry trigger.",
    },
    {
      id: "donchian_exit",
      name: `Donchian ${STRATEGY.donchianExit}-bar trailing exit`,
      timeframe: "4h",
      formatted: `${priceLabel(last?.exitLow ?? null)} / ${priceLabel(last?.exitHigh ?? null)}`,
      effect: "Winners run until price breaks this shorter channel.",
    },
    {
      id: "atr",
      name: `ATR(${STRATEGY.atrPeriod})`,
      timeframe: "4h",
      formatted: priceLabel(last?.atr ?? null),
      effect: `Initial stop = ${STRATEGY.atrStopMult}x ATR; size risks ${(STRATEGY.riskPct * 100).toFixed(1)}% of equity.`,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    epoch: EPOCH_ID,
    title: EPOCH_TITLE,
    specHash: SPEC_HASH,
    strategy: {
      venue: STRATEGY.venue,
      capitalUsd: STRATEGY.capitalUsd,
      maxLeverage: STRATEGY.maxLeverage,
      riskPct: STRATEGY.riskPct,
    },
    market: {
      source: market.source,
      fetchedAt: new Date(market.fetchedAt).toISOString(),
      lastClosed: market.lastClosed1m
        ? new Date(market.lastClosed1m.openTime).toISOString()
        : null,
      mark,
      warning: market.warning,
    },
    regime: {
      side,
      dailyDir: last?.dailyDir ?? 0,
      readings,
    },
    position: {
      side,
      sizeBtc,
      notionalUsd,
      entry: killed ? null : sim.finalEntry,
      stopPrice: killed ? null : sim.finalStop,
      leverage: killed ? 0 : sim.finalLeverage,
      liquidationPrice:
        side === "LONG"
          ? mark * (1 - liquidationDistancePct)
          : side === "SHORT"
            ? mark * (1 + liquidationDistancePct)
            : null,
      liquidationDistancePct,
    },
    recent: {
      windowDays: features.length ? (last.candle.openTime - features[0].candle.openTime) / 86_400_000 : 0,
      totalReturnPct: sim.totalReturnPct,
      trades: sim.trades,
      winRatePct: sim.winRatePct,
      maxDrawdownPct: sim.maxDrawdownPct,
    },
    leverage: {
      ...phoenixLeverageTable(mark),
      makerRoundTripFeeRoePct: phoenixMakerRoundTripRoePct(STRATEGY.maxLeverage),
    },
    production: productionBoundary(),
    paperKill: killed,
  };
}

export type Snapshot = Awaited<ReturnType<typeof getSnapshot>>;

export function triggerPaperKill() {
  globalForRuntime.__smartGridPaperKill = true;
  return getSnapshot();
}

export function clearPaperKill() {
  globalForRuntime.__smartGridPaperKill = false;
  return getSnapshot();
}
