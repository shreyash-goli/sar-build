import { getDb } from "@/lib/db";
import { submitActionHandler } from "../../../_lib/actions";

export const dynamic = "force-dynamic";

/** POST /api/actions/[id]/submit: server-enforced transition (409 if not allowed). SIMULATION ONLY: No Ramp funds changed. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return submitActionHandler(request, id, { db: getDb(), env: process.env });
}
