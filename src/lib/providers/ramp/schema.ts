/**
 * Client-safe contract for the read-only Ramp integration (FS-18).
 *   GET  /api/integrations/ramp/status -> apiSuccessSchema(RampStatusSchema)
 *   POST /api/integrations/ramp/sync   -> apiSuccessSchema(RampSyncResultSchema)  (503 when not configured)
 */
import * as z from "zod";
import { WorkspaceMode } from "../../schema/enums";
import { IsoDateTimeSchema } from "../../schema/primitives";

export const RAMP_LABEL = "READ-ONLY RAMP SANDBOX" as const;
export const RAMP_NOTICE = "Read-only: FailSafe never writes to Ramp, moves money, or requests card numbers.";

const ResourceStatus = z.enum(["OK", "PARTIAL", "FAILED"]);
export const RampResourceResultSchema = z.strictObject({
  status: ResourceStatus,
  fetched: z.int().nonnegative(),
  created: z.int().nonnegative(),
  updated: z.int().nonnegative(),
  unchanged: z.int().nonnegative(),
  skipped: z.array(z.strictObject({ id: z.string(), reason: z.string() })),
  error: z.string().nullable(),
  truncated: z.boolean(),
});

export const RampSyncResultSchema = z.strictObject({
  label: z.literal(RAMP_LABEL),
  /** OK, PARTIAL (some resources failed/skipped), FAILED (nothing read). Never reported as success otherwise. */
  status: ResourceStatus,
  syncedAt: IsoDateTimeSchema,
  resources: z.strictObject({ funds: RampResourceResultSchema, cards: RampResourceResultSchema, transactions: RampResourceResultSchema }),
  incidents: z.unknown().nullable(),
  notice: z.literal(RAMP_NOTICE),
});
export type RampSyncResultView = z.infer<typeof RampSyncResultSchema>;

export const RampStatusSchema = z.strictObject({
  /** NOT_CONFIGURED: UI shows "Ramp sandbox: Not connected" with `missing`; never a mock connection. */
  status: z.enum(["NOT_CONFIGURED", "CONFIGURED"]),
  host: z.string().nullable(),
  sandbox: z.boolean().nullable(),
  reason: z.string().nullable(),
  missing: z.array(z.string()),
  label: z.literal(RAMP_LABEL),
  workspaceMode: WorkspaceMode.nullable(),
  /** Sync is allowed only when configured AND the workspace is RAMP_SANDBOX. */
  syncAllowed: z.boolean(),
  syncBlockedReason: z.string().nullable(),
  lastSync: z.strictObject({ at: IsoDateTimeSchema, status: ResourceStatus }).nullable(),
  notice: z.literal(RAMP_NOTICE),
});
export type RampStatus = z.infer<typeof RampStatusSchema>;
