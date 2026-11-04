import { getDb } from "@/lib/db";
import { getActionHandler } from "../../_lib/actions";

export const dynamic = "force-dynamic";

/** GET /api/actions/[id]: one proposal with its audit history. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return getActionHandler(id, { db: getDb(), env: process.env });
}
