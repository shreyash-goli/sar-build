import { getDb } from "@/lib/db";
import { runScenario } from "../../_lib/scenarios";

export const dynamic = "force-dynamic";

/** POST /api/scenarios/run: SIMULATION ONLY counterfactual (demo mode). Never changes stored funds. */
export async function POST(request: Request): Promise<Response> {
  return runScenario(request, { db: getDb(), env: process.env });
}
