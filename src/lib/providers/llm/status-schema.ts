/** Client-safe contract for GET /api/integrations/ai/status (FS-19). */
import * as z from "zod";

export const AI_STATUS_NOTICE = "AI suggestions are hypotheses: every one stays SUGGESTED until a person reviews it.";

export const AiStatusSchema = z.strictObject({
  /** AI_OFF: no key/model configured; rules-based suggestions only. Shown as "AI OFF", never faked. */
  status: z.enum(["AI_OFF", "CONFIGURED"]),
  model: z.string().nullable(),
  /** API host only (never the key or full URL). */
  host: z.string().nullable(),
  reason: z.string().nullable(),
  missing: z.array(z.string()),
  notice: z.literal(AI_STATUS_NOTICE),
});
export type AiStatus = z.infer<typeof AiStatusSchema>;
