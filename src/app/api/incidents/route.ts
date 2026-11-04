import { readOnlyContext } from "../_lib/http";
import { listIncidents } from "../_lib/incidents";

export const dynamic = "force-dynamic";

/** GET /api/incidents: sort/filter incidents (severity, status, category, signal, q, sort). */
export async function GET(request: Request): Promise<Response> {
  return listIncidents(request, readOnlyContext());
}
