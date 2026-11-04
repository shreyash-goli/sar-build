/**
 * Evidence ledger (FS-05): resolve any record to its evidence, and list every
 * evidence record with the assertions it supports. SERVER-ONLY (uses
 * repositories); not re-exported from ./index.
 */
import { getDb } from "@/lib/db";
import { NotFoundError, createRepositories, type DbClient, type Repositories } from "@/lib/repositories";
import { WriteForbiddenError } from "@/lib/security/write-gate";
import { RiskAssertionSchema, type EvidenceRecord, type SourceClass, type VerificationStatus, type WorkspaceMode } from "@/lib/schema";
import { SourceClass as SourceClassEnum, VerificationStatus as VerificationStatusEnum, formatCents } from "@/lib/schema";
import { getEvidenceCategory } from "./definitions";
import { SOURCE_CLASS_DISPLAY, VERIFICATION_STATUS_DISPLAY, getSimulationBadge } from "./display";
import {
  EvidenceSubjectType,
  type EvidenceLedgerEntry,
  SUPERSEDED_LINEAGE_NOTE,
  type RuleLineageEntry,
  type SourcesListData,
  type SourcesListQuery,
  type SupportedAssertion,
} from "./ledger-schema";

type Citation = { evidenceId: string; assertion: SupportedAssertion };

const SUBJECT_ORDER = EvidenceSubjectType.options;
const day = (iso: string) => iso.slice(0, 10);

/** Every evidence citation in the workspace, with a readable label. */
async function loadCitations(repos: Repositories): Promise<Citation[]> {
  const [funds, cards, vendors, charges, transactions, nodes, edges, incidents] = await Promise.all([
    repos.fundingSources.list(),
    repos.paymentInstruments.list(),
    repos.vendors.list(),
    repos.vendorCharges.list(),
    repos.transactions.list(),
    repos.nodes.list(),
    repos.edges.list(),
    repos.incidents.list(),
  ]);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const nodeLabel = new Map(nodes.map((n) => [n.id, n.label]));
  const name = (m: Map<string, string>, id: string) => m.get(id) ?? `Unknown (${id})`;
  const cite = (
    subjectType: Exclude<EvidenceSubjectType, "EDGE">,
    r: { id: string; evidenceId: string },
    label: string,
  ): Citation => ({ evidenceId: r.evidenceId, assertion: { subjectType, subjectId: r.id, label, edge: null } });
  const cardKind = { VIRTUAL_CARD: "Virtual card", PHYSICAL_CARD: "Physical card", UNKNOWN: "Card" } as const;

  return [
    ...funds.map((f) => cite("FUNDING_SOURCE", f, `${f.name} (fund)`)),
    ...cards.map((c) => cite("PAYMENT_INSTRUMENT", c, `${cardKind[c.kind]} ${c.id} (metadata only)`)),
    ...vendors.map((v) => cite("VENDOR", v, `${v.name} (vendor, billing method ${v.billingMethod.toLowerCase()})`)),
    ...charges.map((c) =>
      cite("VENDOR_CHARGE", c, `${name(vendorName, c.vendorId)} charge ${formatCents(c.expectedCents)} expected ${day(c.expectedAt)}`),
    ),
    ...transactions.map((t) =>
      cite(
        "TRANSACTION",
        t,
        `${name(vendorName, t.vendorId)} ${t.state.toLowerCase()} transaction ${formatCents(t.amountCents)} on ${day(t.occurredAt)}`,
      ),
    ),
    ...nodes.map((n) => cite("NODE", n, `${n.label} (${n.kind.toLowerCase()})`)),
    ...edges.map(
      (e): Citation => ({
        evidenceId: e.evidenceId,
        assertion: {
          subjectType: "EDGE",
          subjectId: e.id,
          label: `${name(nodeLabel, e.fromNodeId)} ${e.relation} ${name(nodeLabel, e.toNodeId)}`,
          edge: { fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, relation: e.relation, reviewStatus: e.reviewStatus },
        },
      }),
    ),
    ...incidents.map((i) => cite("INCIDENT", i, i.title)),
  ];
}

function sortSupports(xs: SupportedAssertion[]): SupportedAssertion[] {
  return [...xs].sort(
    (a, b) => SUBJECT_ORDER.indexOf(a.subjectType) - SUBJECT_ORDER.indexOf(b.subjectType) || a.subjectId.localeCompare(b.subjectId),
  );
}

/**
 * Rule lineage for DERIVED evidence: the risk engine (src/lib/incidents) persists one
 * RULE/DERIVED evidence record per evaluation and cites it from the incident, whose
 * snapshotJson holds the full RiskAssertion. Read defensively; never fabricate.
 */
async function loadRuleLineage(repos: Repositories): Promise<Map<string, RuleLineageEntry[]>> {
  const out = new Map<string, RuleLineageEntry[]>();
  for (const inc of await repos.incidents.list()) {
    const snap = inc.snapshotJson as { evaluation?: { assertion?: unknown } } | null;
    const parsed = RiskAssertionSchema.safeParse(snap?.evaluation?.assertion);
    if (!parsed.success) continue;
    const a = parsed.data;
    const entry: RuleLineageEntry = { ruleId: a.ruleId, assertionId: a.assertionId, evaluatedAt: a.evaluatedAt, inputs: a.inputs };
    const list = out.get(inc.evidenceId);
    if (list) list.push(entry);
    else out.set(inc.evidenceId, [entry]);
  }
  return out;
}

type SimulatedClass = "DEMO_FIXTURE" | "RAMP_SANDBOX";

type EntryContext = {
  /** Classification of every evidence record, for scanning DERIVED inputs. */
  classOf: ReadonlyMap<string, SourceClass>;
  workspaceMode: WorkspaceMode | null;
};

const RULE_IN_EXCERPT = /\bRule ([a-z][a-z0-9-]*-v\d+);/;

/** What a RULE record itself says (sourceId "<assertionId>#<fp>", excerpt "... Rule <ruleId>; ..."). */
function recordedRuleOf(ev: EvidenceRecord): EvidenceLedgerEntry["recordedRule"] {
  if (ev.kind !== "RULE") return null;
  const [assertionId] = ev.sourceId.split("#");
  return {
    ruleId: ev.excerpt?.match(RULE_IN_EXCERPT)?.[1] ?? null,
    assertionId: assertionId ?? ev.sourceId,
    fingerprint: ev.contentHash,
    evaluatedAt: ev.capturedAt,
  };
}

/**
 * Which synthetic class (if any) a DERIVED record was computed from: scan the cited
 * inputs when known (current lineage); otherwise fall back to the workspace mode.
 */
function simulatedInputClass(lineage: readonly RuleLineageEntry[], ctx: EntryContext): SimulatedClass | null {
  const inputs = lineage.flatMap((l) => l.inputs).map((i) => ctx.classOf.get(i.replace(/^evidence:/, "")));
  if (inputs.length > 0) {
    if (inputs.includes("DEMO_FIXTURE")) return "DEMO_FIXTURE";
    if (inputs.includes("RAMP_SANDBOX")) return "RAMP_SANDBOX";
    return null;
  }
  if (ctx.workspaceMode === "DEMO") return "DEMO_FIXTURE";
  if (ctx.workspaceMode === "RAMP_SANDBOX") return "RAMP_SANDBOX";
  return null;
}

function toEntry(
  ev: EvidenceRecord,
  citations: readonly Citation[],
  lineage: readonly RuleLineageEntry[],
  ctx: EntryContext,
): EvidenceLedgerEntry {
  const d = SOURCE_CLASS_DISPLAY[ev.classification];
  const derived = ev.classification === "DERIVED";
  const simulatedFrom = derived ? simulatedInputClass(lineage, ctx) : null;
  const lineageStatus = !derived ? "NOT_APPLICABLE" : lineage.length > 0 ? "CURRENT" : "SUPERSEDED";
  return {
    id: ev.id,
    kind: ev.kind,
    classification: ev.classification,
    display: {
      label: d.label,
      shortDescription: d.shortDescription,
      tone: d.tone,
      category: getEvidenceCategory(ev.classification),
      isSimulated: d.isSimulated,
      needsReview: d.needsReview,
      // DERIVED from synthetic inputs carries the inputs' badge (classification stays DERIVED).
      badge: getSimulationBadge({ sourceClass: simulatedFrom ?? ev.classification }),
    },
    sourceSystem: ev.sourceSystem,
    sourceId: ev.sourceId,
    excerpt: ev.excerpt,
    path: ev.path,
    contentHash: ev.contentHash,
    capturedAt: ev.capturedAt,
    observedAt: ev.observedAt,
    verificationStatus: ev.verificationStatus,
    verification: { ...VERIFICATION_STATUS_DISPLAY[ev.verificationStatus] },
    supports: sortSupports(citations.map((c) => c.assertion)),
    // Only DERIVED evidence carries rule lineage, and only what an incident actually recorded.
    ruleLineage: derived ? [...lineage] : [],
    lineageStatus,
    lineageNote: lineageStatus === "SUPERSEDED" ? SUPERSEDED_LINEAGE_NOTE : null,
    recordedRule: recordedRuleOf(ev),
    derivedFromSimulatedInputs: simulatedFrom !== null,
  };
}

function groupByEvidence(citations: readonly Citation[]): Map<string, Citation[]> {
  const m = new Map<string, Citation[]>();
  for (const c of citations) {
    const list = m.get(c.evidenceId);
    if (list) list.push(c);
    else m.set(c.evidenceId, [c]);
  }
  return m;
}

/** Sources listing: every evidence record with display metadata and supported assertions. */
export async function buildEvidenceLedger(repos: Repositories, query: SourcesListQuery = {}): Promise<SourcesListData> {
  const [evidence, citations, lineage, workspaces] = await Promise.all([
    repos.evidence.list(),
    loadCitations(repos),
    loadRuleLineage(repos),
    repos.workspaces.list(),
  ]);
  const ctx: EntryContext = {
    classOf: new Map(evidence.map((e) => [e.id, e.classification])),
    workspaceMode: workspaces[0]?.mode ?? null,
  };
  const byEvidence = groupByEvidence(citations);
  const known = new Set(evidence.map((e) => e.id));

  const filtered = evidence.filter(
    (e) =>
      (query.classification === undefined || e.classification === query.classification) &&
      (query.verificationStatus === undefined || e.verificationStatus === query.verificationStatus),
  );
  const byClassification = Object.fromEntries(SourceClassEnum.options.map((c) => [c, 0])) as Record<SourceClass, number>;
  const byVerificationStatus = Object.fromEntries(VerificationStatusEnum.options.map((s) => [s, 0])) as Record<VerificationStatus, number>;
  for (const e of filtered) {
    byClassification[e.classification] += 1;
    byVerificationStatus[e.verificationStatus] += 1;
  }

  return {
    entries: filtered.map((e) => toEntry(e, byEvidence.get(e.id) ?? [], lineage.get(e.id) ?? [], ctx)),
    totals: { total: filtered.length, byClassification, byVerificationStatus },
    unresolved: citations
      .filter((c) => !known.has(c.evidenceId))
      .map((c) => ({ subjectType: c.assertion.subjectType, subjectId: c.assertion.subjectId, evidenceId: c.evidenceId })),
  };
}

/** Detail for one evidence record. Throws NotFoundError for unknown IDs. */
export async function getEvidenceLedgerEntry(repos: Repositories, evidenceId: string): Promise<EvidenceLedgerEntry> {
  const ev = await repos.evidence.getById(evidenceId);
  const citations = (await loadCitations(repos)).filter((c) => c.evidenceId === evidenceId);
  const [lineageMap, workspaces] = await Promise.all([loadRuleLineage(repos), repos.workspaces.list()]);
  const lineage = lineageMap.get(evidenceId) ?? [];
  const inputIds = lineage.flatMap((l) => l.inputs).map((i) => i.replace(/^evidence:/, ""));
  const inputs = await repos.evidence.listByIds([...new Set(inputIds)]);
  return toEntry(ev, citations, lineage, {
    classOf: new Map(inputs.map((e) => [e.id, e.classification])),
    workspaceMode: workspaces[0]?.mode ?? null,
  });
}

export type EvidenceResolution = {
  subjectType: EvidenceSubjectType;
  subjectId: string;
  evidence: EvidenceRecord;
};

/**
 * Resolve any fund/card/vendor/charge/transaction/node/edge/incident to its
 * evidence record. Throws NotFoundError if the subject or its evidence is missing.
 */
export async function resolveEvidenceForSubject(
  repos: Repositories,
  subjectType: EvidenceSubjectType,
  subjectId: string,
): Promise<EvidenceResolution> {
  const repoFor: Record<EvidenceSubjectType, { getById(id: string): Promise<{ evidenceId: string }> }> = {
    FUNDING_SOURCE: repos.fundingSources,
    PAYMENT_INSTRUMENT: repos.paymentInstruments,
    VENDOR: repos.vendors,
    VENDOR_CHARGE: repos.vendorCharges,
    TRANSACTION: repos.transactions,
    NODE: repos.nodes,
    EDGE: repos.edges,
    INCIDENT: repos.incidents,
  };
  const subject = await repoFor[subjectType].getById(subjectId);
  const evidence = await repos.evidence.findById(subject.evidenceId);
  if (evidence === null) throw new NotFoundError("EvidenceRecord", subject.evidenceId);
  return { subjectType, subjectId, evidence };
}

export const resolveEdgeEvidence = (repos: Repositories, id: string) => resolveEvidenceForSubject(repos, "EDGE", id);
export const resolveNodeEvidence = (repos: Repositories, id: string) => resolveEvidenceForSubject(repos, "NODE", id);
export const resolveChargeEvidence = (repos: Repositories, id: string) => resolveEvidenceForSubject(repos, "VENDOR_CHARGE", id);
export const resolveIncidentEvidence = (repos: Repositories, id: string) => resolveEvidenceForSubject(repos, "INCIDENT", id);

/** Read-only repositories over the app DB: any write attempt throws WriteForbiddenError. */
export function createReadOnlyRepositories(db: DbClient = getDb()): Repositories {
  return createRepositories(db, {
    writeGate: () => {
      throw new WriteForbiddenError("Read-only access");
    },
  });
}

/** Server-component convenience: Sources listing from the app DB. Empty `entries` when nothing matches. */
export function listEvidenceSources(query: SourcesListQuery = {}): Promise<SourcesListData> {
  return buildEvidenceLedger(createReadOnlyRepositories(), query);
}

/** Server-component convenience: one evidence entry, or `null` when the id does not exist. */
export async function findEvidenceSource(evidenceId: string): Promise<EvidenceLedgerEntry | null> {
  try {
    return await getEvidenceLedgerEntry(createReadOnlyRepositories(), evidenceId);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}
