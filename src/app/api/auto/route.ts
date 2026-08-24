import { autoLoopStatus } from "@/lib/engine/autoRunner";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(autoLoopStatus());
}
