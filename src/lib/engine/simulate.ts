import { pathPrices } from "./candles";
import { STRATEGY, venueFeeRate } from "./spec";
import type { Candle, PathMode, Regime } from "./types";

export interface SimConfig {
  capitalUsd: number;
  leverage: number;
  makerRate: number;
  takerRate: number;
  gridLevels: number;
  gridRangePct: number;
  protectiveStopPct: number;
  liquidationPct: number;
}

export function defaultSimConfig(): SimConfig {
  return {
    capitalUsd: STRATEGY.capitalUsd,
    leverage: STRATEGY.leverage,
    makerRate: venueFeeRate("maker"),
    takerRate: venueFeeRate("taker"),
    gridLevels: STRATEGY.gridLevels,
    gridRangePct: STRATEGY.gridRangePct,
    protectiveStopPct: STRATEGY.protectiveStopPct,
    liquidationPct: STRATEGY.liquidationPct,
  };
}

export interface RegimeBar {
  candle: Candle;
  regime: Regime;
  pathMode: PathMode;
}

export interface SimResult {
  startEquityUsd: number;
  finalEquityUsd: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  feesUsd: number;
  perRegimePnlUsd: Record<Regime, number>;
  barsInRegime: Record<Regime, number>;
  liquidations: number;
  everLiquidated: boolean;
  everShort: boolean;
  blownUp: boolean;
}

interface GridLot {
  buyPrice: number;
  qty: number;
  sellTarget: number;
}

// Walks precomputed regime bars applying dynamic directional exposure with a
// constant-leverage sizing, a lean neutral grid, a protective stop, and a
// liquidation backstop. Equity is realized cash; open exposure is marked for
// drawdown and flattened at the end so the result fully reconciles.
export function runSimulation(bars: RegimeBar[], cfg: SimConfig): SimResult {
  let equity = cfg.capitalUsd;
  let posBtc = 0;
  let avgEntry = 0;
  let feesUsd = 0;
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let liquidations = 0;
  let everLiquidated = false;
  let everShort = false;
  let blownUp = false;

  let gridAnchor: number | null = null;
  let gridLots: GridLot[] = [];

  const perRegime: Record<Regime, number> = { LONG: 0, SHORT: 0, GRID: 0, FLAT: 0 };
  const barsInRegime: Record<Regime, number> = { LONG: 0, SHORT: 0, GRID: 0, FLAT: 0 };

  let peakEquity = equity;
  let maxDrawdownPct = 0;

  function delta(amount: number, regime: Regime) {
    equity += amount;
    perRegime[regime] += amount;
  }

  function recordClose(pnl: number) {
    trades += 1;
    if (pnl > 0) {
      wins += 1;
    } else if (pnl < 0) {
      losses += 1;
    }
  }

  function closeDirectional(price: number, regime: Regime, liquidation = false) {
    if (posBtc === 0) {
      return;
    }
    const pnl = posBtc * (price - avgEntry);
    const closeFee = Math.abs(posBtc * price) * cfg.takerRate;
    delta(pnl, regime);
    delta(-closeFee, regime);
    feesUsd += closeFee;
    recordClose(pnl);
    if (liquidation) {
      liquidations += 1;
      everLiquidated = true;
    }
    posBtc = 0;
    avgEntry = 0;
  }

  function openDirectional(sign: 1 | -1, price: number, regime: Regime) {
    if (equity <= 0) {
      blownUp = true;
      return;
    }
    const notional = equity * cfg.leverage;
    const qty = (sign * notional) / price;
    const openFee = Math.abs(qty * price) * cfg.takerRate;
    delta(-openFee, regime);
    feesUsd += openFee;
    posBtc = qty;
    avgEntry = price;
    if (qty < 0) {
      everShort = true;
    }
  }

  function flattenGrid(price: number, regime: Regime) {
    for (const lot of gridLots) {
      const pnl = (price - lot.buyPrice) * lot.qty;
      const fee = lot.qty * price * cfg.takerRate;
      delta(pnl, regime);
      delta(-fee, regime);
      feesUsd += fee;
      recordClose(pnl);
    }
    gridLots = [];
    gridAnchor = null;
  }

  function gridInventoryPnl(price: number): number {
    return gridLots.reduce((sum, lot) => sum + lot.qty * (price - lot.buyPrice), 0);
  }

  function runGridBar(candle: Candle, pathMode: PathMode, regime: Regime) {
    if (gridAnchor === null) {
      gridAnchor = candle.open;
    }
    const half = Math.max(1, Math.floor(cfg.gridLevels / 2));
    const step = (gridAnchor * cfg.gridRangePct) / half;
    const sliceNotional = (equity * cfg.leverage) / cfg.gridLevels;
    // Hard break of the range floor: flatten and stand aside until the regime updates.
    if (candle.low <= gridAnchor * (1 - cfg.gridRangePct - cfg.protectiveStopPct)) {
      flattenGrid(candle.low, regime);
      return;
    }
    for (const price of pathPrices(candle, pathMode)) {
      for (let k = 1; k <= half; k += 1) {
        const buyRung = gridAnchor - k * step;
        const held = gridLots.some((lot) => Math.abs(lot.buyPrice - buyRung) < 1e-6);
        if (price <= buyRung && !held && gridLots.length < cfg.gridLevels && sliceNotional > 0) {
          const qty = sliceNotional / buyRung;
          const fee = qty * buyRung * cfg.makerRate;
          delta(-fee, regime);
          feesUsd += fee;
          gridLots.push({ buyPrice: buyRung, qty, sellTarget: buyRung + step });
        }
      }
      for (const lot of [...gridLots]) {
        if (lot.sellTarget <= price) {
          const pnl = (lot.sellTarget - lot.buyPrice) * lot.qty;
          const fee = lot.qty * lot.sellTarget * cfg.makerRate;
          delta(pnl, regime);
          delta(-fee, regime);
          feesUsd += fee;
          recordClose(pnl);
          gridLots = gridLots.filter((item) => item !== lot);
        }
      }
    }
  }

  function checkDirectionalRisk(candle: Candle, regime: Regime) {
    if (posBtc > 0) {
      const liq = avgEntry * (1 - cfg.liquidationPct);
      const stop = avgEntry * (1 - cfg.protectiveStopPct);
      if (candle.low <= liq) {
        closeDirectional(liq, regime, true);
      } else if (candle.low <= stop) {
        closeDirectional(stop, regime);
      }
    } else if (posBtc < 0) {
      const liq = avgEntry * (1 + cfg.liquidationPct);
      const stop = avgEntry * (1 + cfg.protectiveStopPct);
      if (candle.high >= liq) {
        closeDirectional(liq, regime, true);
      } else if (candle.high >= stop) {
        closeDirectional(stop, regime);
      }
    }
  }

  for (const bar of bars) {
    const { candle, regime, pathMode } = bar;
    barsInRegime[regime] += 1;
    if (blownUp) {
      continue;
    }

    if (regime === "LONG" || regime === "SHORT" || regime === "FLAT") {
      if (gridLots.length) {
        flattenGrid(candle.open, regime);
      }
      const desired = regime === "LONG" ? 1 : regime === "SHORT" ? -1 : 0;
      const current = Math.sign(posBtc);
      if (desired === 0) {
        closeDirectional(candle.open, regime);
      } else if (current !== desired) {
        closeDirectional(candle.open, regime);
        openDirectional(desired as 1 | -1, candle.open, regime);
      }
      checkDirectionalRisk(candle, regime);
    } else {
      // GRID: no directional exposure, run the lean neutral grid.
      if (posBtc !== 0) {
        closeDirectional(candle.open, regime);
      }
      runGridBar(candle, pathMode, regime);
    }

    if (equity <= 0) {
      blownUp = true;
      equity = Math.max(0, equity);
    }

    const mark = equity + posBtc * (candle.close - avgEntry) + gridInventoryPnl(candle.close);
    peakEquity = Math.max(peakEquity, mark);
    if (peakEquity > 0) {
      maxDrawdownPct = Math.max(maxDrawdownPct, ((peakEquity - mark) / peakEquity) * 100);
    }
  }

  // Realize everything at the last close so equity fully reconciles.
  const lastBar = bars[bars.length - 1];
  if (lastBar && !blownUp) {
    const price = lastBar.candle.close;
    closeDirectional(price, lastBar.regime);
    if (gridLots.length) {
      flattenGrid(price, lastBar.regime);
    }
  }

  const closedTrades = wins + losses;
  return {
    startEquityUsd: cfg.capitalUsd,
    finalEquityUsd: equity,
    totalReturnPct: ((equity - cfg.capitalUsd) / cfg.capitalUsd) * 100,
    maxDrawdownPct,
    trades,
    wins,
    losses,
    winRatePct: closedTrades > 0 ? (wins / closedTrades) * 100 : null,
    feesUsd,
    perRegimePnlUsd: perRegime,
    barsInRegime,
    liquidations,
    everLiquidated,
    everShort,
    blownUp,
  };
}
