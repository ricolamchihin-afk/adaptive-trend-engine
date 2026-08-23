import { triggerPaperKill } from "@/lib/engine/runtime";

export const dynamic = "force-dynamic";

export async function POST() {
  const snapshot = await triggerPaperKill();
  return Response.json({
    ok: true,
    paperOnly: true,
    live_actions_enabled: false,
    snapshot,
  });
}
