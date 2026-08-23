import { maxNotionalUsd, MANDATES, SHARED_CONTROLS } from "./spec";
import type { MandateId, PacePct } from "./types";
import { clamp } from "./indicators";

export interface AllocationPlan {
  mandate: MandateId;
  maxNotional: number;
  floorNotional: number;
  extensionScore: number;
  targetNotional: number;
  pace: PacePct;
  immediateNotional: number;
  gridRemainderNotional: number;
  allocatedMargin: number;
  maxBtcQty: number;
}

export function targetNotionalUsd(
  mandate: MandateId,
  extensionScore: number,
): number {
  const spec = MANDATES[mandate];
  const maxNotional = maxNotionalUsd(mandate);
  const floorNotional = maxNotional * spec.floorPct;
  const score = clamp(extensionScore, 0, 100);
  return floorNotional + (1 - score / 100) * (maxNotional - floorNotional);
}

export function planAllocation(
  mandate: MandateId,
  extensionScore: number,
  pace: PacePct,
  mark: number,
): AllocationPlan {
  const maxNotional = maxNotionalUsd(mandate);
  const floorNotional = maxNotional * MANDATES[mandate].floorPct;
  const targetNotional = targetNotionalUsd(mandate, extensionScore);
  const immediateNotional = targetNotional * pace;
  return {
    mandate,
    maxNotional,
    floorNotional,
    extensionScore: clamp(extensionScore, 0, 100),
    targetNotional,
    pace,
    immediateNotional,
    gridRemainderNotional: Math.max(0, targetNotional - immediateNotional),
    allocatedMargin: targetNotional / MANDATES[mandate].leverage,
    maxBtcQty: mark > 0 ? maxNotional / mark : 0,
  };
}

export function roundLot(qty: number): number {
  const lot = SHARED_CONTROLS.lotSizeBtc;
  const rounded = Math.floor(qty / lot + 1e-12) * lot;
  return Number(rounded.toFixed(8));
}

export function qtyForNotional(notional: number, price: number): number {
  if (price <= 0 || notional < SHARED_CONTROLS.minNotionalUsd) {
    return 0;
  }
  return roundLot(notional / price);
}

export function estimatedLiquidationPrice(
  avgEntry: number,
  inventoryBtc: number,
  equityUsd: number,
): number | null {
  if (inventoryBtc <= 0 || avgEntry <= 0) {
    return null;
  }
  const notional = inventoryBtc * avgEntry;
  const haircutEquity = equityUsd * 0.9;
  const distance = haircutEquity / notional;
  if (distance <= 0) {
    return avgEntry;
  }
  return avgEntry * (1 - distance);
}

export function liquidationBufferPct(
  mark: number,
  avgEntry: number,
  inventoryBtc: number,
  equityUsd: number,
): number {
  if (inventoryBtc <= 0) {
    return 1;
  }
  const liq = estimatedLiquidationPrice(avgEntry, inventoryBtc, equityUsd);
  if (liq === null || mark <= 0) {
    return 1;
  }
  return clamp((mark - liq) / mark, 0, 1);
}
