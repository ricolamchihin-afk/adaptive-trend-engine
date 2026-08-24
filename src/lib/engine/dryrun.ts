import type { LiveConfig } from "./liveConfig";
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

// Produces the order the strategy would place right now to match the live signal,
// scaled to the configured capital and clamped by the hard risk limits. It never
// submits: liveSubmitted is always false. There is no exchange write adapter.
export function planDryRun(
  position: { side: Regime; sizeBtc: number; stopPrice: number | null },
  mark: number,
  cfg: LiveConfig,
  baseCapitalUsd: number,
): DryRunPlan {
  if (position.side === "FLAT" || position.side === "GRID" || mark <= 0) {
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
      note: "No trend signal. Stand aside — no order would be placed.",
    };
  }

  const scale = baseCapitalUsd > 0 ? cfg.capitalUsd / baseCapitalUsd : 1;
  let sizeBtc = position.sizeBtc * scale;
  let notionalUsd = Math.abs(sizeBtc) * mark;

  const leverageCap = cfg.capitalUsd * cfg.maxLeverage;
  const notionalCap = cfg.maxNotionalUsd > 0 ? cfg.maxNotionalUsd : Infinity;
  const hardCap = Math.min(leverageCap, notionalCap);
  let notionalCapped = false;
  if (notionalUsd > hardCap && notionalUsd > 0) {
    const k = hardCap / notionalUsd;
    sizeBtc *= k;
    notionalUsd = hardCap;
    notionalCapped = true;
  }

  return {
    action: position.side === "LONG" ? "OPEN_LONG" : "OPEN_SHORT",
    side: position.side,
    sizeBtc,
    notionalUsd,
    entryPrice: mark,
    stopPrice: position.stopPrice,
    effectiveLeverage: cfg.capitalUsd > 0 ? notionalUsd / cfg.capitalUsd : 0,
    notionalCapped,
    dryRun: true,
    liveSubmitted: false,
    note: notionalCapped
      ? "Dry run only — not sent. Size was clamped by your risk limit."
      : "Dry run only — not sent.",
  };
}
