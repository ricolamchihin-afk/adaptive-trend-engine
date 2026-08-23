import { getSnapshot } from "@/lib/engine/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getSnapshot();
    return Response.json(snapshot);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "snapshot_failed",
        live_actions_enabled: false,
      },
      { status: 500 },
    );
  }
}
