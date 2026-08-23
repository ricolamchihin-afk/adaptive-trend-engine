import { planDryRun } from "@/lib/engine/dryrun";
import { liveConfig } from "@/lib/engine/liveConfig";
import { getSnapshot } from "@/lib/engine/runtime";
import { STRATEGY } from "@/lib/engine/spec";

export const dynamic = "force-dynamic";

// Dry-run order preview: what the strategy would place right now from the live
// signal, sized by the .env config and clamped by the hard risk limits. Nothing
// is submitted — there is no exchange write adapter — and no secret is echoed.
export async function GET() {
  try {
    const snapshot = await getSnapshot();
    const cfg = liveConfig();
    const plan = planDryRun(
      { side: snapshot.position.side, sizeBtc: snapshot.position.sizeBtc, stopPrice: snapshot.position.stopPrice },
      snapshot.market.mark,
      cfg,
      STRATEGY.capitalUsd,
    );
    return Response.json({
      generatedAt: new Date().toISOString(),
      mode: "dry_run",
      liveExecutionAvailable: false,
      writeAdapter: null,
      liveTradingEnabled: cfg.liveTradingEnabled,
      exchange: cfg.exchange,
      accountLabel: cfg.accountLabel,
      credentialsPresent: cfg.credentialsPresent,
      config: {
        capitalUsd: cfg.capitalUsd,
        maxLeverage: cfg.maxLeverage,
        riskPct: cfg.riskPct,
        maxNotionalUsd: cfg.maxNotionalUsd,
        dailyLossLimitUsd: cfg.dailyLossLimitUsd,
        maxDrawdownPct: cfg.maxDrawdownPct,
      },
      market: { mark: snapshot.market.mark, source: snapshot.market.source },
      plan,
      note:
        "Preview only. No order is sent. Enabling live trading additionally requires a vetted exchange write adapter, which does not exist in this repository.",
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "dry_run_failed" },
      { status: 500 },
    );
  }
}
