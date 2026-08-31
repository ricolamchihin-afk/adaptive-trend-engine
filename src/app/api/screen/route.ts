import { screenAsterEquities } from "@/lib/engine/screen";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const limit = Math.max(0, Number(params.get("limit") ?? 0) || 0);
    const report = await screenAsterEquities(Date.now(), limit);
    return Response.json(report);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "screen_failed" },
      { status: 500 },
    );
  }
}
