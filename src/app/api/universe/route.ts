import { GROK_PLAYBOOK } from "@/lib/engine/playbook";
import { US_EQUITY_WATCHLIST, fetchAsterUniverse, resolveAgainstUniverse } from "@/lib/engine/universe";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const live = await fetchAsterUniverse();
    const watchlist = US_EQUITY_WATCHLIST.map((symbol) => resolveAgainstUniverse(symbol, live));
    return Response.json({
      generatedAt: new Date().toISOString(),
      venue: GROK_PLAYBOOK.venue,
      aster: live,
      watchlist,
      aws: GROK_PLAYBOOK.aws,
      datasets: GROK_PLAYBOOK.datasets,
    });
  } catch (error) {
    return Response.json(
      {
        generatedAt: new Date().toISOString(),
        venue: GROK_PLAYBOOK.venue,
        aster: null,
        watchlist: US_EQUITY_WATCHLIST.map((symbol) => resolveAgainstUniverse(symbol, null)),
        aws: GROK_PLAYBOOK.aws,
        error: error instanceof Error ? error.message : "universe_failed",
      },
      { status: 200 },
    );
  }
}
