import { formatDryRunMessage, planDryRun } from "@/lib/engine/dryrun";
import { getExecutor } from "@/lib/engine/executor";
import { liveConfig, liveEquityUsd } from "@/lib/engine/liveConfig";
import { sendTelegram, telegramStatus } from "@/lib/engine/notify";
import { PhoenixPerpExecutor } from "@/lib/engine/phoenixExecutor";
import { getSnapshot } from "@/lib/engine/runtime";
import { STRATEGY } from "@/lib/engine/spec";

export const dynamic = "force-dynamic";

async function buildPlan() {
  const snapshot = await getSnapshot();
  const cfg = liveConfig();
  const funded = await new PhoenixPerpExecutor().accountState().catch(() => ({ ok: false as const, collateralUsd: undefined }));
  const equityUsd = liveEquityUsd(cfg.capitalUsd, funded.collateralUsd, cfg.compound);
  const plan = planDryRun(
    { side: snapshot.position.side, sizeBtc: snapshot.position.sizeBtc, stopPrice: snapshot.position.stopPrice },
    snapshot.market.mark,
    cfg,
    STRATEGY.capitalUsd,
    {
      equityUsd,
      atr: snapshot.position.atr,
      atrStopMult: STRATEGY.atrStopMult,
      freshEntry: snapshot.position.freshEntry,
      paperSide: snapshot.position.paperSide,
    },
  );
  return { snapshot, cfg, plan, equityUsd, collateralUsd: funded.collateralUsd };
}

// POST triggers the dry-run Telegram alert (a notification, never a trade).
export async function POST() {
  try {
    const { snapshot, cfg, plan } = await buildPlan();
    const executor = getExecutor(cfg);
    let execution = { submitted: false, live: false, message: plan.note };
    if (executor.canTrade && plan.action !== "HOLD") {
      execution = await executor.submit({
        action: plan.action,
        side: plan.side === "SHORT" ? "SHORT" : "LONG",
        sizeBtc: plan.sizeBtc,
        notionalUsd: plan.notionalUsd,
        price: plan.entryPrice,
      });
    }
    const message = formatDryRunMessage(
      { ...plan, liveSubmitted: execution.submitted, note: execution.message },
      cfg.exchange,
      snapshot.market.mark,
    );
    const telegram = await sendTelegram(message);
    return Response.json({
      mode: executor.canTrade ? "live" : "dry_run",
      plan: { ...plan, liveSubmitted: execution.submitted, dryRun: !execution.submitted, note: execution.message },
      execution,
      telegram,
      message,
    });
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
    const { snapshot, cfg, plan, equityUsd, collateralUsd } = await buildPlan();
    const tg = telegramStatus();
    return Response.json({
      telegram: { enabled: tg.enabled, configured: tg.configured, chatCount: tg.chatCount },
      generatedAt: new Date().toISOString(),
      mode: getExecutor(cfg).canTrade ? "live" : "dry_run",
      liveExecutionAvailable: getExecutor(cfg).canTrade,
      writeAdapter: getExecutor(cfg).name,
      liveTradingEnabled: cfg.liveTradingEnabled,
      exchange: cfg.exchange,
      accountLabel: cfg.accountLabel,
      credentialsPresent: cfg.credentialsPresent,
      config: {
        capitalUsd: cfg.capitalUsd,
        equityUsd,
        collateralUsd: collateralUsd ?? null,
        maxLeverage: cfg.maxLeverage,
        riskPct: cfg.riskPct,
        maxNotionalUsd: cfg.maxNotionalUsd,
        dailyLossLimitUsd: cfg.dailyLossLimitUsd,
        maxDrawdownPct: cfg.maxDrawdownPct,
      },
      market: { mark: snapshot.market.mark, source: snapshot.market.source },
      plan,
      note:
        getExecutor(cfg).canTrade
          ? "Live execution is armed. POST /api/dry-run submits the current long/short plan as a Phoenix market order."
          : "Preview only. No order is sent until LIVE_TRADING_ENABLED and PHOENIX_ADAPTER_VERIFIED are both true.",
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "dry_run_failed" },
      { status: 500 },
    );
  }
}
