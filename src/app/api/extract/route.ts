import { extractUsEquity } from "@/lib/engine/extract";
import { US_EQUITY_WATCHLIST } from "@/lib/engine/universe";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const raw = params.get("symbols");
    const symbols = raw
      ? raw
          .split(",")
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean)
          .slice(0, 20)
      : [...US_EQUITY_WATCHLIST];
    const report = await extractUsEquity(symbols);
    return Response.json(report);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "extract_failed" },
      { status: 500 },
    );
  }
}
