import {
  USABLE_EQUITY_FRACTION,
  phoenixLeverageTable,
  phoenixMakerRoundTripRoePct,
} from "./leverage";
import { loadYearMarket } from "./market-data";
import { liveConfig } from "./liveConfig";
import { PhoenixPerpExecutor } from "./phoenixExecutor";
import { productionBoundary } from "./production";
import { EPOCH_ID, EPOCH_TITLE, SPEC_HASH, STRATEGY } from "./spec";
import { buildFeatures } from "./strategy";
import { atrSizeBtc, defaultSimConfig, runSimulation } from "./simulate";
import type { Regime, RegimeReading } from "./types";

const globalForRuntime = globalThis as typeof globalThis & {
  __smartGridPaperKill?: boolean;
};

function paperKilled(): boolean {
  return globalForRuntime.__smartGridPaperKill === true;
}

export function setPaperKill(on: boolean) {
  globalForRuntime.__smartGridPaperKill = on;
}

export function isPaperKilled(): boolean {
  return paperKilled();
}

function priceLabel(value: number | null): string {
  return value === null ? "unavailable" : `$${Math.round(value).toLocaleString("en-US")}`;
}

export async function getSnapshot() {
  // Need ~1y of 4h + EMA150 daily warmup so the live signal matches the backtest
  // (short loadMarket lookback left dailyDir=0 and the book stuck FLAT).
  const [market, phoenixMark, funded] = await Promise.all([
    loadYearMarket(Date.now(), 365),
    new PhoenixPerpExecutor().btcMark().catch(() => null),
    new PhoenixPerpExecutor().accountState().catch(() => ({
      ok: false as const,
      collateralUsd: undefined as number | undefined,
      position: { side: "FLAT" as const, sizeBtc: 0, entryUsd: null as number | null },
    })),
  ]);
  const features = buildFeatures(market.series);
  const sim = runSimulation(features, defaultSimConfig());
  const last = features[features.length - 1];
  const killed = paperKilled();
  const markSource = phoenixMark && phoenixMark > 0 ? "phoenix" : "hyperliquid";
  const mark = phoenixMark && phoenixMark > 0 ? phoenixMark : (market.mark ?? 0);

  const cfg = liveConfig();
  const paperSide: Regime = killed ? "FLAT" : sim.finalSide;
  const freshEntry = !killed && sim.finalOpenedThisBar && paperSide !== "FLAT";
  const side: Regime = freshEntry ? paperSide : "FLAT";
  const atr = last?.atr ?? 0;
  const sizeAbs =
    side === "FLAT"
      ? 0
      : atrSizeBtc(cfg.capitalUsd, mark, atr, cfg.riskPct, STRATEGY.atrStopMult, cfg.maxLeverage);
  const sizeBtc = side === "SHORT" ? -sizeAbs : sizeAbs;
  const notionalUsd = Math.abs(sizeBtc) * mark;
  const stopDist = STRATEGY.atrStopMult * atr;
  const stopPrice =
    side === "LONG" && stopDist > 0 ? mark - stopDist : side === "SHORT" && stopDist > 0 ? mark + stopDist : null;
  const leverage = cfg.capitalUsd > 0 ? notionalUsd / cfg.capitalUsd : 0;
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
      markSource,
      warning: market.warning,
    },
    regime: {
      side: paperSide,
      dailyDir: last?.dailyDir ?? 0,
      readings,
    },
    position: {
      side,
      paperSide,
      freshEntry,
      sizeBtc,
      notionalUsd,
      entry: side === "FLAT" ? null : mark,
      stopPrice: killed ? null : stopPrice,
      leverage: killed ? 0 : leverage,
      liquidationPrice:
        side === "LONG"
          ? mark * (1 - liquidationDistancePct)
          : side === "SHORT"
            ? mark * (1 + liquidationDistancePct)
            : null,
      liquidationDistancePct,
      atr,
      adx: last?.adx ?? null,
      exitLow: last?.exitLow ?? null,
      exitHigh: last?.exitHigh ?? null,
      bar: last
        ? {
            openTime: last.candle.openTime,
            open: last.candle.open,
            high: last.candle.high,
            low: last.candle.low,
            close: last.candle.close,
          }
        : null,
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
    live: {
      side: funded.position?.side ?? "FLAT",
      sizeBtc: funded.position?.sizeBtc ?? 0,
      entryUsd: funded.position?.entryUsd ?? null,
      collateralUsd: funded.collateralUsd ?? null,
    },
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
