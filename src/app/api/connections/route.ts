import { liveConfig } from "@/lib/engine/liveConfig";
import { loadMarket } from "@/lib/engine/market-data";
import { telegramGetMe, telegramStatus } from "@/lib/engine/notify";

export const dynamic = "force-dynamic";

// Health check for every external connection the strategy depends on. Never
// returns secrets — only whether they are present and whether the endpoint
// responded.
export async function GET() {
  const cfg = liveConfig();

  let market: { ok: boolean; source?: string; mark?: number; error?: string };
  try {
    const m = await loadMarket();
    market = { ok: (m.mark ?? 0) > 0, source: m.source, mark: m.mark ?? 0 };
  } catch (error) {
    market = { ok: false, error: error instanceof Error ? error.message : "market_failed" };
  }

  const tg = telegramStatus();
  const bot = tg.configured ? await telegramGetMe() : { ok: false, error: "not_configured" };

  const signerPresent = Boolean(process.env.EXCHANGE_API_SECRET || process.env.PHOENIX_AUTHORITY);

  return Response.json({
    generatedAt: new Date().toISOString(),
    marketData: market,
    telegram: {
      enabled: tg.enabled,
      configured: tg.configured,
      chatCount: tg.chatCount,
      botOk: bot.ok,
      botUsername: bot.ok ? bot.username : undefined,
      error: bot.ok ? undefined : bot.error,
    },
    exchange: {
      name: cfg.exchange,
      apiUrlSet: Boolean(process.env.PHOENIX_API_URL),
      apiKeyPresent: Boolean(process.env.EXCHANGE_API_KEY),
      signerPresent,
      writeAdapter: null,
      tradingConnection: "unavailable — dry-run only; no write adapter is built",
    },
  });
}
