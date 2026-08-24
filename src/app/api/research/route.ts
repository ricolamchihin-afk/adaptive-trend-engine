import { loadBinanceSpotResearch } from "@/lib/engine/binanceVision";
import { runResearchBook } from "@/lib/engine/research";
import { STRATEGY } from "@/lib/engine/spec";

export const dynamic = "force-dynamic";

// Research only. Does not feed the live Phoenix snapshot or order path.
export async function GET() {
  try {
    const now = Date.now();
    const series = await loadBinanceSpotResearch(now);
    const windows = runResearchBook(series, now);
    return Response.json({
      researchOnly: true,
      liveUnaffected: true,
      source: "binance_spot_public",
      venueNote:
        "Binance Vision BTCUSDT spot 4h (data-api.binance.vision). Not Phoenix, not USDM perps. No funding. Frozen live mix.",
      mix: {
        donchianEntry: STRATEGY.donchianEntry,
        donchianExit: STRATEGY.donchianExit,
        riskPct: STRATEGY.riskPct,
        atrStopMult: STRATEGY.atrStopMult,
        tpAdxFactor: STRATEGY.tpAdxFactor,
        rsiLongMin: STRATEGY.rsiLongMin,
        dailyEmaPeriod: STRATEGY.dailyEmaPeriod,
        capitalUsd: STRATEGY.capitalUsd,
      },
      coverage: {
        fourHourBars: series.fourHour.length,
        dailyBars: series.daily.length,
        start: series.fourHour[0] ? new Date(series.fourHour[0].openTime).toISOString() : null,
        end: series.fourHour.length
          ? new Date(series.fourHour[series.fourHour.length - 1].openTime).toISOString()
          : null,
      },
      windows,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "research_failed" },
      { status: 500 },
    );
  }
}
