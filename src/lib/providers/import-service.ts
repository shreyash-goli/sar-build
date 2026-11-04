/**
 * Apply manifest findings to the graph as SUGGESTED edges (FS-09). Server-only.
 *
 * - Edge: vendor node -> service node, relation POWERS, reviewStatus SUGGESTED,
 *   confidenceTier LOW, dependencyStrength OPTIONAL (strength cannot be read from
 *   a manifest; the evidence says so). Deterministic id edge-<vendor>--<service>.
 * - Evidence: kind MANIFEST, UNVERIFIED, path = filename, contentHash = sha256 of the file.
 *   Classification: DEMO_FIXTURE for any bundled fictional sample-repo file (in ANY
 *   workspace) and for everything imported into the fictional DEMO workspace (synthetic
 *   data must always be labelled as such); EXTERNAL_OBSERVED for user-supplied content
 *   elsewhere. Sample content is also called out in the excerpt.
 * - Dedupe: if an edge (from, to, POWERS) already exists in ANY status, nothing is
 *   written (a reviewer's REJECTED decision is respected on re-import). Within
 *   one import, the first reference wins.
 * - Unknown providers or providers without a vendor record are reported, never invented.
 * - Re-runs the risk engine (suggested edges only change "possible impacts").
 * Call inside a transaction.
 */
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { materializeIncidents } from "@/lib/incidents";
import { NotFoundError, RepositoryError, type Repositories } from "@/lib/repositories";
import { SAMPLE_REPO_FILES } from "@/fixtures/sample-repo";
import type { GraphNode, Vendor } from "@/lib/schema";
import { LLM_SUGGESTION_RULE_ID, type AiPlan } from "./llm-suggestions";
import { ManifestError, parseManifest, type ManifestFinding } from "./manifest-import";
import { PROVIDER_TAXONOMY, type ProviderEntry } from "./taxonomy";
import { MANIFEST_IMPORT_NOTICE, type ManifestImportData, type ManifestImportRequest } from "./import-schema";

export const MANIFEST_SOURCE_SYSTEM = "manifest-import";
export const MANIFEST_AUDIT_ACTION = "manifest.imported";
export const LLM_SOURCE_SYSTEM = "llm-suggestion";

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const SAMPLE_HASHES = new Set(SAMPLE_REPO_FILES.map((f) => `${f.filename}#${sha256(f.content)}`));
const suffix = (nodeId: string) => nodeId.replace(/^node-/, "");
const sourceOf = (f: ManifestFinding) => ({ filename: f.filename, token: f.token, version: f.version, line: f.line });

export type ImportOptions = {
  /** A validated AI plan (FS-19). Absent: rules. status AI_ERROR: rules, explicitly labelled. */
  ai?: AiPlan;
};

export async function importManifests(
  repos: Repositories,
  req: ManifestImportRequest,
  now: Date,
  options: ImportOptions = {},
): Promise<ManifestImportData> {
  const service = await repos.nodes.findById(req.serviceNodeId);
  if (!service) throw new NotFoundError("Node", req.serviceNodeId);
  if (service.kind !== "SERVICE") {
    throw new RepositoryError("BAD_REQUEST", `Node ${service.id} is a ${service.kind}; manifests describe SERVICE nodes`, { field: "serviceNodeId" });
  }
  const names = req.files.map((f) => f.filename);
  if (new Set(names).size !== names.length) throw new RepositoryError("BAD_REQUEST", "Duplicate filenames in one import", { field: "files" });

  // Parse everything first: any invalid file rejects the whole import before writes.
  const parsed = req.files.map((file) => {
    try {
      return { file, manifest: parseManifest(file), sha256: sha256(file.content) };
    } catch (e) {
      if (e instanceof ManifestError) {
        throw new RepositoryError("BAD_REQUEST", e.message, { reason: `MANIFEST_${e.code}`, filename: e.filename });
      }
      throw e;
    }
  });

  const at = iso(now);
  const [workspace] = await repos.workspaces.list();
  const workspaceIsDemo = workspace?.mode === "DEMO";
  const out: Omit<ManifestImportData, "auditEventId" | "notice" | "incidents" | "suggester"> = {
    serviceNodeId: service.id,
    files: parsed.map((p) => ({ filename: p.file.filename, format: p.manifest.format, bytes: p.manifest.bytes, sha256: p.sha256, findings: p.manifest.findings.length })),
    suggested: [],
    duplicates: [],
    unmatched: [],
    unrecognizedCount: 0,
  };
  const handledEdges = new Set<string>();
  const useAi = options.ai?.status === "OK";

  // Candidates: (finding, provider, explanation?) pairs from the rules matcher or validated AI output.
  type Candidate = {
    finding: ManifestFinding;
    provider: ProviderEntry;
    vendorNodeId: string | null;
    ai: { explanation: string; uncertainty: "LOW" | "MEDIUM" | "HIGH" } | null;
    file: (typeof parsed)[number];
  };
  const candidates: Candidate[] = [];
  for (const p of parsed) {
    out.unrecognizedCount += p.manifest.unparsedReferences;
    for (const f of p.manifest.findings) {
      if (useAi) {
        const s = options.ai!.accepted.find((a) => a.source.filename === f.filename && a.source.token === f.token);
        const provider = s ? PROVIDER_TAXONOMY.find((t) => t.id === s.providerId) : undefined;
        if (!s || !provider) {
          out.unrecognizedCount += 1;
          continue;
        }
        candidates.push({ finding: f, provider, vendorNodeId: s.vendorNodeId, ai: { explanation: s.explanation, uncertainty: s.uncertainty }, file: p });
      } else if (!f.provider) {
        out.unrecognizedCount += 1;
      } else {
        candidates.push({ finding: f, provider: f.provider, vendorNodeId: null, ai: null, file: p });
      }
    }
  }

  for (const { finding: f, provider, vendorNodeId, ai, file: p } of candidates) {
    const isSample = SAMPLE_HASHES.has(`${p.file.filename}#${p.sha256}`);
    const sampleNote = isSample ? "Fictional sample file. " : "";
    const pRef = { id: provider.id, name: provider.name, category: provider.category, fictional: provider.fictional };
    let vendor: Vendor | null;
    let vendorNode: GraphNode | null;
    if (ai) {
      vendorNode = vendorNodeId ? await repos.nodes.findById(vendorNodeId) : null;
      vendor = vendorNode ? await repos.vendors.findById(suffix(vendorNode.id)) : null;
    } else {
      vendor = provider.vendorKey ? await repos.vendors.findByNormalizedKey(provider.vendorKey) : null;
      vendorNode = vendor ? await repos.nodes.findById(`node-${vendor.id}`) : null;
    }
    if (!vendor || !vendorNode) {
      out.unmatched.push({
        provider: pRef,
        source: sourceOf(f),
        reason: vendor ? `Vendor ${vendor.name} has no graph node` : `No vendor record for ${provider.name} in this workspace`,
      });
      continue;
    }
    const edgeId = `edge-${suffix(vendorNode.id)}--${suffix(service.id)}`;
    const existing = (await repos.edges.list()).find(
      (e) => e.fromNodeId === vendorNode.id && e.toNodeId === service.id && e.relation === "POWERS",
    );
    if (existing) {
      out.duplicates.push({ edgeId: existing.id, vendorId: vendor.id, existingStatus: existing.reviewStatus, source: sourceOf(f) });
      continue;
    }
    if (handledEdges.has(edgeId)) {
      out.duplicates.push({ edgeId, vendorId: vendor.id, existingStatus: "SUGGESTED", source: sourceOf(f) });
      continue;
    }
    handledEdges.add(edgeId);
    const where = f.line ? `${f.filename}:${f.line}` : f.filename;
    const evidenceId = `${ai ? "ev-ai-" : "ev-manifest-"}${edgeId.replace(/^edge-/, "")}`;
    await repos.evidence.create(
      ai
        ? {
            id: evidenceId,
            kind: "MODEL",
            sourceSystem: LLM_SOURCE_SYSTEM,
            sourceId: `${service.id}#${f.filename}#${f.token}#${LLM_SUGGESTION_RULE_ID}`,
            capturedAt: at,
            observedAt: null,
            excerpt: `AI suggestion: not a fact until reviewed. ${sampleNote}${where} references "${f.token}". Model: ${ai.explanation} (uncertainty ${ai.uncertainty}). Suggests: ${vendor.name} POWERS ${service.label}.`,
            path: f.filename,
            contentHash: p.sha256,
            classification: "MODEL_SUGGESTED",
            verificationStatus: "UNVERIFIED",
          }
        : {
            id: evidenceId,
            kind: "MANIFEST",
            sourceSystem: MANIFEST_SOURCE_SYSTEM,
            sourceId: `${service.id}#${f.filename}#${f.token}`,
            capturedAt: at,
            observedAt: null,
            excerpt: `${sampleNote}${where} references "${f.token}"${f.version ? ` (${f.version})` : ""}, a ${provider.category} (${provider.name}). Suggests: ${vendor.name} POWERS ${service.label}. A possible integration only: not proof it is production-critical or card-funded; dependency strength unknown (recorded as OPTIONAL until reviewed).`,
            path: f.filename,
            contentHash: p.sha256,
            classification: isSample || workspaceIsDemo ? "DEMO_FIXTURE" : "EXTERNAL_OBSERVED",
            verificationStatus: "UNVERIFIED",
          },
    );
    await repos.edges.create({
      id: edgeId,
      fromNodeId: vendorNode.id,
      toNodeId: service.id,
      relation: "POWERS",
      dependencyStrength: "OPTIONAL",
      // Model certainty never exceeds MEDIUM confidence; a review is still required either way.
      confidenceTier: ai?.uncertainty === "LOW" ? "MEDIUM" : "LOW",
      reviewStatus: "SUGGESTED",
      evidenceId,
    });
    out.suggested.push({ edgeId, vendorId: vendor.id, vendorName: vendor.name, provider: pRef, evidenceId, source: sourceOf(f) });
  }

  const audit = await repos.auditEvents.create({
    id: `audit-${randomUUID()}`,
    actor: req.importedBy,
    action: MANIFEST_AUDIT_ACTION,
    subjectId: service.id,
    detailsJson: {
      files: out.files,
      suggestedEdgeIds: out.suggested.map((s) => s.edgeId),
      duplicateEdgeIds: out.duplicates.map((d) => d.edgeId),
      unmatched: out.unmatched.map((u) => u.provider.id),
      unrecognizedCount: out.unrecognizedCount,
      suggester: { requested: req.suggester ?? "rules", used: useAi ? "AI" : "RULES", aiStatus: options.ai?.status ?? null },
    },
    at,
  });
  const incidents = await materializeIncidents(repos, now);
  const requested = req.suggester ?? "rules";
  const suggester = {
    requested,
    used: useAi ? ("AI" as const) : ("RULES" as const),
    status: options.ai?.status === "AI_ERROR" ? ("AI_ERROR" as const) : ("OK" as const),
    message: options.ai?.status === "AI_ERROR" ? `${options.ai.message}. Rules-based suggestions were used instead.` : null,
    rejected: options.ai?.rejected ?? [],
    omittedFindings: options.ai?.omittedFindings ?? null,
  };
  return { ...out, auditEventId: audit.id, suggester, notice: MANIFEST_IMPORT_NOTICE, incidents };
}
