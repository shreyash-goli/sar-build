import { getDb } from "@/lib/db";
import { demoResetHandler } from "../../_lib/demo-reset";

export const dynamic = "force-dynamic";

/** POST /api/demo/reset: restore the fictional demo (DEMO_MODE + local, same-origin requests only). */
export async function POST(request: Request): Promise<Response> {
  return demoResetHandler(request, { db: getDb(), env: process.env });
}
