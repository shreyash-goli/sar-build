import { readOnlyContext } from "../../_lib/http";
import { getIncident } from "../../_lib/incidents";

export const dynamic = "force-dynamic";

/** GET /api/incidents/[id]: full incident, calculation, impact chains and evidence. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return getIncident(id, readOnlyContext());
}
