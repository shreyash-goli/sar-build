/**
 * POST /api/imports/manifest handler body (FS-09; testable without Next).
 * Demo mode only; the body is size-capped before parsing; content is text and is never executed.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { isDemoModeEnabled } from "@/lib/env";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { ManifestImportRequestSchema, type ManifestImportRequest } from "@/lib/providers/import-schema";
import { readLlmConfig } from "@/lib/providers/llm/config";
import { openAiCompatibleCaller, planAiSuggestions, type AiPlan, type ModelCaller } from "@/lib/providers/llm-suggestions";
import { importManifests } from "@/lib/providers/import-service";
import { MAX_MANIFEST_BYTES, MAX_MANIFEST_FILES, parseManifest } from "@/lib/providers/manifest-import";
import { createRepositories } from "@/lib/repositories";
import { WriteForbiddenError } from "@/lib/security/write-gate";
import { getNow } from "@/lib/time";
import { ApiFailure, buildMeta, handle, jsonData } from "./http";
import { readAuthorizedJsonBody } from "./request";

type Env = Readonly<Record<string, string | undefined>>;
const DEMO_ONLY = "Manifest import is available only in demo mode (DEMO_MODE=true)";
/** Whole request cap: every file at the per-file limit plus JSON overhead. */
export const MAX_IMPORT_REQUEST_BYTES = MAX_MANIFEST_FILES * MAX_MANIFEST_BYTES * 2 + 16 * 1024;

/** Build the AI plan OUTSIDE the DB transaction (a network call must never hold it open). */
async function aiPlanFor(ctx: ImportContext, req: ManifestImportRequest): Promise<AiPlan> {
  const cfg = readLlmConfig(ctx.env);
  if (cfg.status === "AI_OFF") {
    throw new ApiFailure("NOT_CONFIGURED", `${cfg.reason}. Use suggester "rules", or configure an OpenAI-style chat-completions LLM (JSON mode required).`, {
      reason: "AI_OFF",
      missing: cfg.missing,
    });
  }
  const repos = createReadOnlyRepositories(ctx.db);
  const service = await repos.nodes.findById(req.serviceNodeId);
  const findings = req.files.flatMap((f) => {
    try {
      return parseManifest(f).findings;
    } catch {
      return []; // invalid files are rejected (400) by the import itself before any write
    }
  });
  const vendorRows = await repos.vendors.list();
  const vendors = (await repos.nodes.list())
    .filter((n) => n.kind === "VENDOR")
    .map((n) => ({ nodeId: n.id, label: n.label, normalizedKey: vendorRows.find((v) => `node-${v.id}` === n.id)?.normalizedKey ?? null }));
  const caller = ctx.modelCaller ?? openAiCompatibleCaller(cfg);
  return planAiSuggestions({ service: { id: req.serviceNodeId, label: service?.label ?? req.serviceNodeId }, findings, vendors }, caller);
}

export type ImportContext = {
  db: PrismaClient;
  env: Env;
  /** Injected in tests; otherwise an OpenAI-compatible fetch caller is built from LLM_* env. */
  modelCaller?: ModelCaller;
};

export function importManifestHandler(request: Request, ctx: ImportContext): Promise<Response> {
  return handle(async () => {
    // Refuse before reading anything from the body.
    const gate = () => {
      if (!isDemoModeEnabled(ctx.env)) throw new WriteForbiddenError(DEMO_ONLY);
    };
    const body = await readAuthorizedJsonBody(request, ManifestImportRequestSchema, gate, {
      maxBytes: MAX_IMPORT_REQUEST_BYTES,
      reason: "MANIFEST_TOO_LARGE",
      invalidMessage: "Invalid import",
    });
    const now = getNow({ env: ctx.env });
    const ai = body.suggester === "ai" ? await aiPlanFor(ctx, body) : undefined;
    const data = await ctx.db.$transaction(
      (tx) => importManifests(createRepositories(tx, { writeGate: gate, demoResetGate: gate }), body, now, { ai }),
      { timeout: 30_000, maxWait: 30_000 },
    );
    return jsonData(data, await buildMeta({ repos: createReadOnlyRepositories(ctx.db), env: ctx.env }), 201);
  });
}
