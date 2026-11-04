/**
 * Apply manifest findings to the graph as SUGGESTED edges (FS-09). Server-only.
 *
 * - Edge: vendor node -> service node, relation POWERS, reviewStatus SUGGESTED,
 *   confidenceTier LOW, dependencyStrength OPTIONAL (strength cannot be read from
 *   a manifest; the evidence says so). Deterministic id edge-<vendor>--<service>.
 * - Evidence: kind MANIFEST, UNVERIFIED, path = filename, contentHash = sha256 of the file.
 *   Classification: DEMO_FIXTURE in the fictional DEMO workspace (synthetic data must
 *   always be labelled as such), EXTERNAL_OBSERVED otherwise (user-supplied content).
 *   Content identical to a bundled sample-repo file is called out as a fictional sample.
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
import { ManifestError, parseManifest, type ManifestFinding } from "./manifest-import";
import { MANIFEST_IMPORT_NOTICE, type ManifestImportData, type ManifestImportRequest } from "./import-schema";

export const MANIFEST_SOURCE_SYSTEM = "manifest-import";
export const MANIFEST_AUDIT_ACTION = "manifest.imported";

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const SAMPLE_HASHES = new Set(SAMPLE_REPO_FILES.map((f) => `${f.filename}#${sha256(f.content)}`));
const suffix = (nodeId: string) => nodeId.replace(/^node-/, "");
const sourceOf = (f: ManifestFinding) => ({ filename: f.filename, token: f.token, version: f.version, line: f.line });
const providerRef = (f: ManifestFinding) => ({ id: f.provider!.id, name: f.provider!.name, category: f.provider!.category, fictional: f.provider!.fictional });

export async function importManifests(repos: Repositories, req: ManifestImportRequest, now: Date): Promise<ManifestImportData> {
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
  const classification = workspace?.mode === "DEMO" ? "DEMO_FIXTURE" : "EXTERNAL_OBSERVED";
  const out: Omit<ManifestImportData, "auditEventId" | "notice" | "incidents"> = {
    serviceNodeId: service.id,
    files: parsed.map((p) => ({ filename: p.file.filename, format: p.manifest.format, bytes: p.manifest.bytes, sha256: p.sha256, findings: p.manifest.findings.length })),
    suggested: [],
    duplicates: [],
    unmatched: [],
    unrecognizedCount: 0,
  };
  const handledEdges = new Set<string>();

  for (const { file, manifest, sha256: fileHash } of parsed) {
    out.unrecognizedCount += manifest.unparsedReferences;
    const sampleNote = SAMPLE_HASHES.has(`${file.filename}#${fileHash}`) ? "Fictional sample file. " : "";
    for (const f of manifest.findings) {
      if (!f.provider) {
        out.unrecognizedCount += 1;
        continue;
      }
      const vendor = f.provider.vendorKey ? await repos.vendors.findByNormalizedKey(f.provider.vendorKey) : null;
      const vendorNode = vendor ? await repos.nodes.findById(`node-${vendor.id}`) : null;
      if (!vendor || !vendorNode) {
        out.unmatched.push({
          provider: providerRef(f),
          source: sourceOf(f),
          reason: vendor ? `Vendor ${vendor.name} has no graph node` : `No vendor record for ${f.provider.name} in this workspace`,
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
      const evidenceId = `ev-manifest-${edgeId.replace(/^edge-/, "")}`;
      const where = f.line ? `${f.filename}:${f.line}` : f.filename;
      await repos.evidence.create({
        id: evidenceId,
        kind: "MANIFEST",
        sourceSystem: MANIFEST_SOURCE_SYSTEM,
        sourceId: `${service.id}#${f.filename}#${f.token}`,
        capturedAt: at,
        observedAt: null,
        excerpt: `${sampleNote}${where} references "${f.token}"${f.version ? ` (${f.version})` : ""}, a ${f.provider.category} (${f.provider.name}). Suggests: ${vendor.name} POWERS ${service.label}. A possible integration only: not proof it is production-critical or card-funded; dependency strength unknown (recorded as OPTIONAL until reviewed).`,
        path: f.filename,
        contentHash: fileHash,
        classification,
        verificationStatus: "UNVERIFIED",
      });
      await repos.edges.create({
        id: edgeId,
        fromNodeId: vendorNode.id,
        toNodeId: service.id,
        relation: "POWERS",
        dependencyStrength: "OPTIONAL",
        confidenceTier: "LOW",
        reviewStatus: "SUGGESTED",
        evidenceId,
      });
      out.suggested.push({ edgeId, vendorId: vendor.id, vendorName: vendor.name, provider: providerRef(f), evidenceId, source: sourceOf(f) });
    }
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
    },
    at,
  });
  const incidents = await materializeIncidents(repos, now);
  return { ...out, auditEventId: audit.id, notice: MANIFEST_IMPORT_NOTICE, incidents };
}
