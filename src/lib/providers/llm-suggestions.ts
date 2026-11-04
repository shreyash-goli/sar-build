/**
 * AI-assisted dependency suggestions (FS-19). Server-only.
 *
 * The model sees CURATED, NON-SECRET context only: the safe parser's findings
 * (file name, line, taxonomy-recognised token, plain semver-like version only), the approved provider taxonomy, and the
 * workspace's vendor node ids/labels. Never raw files, env values or secrets.
 * Prompt and output are bounded. Output must match a strict JSON schema, and
 * every suggestion must point at a real finding, a known provider and an
 * existing VENDOR node, or it is rejected (hallucinations are never stored).
 * Accepted suggestions are persisted by the import service as SUGGESTED edges
 * with MODEL / MODEL_SUGGESTED evidence; they need human review (FS-08).
 *
 * The model is called through an injected ModelCaller. `openAiCompatibleCaller`
 * is a minimal fetch-based client for an OpenAI-style chat-completions endpoint
 * that supports JSON mode (response_format); tested with mocked responses only
 * (no SDK dependency). Without a key the feature is AI OFF; nothing is faked.
 */
import * as z from "zod";
import type { ManifestFinding, ManifestFormat } from "./manifest-import";
import { PROVIDER_TAXONOMY, matchImage, matchNpm, matchTerraform, type ProviderEntry } from "./taxonomy";

export const LLM_SUGGESTION_RULE_ID = "llm-dependency-suggestion-v1";
export const MAX_PROMPT_FINDINGS = 200;
export const MAX_PROMPT_CHARS = 24_000;
export const MAX_MODEL_SUGGESTIONS = 20;
export const MODEL_MAX_TOKENS = 1200;
export const MODEL_TIMEOUT_MS = 20_000;

export type ModelRequest = { system: string; user: string; maxTokens: number; timeoutMs: number };
/** Returns the model's raw text output (expected to be a JSON object). */
export type ModelCaller = (req: ModelRequest) => Promise<string>;

export class ModelCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelCallError";
  }
}

export const LlmOutputSchema = z.strictObject({
  suggestions: z
    .array(
      z.strictObject({
        source: z.strictObject({ filename: z.string().min(1).max(128), token: z.string().min(1).max(256) }),
        providerId: z.string().min(1).max(64),
        vendorNodeId: z.string().min(1).max(128),
        explanation: z.string().trim().min(10).max(500),
        uncertainty: z.enum(["LOW", "MEDIUM", "HIGH"]),
      }),
    )
    .max(MAX_MODEL_SUGGESTIONS),
});
export type LlmSuggestion = z.infer<typeof LlmOutputSchema>["suggestions"][number];

export type SuggestionContext = {
  service: { id: string; label: string };
  /** `format` (when known) selects the taxonomy matcher used to ground the model's provider claim. */
  findings: (Pick<ManifestFinding, "filename" | "line" | "token" | "version"> & { format?: ManifestFormat })[];
  /** Vendor nodes with the Vendor.normalizedKey they map to (null if no vendor record). */
  vendors: { nodeId: string; label: string; normalizedKey: string | null }[];
};

export type RejectedSuggestion = {
  reason:
    | "SCHEMA"
    | "UNKNOWN_PROVIDER"
    | "UNKNOWN_NODE"
    | "PROVIDER_VENDOR_MISMATCH"
    | "PROVIDER_TOKEN_MISMATCH"
    | "TOKEN_NOT_IN_TAXONOMY"
    | "HALLUCINATED_SOURCE"
    | "DUPLICATE";
  detail: string;
};

export type AiPlan =
  | {
      status: "OK";
      accepted: LlmSuggestion[];
      rejected: RejectedSuggestion[];
      message: null;
      omittedFindings: number;
      /** false when no reference matched the taxonomy, so nothing was sent and the model was not called. */
      modelCalled: boolean;
    }
  | { status: "AI_ERROR"; accepted: []; rejected: RejectedSuggestion[]; message: string; omittedFindings: number };

const SECRETISH = /(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|xox[abpr]-|-----BEGIN|[A-Za-z0-9+/]{40,})/;
/** `scheme://user:pass@host` -> `scheme://[credentials removed]@host`, anywhere in the text. */
const URL_CREDENTIALS = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@"'?#]+@/g;
export const stripUrlCredentials = (s: string) => s.replace(URL_CREDENTIALS, "$1[credentials removed]@");
export const redact = (s: string) => {
  const stripped = stripUrlCredentials(s);
  return SECRETISH.test(stripped) ? "[redacted]" : stripped;
};

export const NON_SEMVER_PLACEHOLDER = "[non-semver spec omitted]";
// One comparator: optional operator/"v", then up to three numeric (or x/*) parts. No prerelease
// or build metadata (which can carry arbitrary text), and no ":", "/", "@", so URLs, git refs,
// file:/link:/workspace: specs and tarballs never pass.
const SEMVER_PART = /^[~^<>=]{0,2}v?\d+(\.(\d+|[xX*])){0,2}$/;
/**
 * Only plain semver-like version specs are sent to the model (e.g. "1.2.3", "^4", ">=1.2 <2",
 * "1.x || 2.x", image tag "2.1"). Anything else (prerelease/build tags, git+https://user:pass@...,
 * file:, link:, workspace:, tarball URLs, tags like "latest") is replaced by a placeholder.
 */
export function promptVersion(v: string | null): string | null {
  if (v === null) return null;
  const t = v.trim();
  if (t.length === 0 || t.length > 64) return t.length === 0 ? null : NON_SEMVER_PLACEHOLDER;
  const parts = t.split(/\s*\|\|\s*|\s+-\s+|\s+/).filter(Boolean);
  return parts.length > 0 && parts.every((p) => SEMVER_PART.test(p)) ? t : NON_SEMVER_PLACEHOLDER;
}

/** The provider the deterministic taxonomy assigns to a finding's token, or null. */
export function taxonomyProviderFor(f: { token: string; format?: ManifestFormat }): ProviderEntry | null {
  switch (f.format) {
    case "PACKAGE_JSON":
      return matchNpm(f.token);
    case "DOCKER_COMPOSE":
      return matchImage(f.token);
    case "TERRAFORM":
      return matchTerraform(f.token);
    default:
      return matchNpm(f.token) ?? matchTerraform(f.token) ?? matchImage(f.token);
  }
}

/**
 * Only findings whose token the built-in taxonomy recognises are sent: the validator rejects
 * every other token (TOKEN_NOT_IN_TAXONOMY), so arbitrary user-supplied names (which may be
 * secret-shaped) never leave the process. `omittedFindings` counts the rest.
 */
export function buildPrompt(ctx: SuggestionContext): { system: string; user: string; truncated: boolean; sentFindings: number; omittedFindings: number } {
  const known = ctx.findings.filter((f) => taxonomyProviderFor(f) !== null);
  const omittedFindings = ctx.findings.length - known.length;
  const findings = known.slice(0, MAX_PROMPT_FINDINGS).map((f) => ({
    filename: f.filename,
    line: f.line,
    token: redact(f.token),
    version: promptVersion(f.version),
  }));
  const payload = {
    service: ctx.service,
    findings,
    taxonomy: PROVIDER_TAXONOMY.map((p) => ({ id: p.id, name: p.name, category: p.category })),
    vendors: ctx.vendors.map((v) => ({ nodeId: v.nodeId, label: v.label })),
  };
  const system = [
    "You map software dependency references to payment-relevant vendors.",
    "Only use the findings, taxonomy ids and vendor node ids you are given. Never invent files, tokens, providers or nodes.",
    "A reference is a possible integration, not proof it is critical or card-funded.",
    `Respond with ONLY a JSON object: {"suggestions":[{"source":{"filename":string,"token":string},"providerId":string,"vendorNodeId":string,"explanation":string,"uncertainty":"LOW"|"MEDIUM"|"HIGH"}]} with at most ${MAX_MODEL_SUGGESTIONS} items. Return {"suggestions":[]} if nothing applies.`,
  ].join("\n");
  // Defence in depth: no URL credentials anywhere in the prompt text.
  let user = stripUrlCredentials(JSON.stringify(payload));
  let truncated = known.length > MAX_PROMPT_FINDINGS;
  while (user.length > MAX_PROMPT_CHARS && payload.findings.length > 0) {
    payload.findings = payload.findings.slice(0, Math.floor(payload.findings.length * 0.8));
    user = stripUrlCredentials(JSON.stringify(payload));
    truncated = true;
  }
  return { system, user, truncated, sentFindings: payload.findings.length, omittedFindings };
}

/** Validate raw model text against the schema AND the real context. */
export function validateModelOutput(raw: string, ctx: SuggestionContext): { accepted: LlmSuggestion[]; rejected: RejectedSuggestion[] } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { accepted: [], rejected: [{ reason: "SCHEMA", detail: "model output is not valid JSON" }] };
  }
  const parsed = LlmOutputSchema.safeParse(json);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { accepted: [], rejected: [{ reason: "SCHEMA", detail: `model output does not match the schema: ${i ? `${i.path.map(String).join(".")}: ${i.message}` : "invalid"}` }] };
  }
  const providers = new Map(PROVIDER_TAXONOMY.map((p) => [p.id, p]));
  const vendors = new Map(ctx.vendors.map((v) => [v.nodeId, v]));
  const sources = new Map(ctx.findings.map((f) => [`${f.filename}\u0000${f.token}`, f]));
  const accepted: LlmSuggestion[] = [];
  const rejected: RejectedSuggestion[] = [];
  const seen = new Set<string>();
  for (const s of parsed.data.suggestions) {
    const where = `${s.source.filename} "${redact(s.source.token)}"`;
    const finding = sources.get(`${s.source.filename}\u0000${s.source.token}`);
    const grounded = finding ? taxonomyProviderFor(finding) : null;
    if (!finding) rejected.push({ reason: "HALLUCINATED_SOURCE", detail: `${where} is not a reference found in the imported files` });
    else if (!providers.has(s.providerId)) rejected.push({ reason: "UNKNOWN_PROVIDER", detail: `${redact(s.providerId)} is not in the approved taxonomy` });
    // The model may only explain mappings the deterministic taxonomy already supports.
    else if (!grounded) rejected.push({ reason: "TOKEN_NOT_IN_TAXONOMY", detail: `${where} is not a known provider reference; the model cannot introduce new mappings` });
    else if (grounded.id !== s.providerId) rejected.push({ reason: "PROVIDER_TOKEN_MISMATCH", detail: `${where} references ${grounded.id}, not ${s.providerId}` });
    else if (!vendors.has(s.vendorNodeId)) rejected.push({ reason: "UNKNOWN_NODE", detail: `${s.vendorNodeId} is not a vendor node in this workspace` });
    else if (providers.get(s.providerId)!.vendorKey === null || providers.get(s.providerId)!.vendorKey !== vendors.get(s.vendorNodeId)!.normalizedKey) {
      rejected.push({
        reason: "PROVIDER_VENDOR_MISMATCH",
        detail: `${s.providerId} does not correspond to vendor node ${s.vendorNodeId}`,
      });
    }
    else if (seen.has(s.vendorNodeId)) rejected.push({ reason: "DUPLICATE", detail: `${s.vendorNodeId} was already suggested for this service` });
    else {
      seen.add(s.vendorNodeId);
      accepted.push(s);
    }
  }
  return { accepted, rejected };
}

/** Run the model and validate. Errors become an explicit AI_ERROR plan (never silent). */
export async function planAiSuggestions(ctx: SuggestionContext, caller: ModelCaller): Promise<AiPlan> {
  const prompt = buildPrompt(ctx);
  const { omittedFindings } = prompt;
  // Nothing recognisable to explain: the model is not called at all.
  if (prompt.sentFindings === 0) return { status: "OK", accepted: [], rejected: [], message: null, omittedFindings, modelCalled: false };
  let raw: string;
  try {
    raw = await caller({ system: prompt.system, user: prompt.user, maxTokens: MODEL_MAX_TOKENS, timeoutMs: MODEL_TIMEOUT_MS });
  } catch (e) {
    return { status: "AI_ERROR", accepted: [], rejected: [], message: `AI request failed: ${redact(e instanceof Error ? e.message : String(e))}`, omittedFindings };
  }
  const v = validateModelOutput(raw, ctx);
  if (v.accepted.length === 0 && v.rejected.some((r) => r.reason === "SCHEMA")) {
    return { status: "AI_ERROR", accepted: [], rejected: v.rejected, message: "AI output was rejected: it did not match the required JSON schema", omittedFindings };
  }
  return { status: "OK", accepted: v.accepted, rejected: v.rejected, message: null, omittedFindings, modelCalled: true };
}

/**
 * Minimal OpenAI-compatible chat-completions caller (no SDK). The key is sent only
 * in the Authorization header to the configured base URL; the response text is returned.
 */
export function openAiCompatibleCaller(
  cfg: { apiKey: string; model: string; baseUrl: string },
  fetchImpl: typeof fetch = fetch,
): ModelCaller {
  return async (req) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          max_tokens: req.maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new ModelCallError(`model API returned HTTP ${res.status}`);
      const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new ModelCallError("model API response had no message content");
      return content;
    } catch (e) {
      if (e instanceof ModelCallError) throw e;
      throw new ModelCallError(controller.signal.aborted ? `model API timed out after ${req.timeoutMs} ms` : "model API request failed");
    } finally {
      clearTimeout(timer);
    }
  };
}
