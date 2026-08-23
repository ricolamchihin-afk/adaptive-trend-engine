import {
  USABLE_EQUITY_FRACTION,
  phoenixLeverageTable,
  phoenixMakerRoundTripRoePct,
} from "./leverage";
import { loadMarket } from "./market-data";
import { productionBoundary } from "./production";
import { EPOCH_ID, EPOCH_TITLE, SPEC_HASH, STRATEGY } from "./spec";
import { classifyRegime } from "./strategy";

const globalForRuntime = globalThis as typeof globalThis & {
  __smartGridPaperKill?: boolean;
};

function paperKilled(): boolean {
  return globalForRuntime.__smartGridPaperKill === true;
}

export async function getSnapshot() {
  const market = await loadMarket();
  const decision = classifyRegime(market.series, market.fetchedAt);
  const mark = market.mark ?? 0;
  const killed = paperKilled();

  const regime = killed ? "FLAT" : decision.regime;
  const notionalUsd = STRATEGY.capitalUsd * STRATEGY.leverage;
  const sizeBtc = mark > 0 ? notionalUsd / mark : 0;
  const side = regime === "LONG" ? "LONG" : regime === "SHORT" ? "SHORT" : "FLAT";
  const liquidationDistancePct = USABLE_EQUITY_FRACTION / STRATEGY.leverage;
  const liquidationPrice =
    side === "LONG"
      ? mark * (1 - liquidationDistancePct)
      : side === "SHORT"
        ? mark * (1 + liquidationDistancePct)
        : null;

  return {
    generatedAt: new Date().toISOString(),
    epoch: EPOCH_ID,
    title: EPOCH_TITLE,
    specHash: SPEC_HASH,
    strategy: {
      venue: STRATEGY.venue,
      capitalUsd: STRATEGY.capitalUsd,
      leverage: STRATEGY.leverage,
      notionalUsd,
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
      regime,
      reason: killed ? "paper_kill_switch" : decision.reason,
      dailyBullish: decision.dailyBullish,
      fourHourUp: decision.fourHourUp,
      fourHourDown: decision.fourHourDown,
      fourHourAdx: decision.fourHourAdx,
      fourHourRsi: decision.fourHourRsi,
      trending: decision.trending,
      eligible: decision.eligible,
      readings: decision.readings,
    },
    position: {
      side,
      sizeBtc: side === "FLAT" ? 0 : side === "SHORT" ? -sizeBtc : sizeBtc,
      notionalUsd: side === "FLAT" ? 0 : notionalUsd,
      entry: side === "FLAT" ? null : mark,
      liquidationPrice,
      liquidationDistancePct,
    },
    leverage: {
      ...phoenixLeverageTable(mark),
      makerRoundTripFeeRoePct: phoenixMakerRoundTripRoePct(STRATEGY.leverage),
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
