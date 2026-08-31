import { GROK_PLAYBOOK } from "@/lib/engine/playbook";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(GROK_PLAYBOOK);
}
