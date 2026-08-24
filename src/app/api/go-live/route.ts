import { goLiveReadiness } from "@/lib/engine/golive";
import { liveConfig } from "@/lib/engine/liveConfig";
import { loadMarket } from "@/lib/engine/market-data";
import { telegramGetMe, telegramStatus } from "@/lib/engine/notify";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = liveConfig();

  let marketOk = false;
  try {
    const m = await loadMarket();
    marketOk = (m.mark ?? 0) > 0;
  } catch {
    marketOk = false;
  }

  const tg = telegramStatus();
  const telegramOk = tg.configured ? (await telegramGetMe()).ok : false;

  return Response.json(goLiveReadiness(cfg, { marketOk, telegramOk }));
}
