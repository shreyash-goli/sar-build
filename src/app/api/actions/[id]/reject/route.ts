import { getDb } from "@/lib/db";
import { rejectActionHandler } from "../../../_lib/actions";

export const dynamic = "force-dynamic";

/** POST /api/actions/[id]/reject: server-enforced transition (409 if not allowed). SIMULATION ONLY: No Ramp funds changed. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return rejectActionHandler(request, id, { db: getDb(), env: process.env });
}
