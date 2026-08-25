import { liveEquityReport } from "@/lib/engine/equityStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await liveEquityReport());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "equity_failed", points: [] },
      { status: 500 },
    );
  }
}
