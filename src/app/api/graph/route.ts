import { readOnlyContext } from "../_lib/http";
import { getGraph } from "../_lib/graph";

export const dynamic = "force-dynamic";

/** GET /api/graph: nodes, edges, evidence display and vendor mapping status. */
export async function GET(): Promise<Response> {
  return getGraph(readOnlyContext());
}
