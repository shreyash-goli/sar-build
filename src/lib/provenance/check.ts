/**
 * Provenance integrity check (FS-21; `pnpm check:provenance`). SERVER-ONLY; read-only.
 *
 * Reports (never fixes) every way the stored workspace could show an untraceable claim:
 * - EVIDENCE_MISSING: a fund, card, vendor, charge, transaction, node, edge or incident
 *   cites an evidenceId that does not exist.
 * - EDGE_CONFIRMATION_INVALID: a CONFIRMED edge whose evidence fails checkEdgeEvidence
 *   (e.g. unreviewed model/manifest evidence, or REJECTED evidence).
 * - INCIDENT_SNAPSHOT_INVALID: an incident snapshot that does not parse, including a
 *   RiskAssertion without inputs (only UNKNOWN assertions with limitations may omit them).
 * - INCIDENT_INPUT_MISSING: an incident whose assertion cites evidence that does not exist
 *   (or whose snapshot already recorded missing evidence).
 * - ASSERTION_WITHOUT_INPUTS: belt-and-braces check of the same rule on parsed assertions.
 */
import * as z from "zod";
import { checkEdgeEvidence, type Repositories } from "@/lib/repositories";
import { RiskEvaluationSchema } from "@/lib/schema";

export const ProvenanceProblemCode = z.enum([
  "EVIDENCE_MISSING",
  "EDGE_CONFIRMATION_INVALID",
  "INCIDENT_SNAPSHOT_INVALID",
  "INCIDENT_INPUT_MISSING",
  "ASSERTION_WITHOUT_INPUTS",
]);
export type ProvenanceProblemCode = z.infer<typeof ProvenanceProblemCode>;

export type ProvenanceProblem = {
  code: ProvenanceProblemCode;
  subjectType: "FUNDING_SOURCE" | "PAYMENT_INSTRUMENT" | "VENDOR" | "VENDOR_CHARGE" | "TRANSACTION" | "NODE" | "EDGE" | "INCIDENT";
  subjectId: string;
  message: string;
};

export type ProvenanceReport = {
  ok: boolean;
  checked: Record<ProvenanceProblem["subjectType"] | "EVIDENCE", number>;
  problems: ProvenanceProblem[];
};

const SnapshotCheck = z.looseObject({
  evaluation: RiskEvaluationSchema,
  missingEvidenceIds: z.array(z.string()),
});

export async function checkProvenance(repos: Repositories): Promise<ProvenanceReport> {
  const [evidence, funds, cards, vendors, charges, transactions, nodes, edges, incidents] = await Promise.all([
    repos.evidence.list(),
    repos.fundingSources.list(),
    repos.paymentInstruments.list(),
    repos.vendors.list(),
    repos.vendorCharges.list(),
    repos.transactions.list(),
    repos.nodes.list(),
    repos.edges.list(),
    repos.incidents.list(),
  ]);
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const problems: ProvenanceProblem[] = [];

  const groups: [ProvenanceProblem["subjectType"], readonly { id: string; evidenceId: string }[]][] = [
    ["FUNDING_SOURCE", funds],
    ["PAYMENT_INSTRUMENT", cards],
    ["VENDOR", vendors],
    ["VENDOR_CHARGE", charges],
    ["TRANSACTION", transactions],
    ["NODE", nodes],
    ["EDGE", edges],
    ["INCIDENT", incidents],
  ];
  for (const [subjectType, rows] of groups) {
    for (const r of rows) {
      if (!evidenceById.has(r.evidenceId)) {
        problems.push({ code: "EVIDENCE_MISSING", subjectType, subjectId: r.id, message: `cites missing evidence ${r.evidenceId}` });
      }
    }
  }

  for (const e of edges) {
    if (e.reviewStatus !== "CONFIRMED") continue;
    const ev = evidenceById.get(e.evidenceId);
    if (!ev) continue; // already reported as EVIDENCE_MISSING
    const check = checkEdgeEvidence("CONFIRMED", ev, null);
    if (!check.ok) {
      problems.push({ code: "EDGE_CONFIRMATION_INVALID", subjectType: "EDGE", subjectId: e.id, message: `${check.reason} (evidence ${ev.id})` });
    }
  }

  for (const inc of incidents) {
    const parsed = SnapshotCheck.safeParse(inc.snapshotJson);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      problems.push({
        code: "INCIDENT_SNAPSHOT_INVALID",
        subjectType: "INCIDENT",
        subjectId: inc.id,
        message: `snapshot does not parse: ${first ? `${first.path.map(String).join(".")}: ${first.message}` : "unknown error"}`,
      });
      continue;
    }
    const a = parsed.data.evaluation.assertion;
    if (a.inputs.length === 0 && !(a.status === "UNKNOWN" && a.limitations.length > 0)) {
      problems.push({ code: "ASSERTION_WITHOUT_INPUTS", subjectType: "INCIDENT", subjectId: inc.id, message: `assertion ${a.assertionId} cites no inputs` });
    }
    const missing = new Set([
      ...a.inputs.map((i) => i.replace(/^evidence:/, "")).filter((id) => !evidenceById.has(id)),
      ...parsed.data.missingEvidenceIds,
    ]);
    if (missing.size > 0) {
      problems.push({
        code: "INCIDENT_INPUT_MISSING",
        subjectType: "INCIDENT",
        subjectId: inc.id,
        message: `assertion ${a.assertionId} cites missing evidence: ${[...missing].sort().join(", ")}`,
      });
    }
  }

  return {
    ok: problems.length === 0,
    checked: {
      EVIDENCE: evidence.length,
      FUNDING_SOURCE: funds.length,
      PAYMENT_INSTRUMENT: cards.length,
      VENDOR: vendors.length,
      VENDOR_CHARGE: charges.length,
      TRANSACTION: transactions.length,
      NODE: nodes.length,
      EDGE: edges.length,
      INCIDENT: incidents.length,
    },
    problems,
  };
}

export function formatProvenanceReport(r: ProvenanceReport): string {
  const counts = Object.entries(r.checked)
    .map(([k, v]) => `${k.toLowerCase()}=${v}`)
    .join(" ");
  if (r.ok) return `check:provenance OK (${counts})`;
  return [
    `check:provenance FAILED: ${r.problems.length} problem(s) (${counts})`,
    ...r.problems.map((p) => `  - [${p.code}] ${p.subjectType} ${p.subjectId}: ${p.message}`),
  ].join("\n");
}
