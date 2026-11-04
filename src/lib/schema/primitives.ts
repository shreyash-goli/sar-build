/** Shared primitive schemas. */
import * as z from "zod";

/**
 * Canonical record identifier. Non-empty, trimmed, bounded string.
 * UUIDs are recommended for generated rows; deterministic seed IDs
 * (e.g. "fund-auth") are also accepted. Never use display names as IDs.
 */
export const IdSchema = z.string().trim().min(1, "id must be non-empty").max(128);
export type Id = z.infer<typeof IdSchema>;

/** Reference to an EvidenceRecord. Required and non-empty wherever provenance is required. */
export const EvidenceRefSchema = z
  .string({ error: "evidenceId is required" })
  .trim()
  .min(1, "evidenceId must be non-empty")
  .max(128);

/** Timezone-aware ISO-8601 timestamp (Z or explicit offset; local times rejected). */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

export const NonEmptyTextSchema = z.string().trim().min(1);

/** Arbitrary JSON value (for *Json snapshot columns). */
export const JsonValueSchema = z.json();
