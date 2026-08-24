import { autoLoopStatus, resumeLive } from "@/lib/engine/autoRunner";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(autoLoopStatus());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action === "resume") {
    return Response.json(await resumeLive());
  }
  return Response.json(autoLoopStatus());
}
