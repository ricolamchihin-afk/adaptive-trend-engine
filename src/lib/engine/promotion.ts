import { MANDATES } from "./spec";
import type { MandateSummary, PromotionGate, RuntimeState } from "./types";

export const REQUIRED_LONG_TRANSITIONS = 20;
export const REQUIRED_PAPER_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

export function evaluatePromotion(
  state: RuntimeState,
  conservative: MandateSummary | undefined,
  marketSource: string,
): { gates: PromotionGate[]; verdict: string; hold: true } {
  const worstPositive = (conservative?.worstPathPnl ?? 0) > 0;
  const allVenuesPositive = Boolean(
    conservative?.books.every((book) => book.totalPnl > 0),
  );
  const durationOk = state.paperDurationMs >= REQUIRED_PAPER_DURATION_MS;
  const transitionsOk = state.independentLongTransitions >= REQUIRED_LONG_TRANSITIONS;
  const fundingReady = false;
  const venuesConfirmed = false;

  const gates: PromotionGate[] = [
    {
      id: 1,
      title: "No liquidation under either intrabar path",
      passed: !state.invariants.everLiquidated,
      detail: state.invariants.everLiquidated
        ? "A liquidation-buffer flatten or estimated liquidation occurred."
        : "No liquidation event in this readiness epoch.",
    },
    {
      id: 2,
      title: "Positive after-cost worst-path P&L",
      passed: worstPositive,
      detail: conservative
        ? `Conservative worst-path P&L is ${conservative.worstPathPnl.toFixed(2)} USD.`
        : "Conservative books are not available.",
    },
    {
      id: 3,
      title: "Positive improvement versus the matched neutral control",
      passed: false,
      detail:
        "Phase 7.3.2 / 7.4 neutral ledgers are not in this repository. Improvement versus the original control cannot be claimed here.",
    },
    {
      id: 4,
      title: "Position never becomes short",
      passed: !state.invariants.everShort,
      detail: state.invariants.everShort
        ? "A book reported short inventory. This is a hard fail."
        : "No book has opened a short.",
    },
    {
      id: 5,
      title: "Declared exposure cap is never breached",
      passed: !state.invariants.exposureCapBreached,
      detail: `Conservative cap is ${MANDATES.conservative.venueCapitalUsd * 0.2 * MANDATES.conservative.leverage} USD notional per venue.`,
    },
    {
      id: 6,
      title: "All five venue fee schedules profitable under both paths",
      passed: allVenuesPositive,
      detail: allVenuesPositive
        ? "All Conservative venue-path books are positive after costs."
        : "At least one Conservative venue-path book is not yet positive.",
    },
    {
      id: 7,
      title: "At least 20 independent closed-candle long transitions",
      passed: transitionsOk,
      detail: `${state.independentLongTransitions} / ${REQUIRED_LONG_TRANSITIONS} independent LONG transitions in this epoch.`,
    },
    {
      id: 8,
      title: "Adequate continuous paper duration and stable reconciliation",
      passed: durationOk,
      detail: `${(state.paperDurationMs / 3600000).toFixed(1)} hours of paper time. Fourteen continuous days are required.`,
    },
    {
      id: 9,
      title: "Venue-native funding, mark and liquidation assumptions",
      passed: fundingReady && venuesConfirmed && marketSource === "hyperliquid_public",
      detail:
        "Funding remains a zero placeholder. Venue identities, contracts and liquidation schedules are unconfirmed. This gate cannot pass yet.",
    },
  ];

  return {
    gates,
    verdict: "CONSERVATIVE LONG SELECTED / HOLD FOR LIVE CLEARANCE",
    hold: true,
  };
}
