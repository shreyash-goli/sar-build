import { publicLlmStatus, readLlmConfig } from "@/lib/providers/llm/config";
import { AI_STATUS_NOTICE } from "@/lib/providers/llm/status-schema";
import { buildMeta, handle, jsonData, readOnlyContext } from "../../../_lib/http";

export const dynamic = "force-dynamic";

/** GET /api/integrations/ai/status: AI_OFF or CONFIGURED (never returns the key). */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const ctx = readOnlyContext();
    return jsonData({ ...publicLlmStatus(readLlmConfig(process.env)), notice: AI_STATUS_NOTICE }, await buildMeta(ctx));
  });
}
