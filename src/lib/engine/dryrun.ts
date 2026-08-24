import type { LiveConfig } from "./liveConfig";
import { atrSizeBtc } from "./simulate";
import { STRATEGY } from "./spec";
import type { Regime } from "./types";

export interface DryRunPlan {
  action: "OPEN_LONG" | "OPEN_SHORT" | "HOLD";
  side: Regime;
  sizeBtc: number;
  notionalUsd: number;
  entryPrice: number;
  stopPrice: number | null;
  effectiveLeverage: number;
  notionalCapped: boolean;
  // Invariants: a dry run never submits and is never live.
  dryRun: true;
  liveSubmitted: false;
  note: string;
}

export interface LiveOrderContext {
  equityUsd: number;
  atr: number;
  atrStopMult?: number;
  freshEntry: boolean;
  paperSide?: Regime;
}

function hold(mark: number, note: string): DryRunPlan {
  return {
    action: "HOLD",
    side: "FLAT",
    sizeBtc: 0,
    notionalUsd: 0,
    entryPrice: mark,
    stopPrice: null,
    effectiveLeverage: 0,
    notionalCapped: false,
    dryRun: true,
    liveSubmitted: false,
    note,
  };
}

// Formats a dry-run plan as a plain-text Telegram alert. Clearly marked as a
// preview that is never submitted.
export function formatDryRunMessage(plan: DryRunPlan, exchange: string, mark: number): string {
  const lines = [
    "[DRY RUN] Smart Grid trend follower",
    `Venue: ${exchange}  |  BTC mark: $${Math.round(mark).toLocaleString("en-US")}`,
    `Action: ${plan.action.replaceAll("_", " ")}  |  Side: ${plan.side}`,
  ];
  if (plan.action !== "HOLD") {
    lines.push(
      `Size: ${Math.abs(plan.sizeBtc).toFixed(5)} BTC ($${Math.round(plan.notionalUsd).toLocaleString("en-US")}, ${plan.effectiveLeverage.toFixed(1)}x)`,
    );
    lines.push(
      `Entry: $${Math.round(plan.entryPrice).toLocaleString("en-US")}  |  Stop: ${plan.stopPrice ? `$${Math.round(plan.stopPrice).toLocaleString("en-US")}` : "-"}`,
    );
    if (plan.notionalCapped) lines.push("Size clamped by your risk limit.");
  }
  lines.push(`Submitted: ${plan.liveSubmitted} — no live execution (preview only).`);
  return lines.join("\n");
}

// Produces the order the strategy would place right now. Size is ATR risk on
// live equity (capital ∩ collateral), not the compounded 1y paper book. A live
// open is only planned when the last 4h bar is a fresh Donchian entry.
export function planDryRun(
  position: { side: Regime; sizeBtc: number; stopPrice: number | null },
  mark: number,
  cfg: LiveConfig,
  baseCapitalUsd: number,
  live?: LiveOrderContext,
): DryRunPlan {
  if (live && !live.freshEntry) {
    const paper =
      live.paperSide && live.paperSide !== "FLAT"
        ? ` Paper book is ${live.paperSide} from an earlier bar.`
        : "";
    return hold(mark, `No new Donchian breakout on the last 4h bar.${paper} Live stays flat.`);
  }

  if (position.side === "FLAT" || position.side === "GRID" || mark <= 0) {
    return hold(mark, "No trend signal. Stand aside — no order would be placed.");
  }

  const equityUsd = live && live.equityUsd > 0 ? live.equityUsd : cfg.capitalUsd;
  const atrStopMult = live?.atrStopMult ?? STRATEGY.atrStopMult;
  let sizeBtc: number;
  if (live && live.atr > 0) {
    const abs = atrSizeBtc(equityUsd, mark, live.atr, cfg.riskPct, atrStopMult, cfg.maxLeverage);
    sizeBtc = position.side === "SHORT" ? -abs : abs;
  } else {
    const scale = baseCapitalUsd > 0 ? equityUsd / baseCapitalUsd : 1;
    sizeBtc = position.sizeBtc * scale;
  }
  let notionalUsd = Math.abs(sizeBtc) * mark;

  const leverageCap = equityUsd * cfg.maxLeverage;
  const notionalCap = cfg.maxNotionalUsd > 0 ? cfg.maxNotionalUsd : Infinity;
  const hardCap = Math.min(leverageCap, notionalCap);
  let notionalCapped = false;
  if (notionalUsd > hardCap && notionalUsd > 0) {
    const k = hardCap / notionalUsd;
    sizeBtc *= k;
    notionalUsd = hardCap;
    notionalCapped = true;
  }

  const stopDist = atrStopMult * (live && live.atr > 0 ? live.atr : 0);
  const stopPrice =
    position.stopPrice ??
    (stopDist > 0 ? (position.side === "LONG" ? mark - stopDist : mark + stopDist) : null);

  return {
    action: position.side === "LONG" ? "OPEN_LONG" : "OPEN_SHORT",
    side: position.side,
    sizeBtc,
    notionalUsd,
    entryPrice: mark,
    stopPrice,
    effectiveLeverage: equityUsd > 0 ? notionalUsd / equityUsd : 0,
    notionalCapped,
    dryRun: true,
    liveSubmitted: false,
    note: notionalCapped
      ? `Sized on $${Math.round(equityUsd)} equity — not sent. Size was clamped by your risk limit.`
      : `Sized on $${Math.round(equityUsd)} live equity (10% / ${atrStopMult}×ATR). Dry run only — not sent.`,
  };
}
