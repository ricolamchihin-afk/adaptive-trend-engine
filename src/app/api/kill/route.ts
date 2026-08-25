import { killLive } from "@/lib/engine/autoRunner";

export const dynamic = "force-dynamic";

export async function POST() {
  const auto = await killLive();
  return Response.json({
    ok: true,
    paperOnly: false,
    flattened: auto.lastTick?.action === "CLOSE",
    auto,
  });
}
