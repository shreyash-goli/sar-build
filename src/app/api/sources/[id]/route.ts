import { readOnlyContext } from "../../_lib/http";
import { getSource } from "../../_lib/sources";

export const dynamic = "force-dynamic";

/** GET /api/sources/[id]: one evidence record and the assertions it supports. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return getSource(id, readOnlyContext());
}
