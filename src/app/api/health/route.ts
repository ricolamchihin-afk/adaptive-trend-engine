import { LIVE_ACTIONS_ENABLED, SPEC_HASH, EPOCH_ID } from "@/lib/engine/spec";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    epoch: EPOCH_ID,
    specHash: SPEC_HASH,
    live_actions_enabled: LIVE_ACTIONS_ENABLED,
    write_adapter: null,
  });
}

export async function POST() {
  return new Response("Method Not Allowed", { status: 405 });
}
