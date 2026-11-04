import { readOnlyContext } from "../_lib/http";
import { getDashboard } from "../_lib/dashboard";

export const dynamic = "force-dynamic";

/** GET /api/dashboard: Overview metrics derived from engine results. */
export async function GET(): Promise<Response> {
  return getDashboard(readOnlyContext());
}
