import { getDb } from "@/lib/db";
import { proposeActionHandler } from "../../_lib/actions";

export const dynamic = "force-dynamic";

/** POST /api/actions/propose: create a DRAFT mitigation proposal. SIMULATION ONLY: No Ramp funds changed. */
export async function POST(request: Request): Promise<Response> {
  return proposeActionHandler(request, { db: getDb(), env: process.env });
}
