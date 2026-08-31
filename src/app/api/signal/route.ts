import { buildSignal, scanWatchlist } from "@/lib/engine/signal";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const many = params.get("symbols");
    if (many) {
      const symbols = many
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 12);
      const signals = await scanWatchlist(symbols);
      return Response.json({ generatedAt: new Date().toISOString(), signals });
    }
    const symbol = params.get("symbol") ?? "AAPL";
    const years = Math.min(5, Math.max(1, Number(params.get("years") ?? 1) || 1));
    const report = await buildSignal(symbol, years * 365);
    return Response.json(report);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "signal_failed" },
      { status: 500 },
    );
  }
}
