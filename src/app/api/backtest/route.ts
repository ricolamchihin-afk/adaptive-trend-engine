import { runBacktest } from "@/lib/engine/backtest";
import { loadMarket } from "@/lib/engine/market-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const market = await loadMarket();
    const report = runBacktest(market.series, market.source);
    return Response.json(report);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "backtest_failed" },
      { status: 500 },
    );
  }
}
