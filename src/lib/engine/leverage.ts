import { VENUES } from "./spec";
import type { VenueId } from "./types";

// Usable-equity haircut before liquidation. Matches estimatedLiquidationPrice in
// sizing.ts (haircutEquity = equity * 0.9), i.e. ~10% maintenance margin. A long at
// L leverage is liquidated once price falls by usableEquityFraction / L.
export const USABLE_EQUITY_FRACTION = 0.9;

export interface LeverageParams {
  collateralUsd: number;
  leverage: number;
  entryPrice: number;
  // One-way fee as a fraction of notional (e.g. taker 4bps -> 0.0004).
  feeRatePerSide: number;
}

export interface LeverageRow {
  pricePct: number;
  price: number;
  pnlUsd: number;
  roePct: number;
  feeUsd: number;
  netPnlUsd: number;
  netRoePct: number;
  liquidated: boolean;
}

export interface LeverageTable {
  collateralUsd: number;
  leverage: number;
  entryPrice: number;
  notionalUsd: number;
  sizeBtc: number;
  feeRatePerSide: number;
  liquidationDistancePct: number;
  liquidationPrice: number;
  liquidationRoePct: number;
  // Round-trip fee cost expressed as % of collateral at entry price (the drag a
  // flat trade pays just to open and close).
  roundTripFeeRoePct: number;
  rows: LeverageRow[];
}

const DEFAULT_PRICE_PCTS = [
  -12, -9, -6, -4, -2, -1, -0.5, 0, 0.5, 1, 2, 4, 6, 9, 12,
];

function venueFeeRatePerSide(venue: VenueId, role: "maker" | "taker"): number {
  const spec = VENUES.find((item) => item.id === venue);
  if (!spec) {
    throw new Error(`unknown_venue:${venue}`);
  }
  const bps = role === "maker" ? spec.makerFeeBps : spec.takerFeeBps;
  return bps / 10_000;
}

// Long-side scenario for a single target price. Shorts are the mirror image
// (roe flips sign) but this repository does not open shorts, so only the long
// leg is modelled here.
export function leverageRow(params: LeverageParams, pricePct: number): LeverageRow {
  const { collateralUsd, leverage, entryPrice, feeRatePerSide } = params;
  const notional = collateralUsd * leverage;
  const sizeBtc = entryPrice > 0 ? notional / entryPrice : 0;
  const price = entryPrice * (1 + pricePct / 100);
  const pnlUsd = sizeBtc * (price - entryPrice);
  const entryFee = notional * feeRatePerSide;
  const exitFee = sizeBtc * price * feeRatePerSide;
  const feeUsd = entryFee + exitFee;
  const netPnlUsd = pnlUsd - feeUsd;
  const liquidationDistancePct = USABLE_EQUITY_FRACTION / leverage;
  return {
    pricePct,
    price,
    pnlUsd,
    roePct: collateralUsd > 0 ? (pnlUsd / collateralUsd) * 100 : 0,
    feeUsd,
    netPnlUsd,
    netRoePct: collateralUsd > 0 ? (netPnlUsd / collateralUsd) * 100 : 0,
    liquidated: pricePct / 100 <= -liquidationDistancePct,
  };
}

export function leverageTable(
  params: LeverageParams,
  pricePcts: number[] = DEFAULT_PRICE_PCTS,
): LeverageTable {
  const { collateralUsd, leverage, entryPrice, feeRatePerSide } = params;
  const notionalUsd = collateralUsd * leverage;
  const liquidationDistancePct = USABLE_EQUITY_FRACTION / leverage;
  return {
    collateralUsd,
    leverage,
    entryPrice,
    notionalUsd,
    sizeBtc: entryPrice > 0 ? notionalUsd / entryPrice : 0,
    feeRatePerSide,
    liquidationDistancePct,
    liquidationPrice: entryPrice * (1 - liquidationDistancePct),
    liquidationRoePct: -liquidationDistancePct * leverage * 100,
    roundTripFeeRoePct: 2 * leverage * feeRatePerSide * 100,
    rows: pricePcts.map((pricePct) => leverageRow(params, pricePct)),
  };
}

// Convenience for the console: 1000 USDC at 10x on Phoenix taker fees, anchored
// to the current mark. Capital and leverage follow VSCODE.md (Phoenix, 1000 USDC).
export function phoenixLeverageTable(entryPrice: number): LeverageTable {
  return leverageTable({
    collateralUsd: 1000,
    leverage: 10,
    entryPrice: entryPrice > 0 ? entryPrice : 100_000,
    feeRatePerSide: venueFeeRatePerSide("phoenix", "taker"),
  });
}

// Maker-fee round-trip drag, shown next to the taker table so the fee comparison
// the operator cares about is explicit rather than implied.
export function phoenixMakerRoundTripRoePct(leverage = 10): number {
  return 2 * leverage * venueFeeRatePerSide("phoenix", "maker") * 100;
}
