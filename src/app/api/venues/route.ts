import { saveVenueConfirmations } from "@/lib/engine/venues";
import type { VenueConfirmation, VenueId } from "@/lib/engine/types";
import { rejectSecretFields } from "@/lib/engine/production";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const banned = rejectSecretFields(payload);
  if (banned) {
    return Response.json({ error: banned }, { status: 400 });
  }
  const rows = (payload.rows ?? payload) as Array<Partial<VenueConfirmation> & { id: VenueId }>;
  if (!Array.isArray(rows)) {
    return Response.json({ error: "expected_rows_array" }, { status: 400 });
  }
  try {
    const saved = await saveVenueConfirmations(rows);
    return Response.json({ rows: saved, live_actions_enabled: false });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "venue_save_failed" },
      { status: 400 },
    );
  }
}
