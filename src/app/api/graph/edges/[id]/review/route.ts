import { getDb } from "@/lib/db";
import { reviewEdgeHandler } from "../../../../_lib/graph-review";

export const dynamic = "force-dynamic";

/** POST /api/graph/edges/[id]/review: confirm or reject a SUGGESTED edge (demo mode; audited). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return reviewEdgeHandler(request, id, { db: getDb(), env: process.env });
}
