/**
 * Client-safe contract for manifest import (FS-09).
 *   POST /api/imports/manifest  ManifestImportRequestSchema -> 201 apiSuccessSchema(ManifestImportDataSchema)
 * Imports only ever create SUGGESTED edges; they never affect confirmed risk until a
 * person reviews them (POST /api/graph/edges/[id]/review).
 */
import * as z from "zod";
import { IdSchema, IsoDateTimeSchema } from "../schema/primitives";
import { ReviewStatus } from "../schema/enums";
import { MAX_MANIFEST_FILES, ManifestFormat } from "./manifest-import";

export const MANIFEST_IMPORT_NOTICE =
  "Suggestions only: a manifest reference shows a possible integration, not that it is production-critical or card-funded. Review each edge before it counts.";

export const ManifestImportRequestSchema = z.strictObject({
  /** The SERVICE node the repository implements (the edges point into it). */
  serviceNodeId: IdSchema,
  importedBy: z.string().trim().min(1).max(80),
  /** Inline text only: no paths, URLs or remote fetches are accepted. */
  files: z
    .array(z.strictObject({ filename: z.string().min(1).max(128), content: z.string() }))
    .min(1)
    .max(MAX_MANIFEST_FILES),
});
export type ManifestImportRequest = z.infer<typeof ManifestImportRequestSchema>;

const Source = z.strictObject({ filename: z.string(), token: z.string(), version: z.string().nullable(), line: z.int().nullable() });
const ProviderRef = z.strictObject({ id: z.string(), name: z.string(), category: z.string(), fictional: z.boolean() });

export const ManifestImportDataSchema = z.strictObject({
  serviceNodeId: z.string(),
  files: z.array(z.strictObject({ filename: z.string(), format: ManifestFormat, bytes: z.int(), sha256: z.string(), findings: z.int() })),
  /** New SUGGESTED edges created by this import. */
  suggested: z.array(
    z.strictObject({ edgeId: z.string(), vendorId: z.string(), vendorName: z.string(), provider: ProviderRef, evidenceId: z.string(), source: Source }),
  ),
  /** Provider references whose edge already exists (any status, incl. a reviewer's REJECTED): nothing written. */
  duplicates: z.array(z.strictObject({ edgeId: z.string(), vendorId: z.string(), existingStatus: ReviewStatus, source: Source })),
  /** Known providers with no vendor/node in this workspace: reported, nothing invented. */
  unmatched: z.array(z.strictObject({ provider: ProviderRef, source: Source, reason: z.string() })),
  /** Dependencies with no taxonomy match. */
  unrecognizedCount: z.int().nonnegative(),
  auditEventId: z.string(),
  /** Risk engine re-run (suggested edges only change possible impacts, never confirmed severity). */
  incidents: z.strictObject({
    evaluatedAt: IsoDateTimeSchema,
    findings: z.int().nonnegative(),
    created: z.array(z.string()),
    updated: z.array(z.string()),
    unchanged: z.array(z.string()),
    resolved: z.array(z.string()),
    ruleEvidenceCreated: z.array(z.string()),
  }),
  notice: z.literal(MANIFEST_IMPORT_NOTICE),
});
export type ManifestImportData = z.infer<typeof ManifestImportDataSchema>;
