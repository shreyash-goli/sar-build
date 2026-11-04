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
 * - SCHEMA_INVALID: a stored row that does not satisfy its FS-02 schema (e.g. an evidence
 *   kind/classification mismatch, or an enum value the schema does not know). Such rows are
 *   itemized with their first issue and excluded from the other checks.
 *
 * Rows are read with raw, read-only SELECTs on purpose: the typed Prisma client (and the
 * repositories, which re-validate) throw on the first malformed row, which would abort the
 * whole check instead of reporting every problem. Exit 2 is reserved for real I/O failures.
 */
import * as z from "zod";
import type { DbClient } from "@/lib/repositories";
import { checkEdgeEvidence } from "@/lib/repositories";
import {
  EdgeSchema,
  EvidenceRecordSchema,
  FundingSourceSchema,
  IncidentSchema,
  NodeSchema,
  PaymentInstrumentSchema,
  RiskEvaluationSchema,
  TransactionSchema,
  VendorChargeSchema,
  VendorSchema,
  type EvidenceRecord,
  type GraphEdge,
  type Incident,
} from "@/lib/schema";

export const ProvenanceProblemCode = z.enum([
  "EVIDENCE_MISSING",
  "EDGE_CONFIRMATION_INVALID",
  "INCIDENT_SNAPSHOT_INVALID",
  "INCIDENT_INPUT_MISSING",
  "ASSERTION_WITHOUT_INPUTS",
  "SCHEMA_INVALID",
]);
export type ProvenanceProblemCode = z.infer<typeof ProvenanceProblemCode>;

export type ProvenanceProblem = {
  code: ProvenanceProblemCode;
  subjectType: "EVIDENCE" | "FUNDING_SOURCE" | "PAYMENT_INSTRUMENT" | "VENDOR" | "VENDOR_CHARGE" | "TRANSACTION" | "NODE" | "EDGE" | "INCIDENT";
  subjectId: string;
  message: string;
};

export type ProvenanceReport = {
  ok: boolean;
  checked: Record<ProvenanceProblem["subjectType"], number>;
  problems: ProvenanceProblem[];
};

const SnapshotCheck = z.looseObject({
  evaluation: RiskEvaluationSchema,
  missingEvidenceIds: z.array(z.string()),
});

type RawRow = Record<string, unknown>;

/** Raw row -> domain shape: BigInt -> number, Date / *At ISO text -> canonical "...Z", snapshotJson text -> JSON. */
function normalize(row: RawRow): RawRow {
  const out: RawRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "bigint") out[k] = v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v;
    else if (v instanceof Date) out[k] = Number.isNaN(v.getTime()) ? v : v.toISOString().replace(".000Z", "Z");
    else if (k.endsWith("At") && typeof v === "string" && !Number.isNaN(Date.parse(v))) out[k] = new Date(v).toISOString().replace(".000Z", "Z");
    else if (k === "snapshotJson" && typeof v === "string") {
      try {
        out[k] = JSON.parse(v) as unknown;
      } catch {
        out[k] = v;
      }
    } else out[k] = v;
  }
  return out;
}

async function readTable(db: DbClient, table: string): Promise<RawRow[]> {
  // Read-only raw SELECT (see header): table names are fixed literals, never user input.
  return (await db.$queryRawUnsafe<RawRow[]>(`SELECT * FROM "${table}" ORDER BY "id"`)).map(normalize);
}

function decode<T>(
  rows: readonly RawRow[],
  schema: z.ZodType<T>,
  subjectType: ProvenanceProblem["subjectType"],
  problems: ProvenanceProblem[],
): T[] {
  const ok: T[] = [];
  for (const row of rows) {
    const r = schema.safeParse(row);
    if (r.success) ok.push(r.data);
    else {
      const first = r.error.issues[0];
      problems.push({
        code: "SCHEMA_INVALID",
        subjectType,
        subjectId: typeof row.id === "string" ? row.id : "(no id)",
        message: `row does not match its schema: ${first ? `${first.path.map(String).join(".") || "(root)"}: ${first.message}` : "unknown error"}`,
      });
    }
  }
  return ok;
}

export async function checkProvenance(db: DbClient): Promise<ProvenanceReport> {
  const problems: ProvenanceProblem[] = [];
  const raw = {
    evidence: await readTable(db, "EvidenceRecord"),
    funds: await readTable(db, "FundingSource"),
    cards: await readTable(db, "PaymentInstrument"),
    vendors: await readTable(db, "Vendor"),
    charges: await readTable(db, "VendorCharge"),
    transactions: await readTable(db, "Transaction"),
    nodes: await readTable(db, "Node"),
    edges: await readTable(db, "Edge"),
    incidents: await readTable(db, "Incident"),
  };
  const evidence: EvidenceRecord[] = decode(raw.evidence, EvidenceRecordSchema, "EVIDENCE", problems);
  const funds = decode(raw.funds, FundingSourceSchema, "FUNDING_SOURCE", problems);
  const cards = decode(raw.cards, PaymentInstrumentSchema, "PAYMENT_INSTRUMENT", problems);
  const vendors = decode(raw.vendors, VendorSchema, "VENDOR", problems);
  const charges = decode(raw.charges, VendorChargeSchema, "VENDOR_CHARGE", problems);
  const transactions = decode(raw.transactions, TransactionSchema, "TRANSACTION", problems);
  const nodes = decode(raw.nodes, NodeSchema, "NODE", problems);
  const edges: GraphEdge[] = decode(raw.edges, EdgeSchema, "EDGE", problems);
  const incidents: Incident[] = decode(raw.incidents, IncidentSchema, "INCIDENT", problems);
  // Existence uses every stored evidence id (a schema-invalid record still exists; it is reported separately).
  const evidenceIds = new Set(raw.evidence.map((e) => e.id as string));
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));

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
      if (!evidenceIds.has(r.evidenceId)) {
        problems.push({ code: "EVIDENCE_MISSING", subjectType, subjectId: r.id, message: `cites missing evidence ${r.evidenceId}` });
      }
    }
  }

  for (const e of edges) {
    if (e.reviewStatus !== "CONFIRMED") continue;
    const ev = evidenceById.get(e.evidenceId);
    if (!ev) continue; // missing (EVIDENCE_MISSING) or schema-invalid (SCHEMA_INVALID): already reported
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
      ...a.inputs.map((i) => i.replace(/^evidence:/, "")).filter((id) => !evidenceIds.has(id)),
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
      EVIDENCE: raw.evidence.length,
      FUNDING_SOURCE: raw.funds.length,
      PAYMENT_INSTRUMENT: raw.cards.length,
      VENDOR: raw.vendors.length,
      VENDOR_CHARGE: raw.charges.length,
      TRANSACTION: raw.transactions.length,
      NODE: raw.nodes.length,
      EDGE: raw.edges.length,
      INCIDENT: raw.incidents.length,
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
