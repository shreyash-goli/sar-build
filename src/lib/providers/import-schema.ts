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
  /**
   * "rules" (default): the deterministic taxonomy matcher. "ai": an LLM maps findings to vendors
   * (FS-19); requires LLM_API_KEY + LLM_MODEL, otherwise 503 AI OFF (never a silent fallback).
   */
  suggester: z.enum(["rules", "ai"]).optional(),
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
  /** Which suggester produced `suggested`, and why (never silent). */
  suggester: z.strictObject({
    requested: z.enum(["rules", "ai"]),
    used: z.enum(["RULES", "AI"]),
    /** OK; or AI_ERROR when the AI request failed or was rejected and rules were used instead (explicitly). */
    status: z.enum(["OK", "AI_ERROR"]),
    message: z.string().nullable(),
    /** Model suggestions that failed validation (hallucinated sources, unknown providers/nodes, schema). */
    rejected: z.array(z.strictObject({ reason: z.string(), detail: z.string() })),
    /** AI only: findings NOT sent to the model because the built-in taxonomy does not recognise them. Null when no AI plan was made. */
    omittedFindings: z.int().nonnegative().nullable(),
  }),
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
