import { formatDryRunMessage, planDryRun } from "@/lib/engine/dryrun";
import { liveConfig } from "@/lib/engine/liveConfig";
import { sendTelegram, telegramStatus } from "@/lib/engine/notify";
import { getSnapshot } from "@/lib/engine/runtime";
import { STRATEGY } from "@/lib/engine/spec";

export const dynamic = "force-dynamic";

async function buildPlan() {
  const snapshot = await getSnapshot();
  const cfg = liveConfig();
  const plan = planDryRun(
    { side: snapshot.position.side, sizeBtc: snapshot.position.sizeBtc, stopPrice: snapshot.position.stopPrice },
    snapshot.market.mark,
    cfg,
    STRATEGY.capitalUsd,
  );
  return { snapshot, cfg, plan };
}

// POST triggers the dry-run Telegram alert (a notification, never a trade).
export async function POST() {
  try {
    const { snapshot, cfg, plan } = await buildPlan();
    const message = formatDryRunMessage(plan, cfg.exchange, snapshot.market.mark);
    const telegram = await sendTelegram(message);
    return Response.json({ mode: "dry_run", plan, telegram, message });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "dry_run_failed" },
      { status: 500 },
    );
  }
}

// Dry-run order preview: what the strategy would place right now from the live
// signal, sized by the .env config and clamped by the hard risk limits. Nothing
// is submitted — there is no exchange write adapter — and no secret is echoed.
export async function GET() {
  try {
    const { snapshot, cfg, plan } = await buildPlan();
    const tg = telegramStatus();
    return Response.json({
      telegram: { enabled: tg.enabled, configured: tg.configured, chatCount: tg.chatCount },
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
