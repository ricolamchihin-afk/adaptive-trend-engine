import { runPaperLab } from "@/lib/engine/paperLab";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const raw = new URL(request.url).searchParams.get("years");
    const years = Math.min(5, Math.max(1, Number(raw) || 1));
    return Response.json(await runPaperLab(years));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "paper_lab_failed" },
      { status: 500 },
    );
  }
}
