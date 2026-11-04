import { readOnlyContext } from "../_lib/http";
import { listSources } from "../_lib/sources";

export const dynamic = "force-dynamic";

/** GET /api/sources: evidence ledger listing. */
export async function GET(request: Request): Promise<Response> {
  return listSources(request, readOnlyContext());
}
