/**
 * Read-only Ramp sync (FS-18). Server-only.
 * Phase 1 (network, outside any DB transaction): fetchRampSnapshot reads funds, cards and
 *   transactions. Declines are guaranteed by fetching state=ALL AND state=DECLINED and merging by
 *   id (the reference says "If state is not set, all transactions except declined transactions
 *   will be returned": https://docs.ramp.com/llms-api.txt). A failed resource is recorded, never
 *   replaced with mock data.
 * Phase 2 (inside a transaction): applyRampSnapshot upserts idempotently by Ramp id (unchanged
 *   records are not rewritten; changed ones cite NEW append-only evidence), adds FUND/CARD/VENDOR
 *   nodes with SUGGESTED edges (the business graph is not supplied by Ramp and needs review), runs
 *   the risk engine, and audits the sync ("ramp.synced"). Only allowed in a RAMP_SANDBOX workspace.
 */
import { createHash, randomUUID } from "node:crypto";
import { materializeIncidents, type MaterializeSummary } from "@/lib/incidents";
import type { Repositories } from "@/lib/repositories";
import type { EvidenceRecord, FundingSource, PaymentInstrument, SourceClass, Transaction, Vendor } from "@/lib/schema";
import { RampApiError, type RampReadOnlyClient } from "./client";
import { RAMP_READONLY_LABEL } from "./config";
import {
  RampCard,
  RampFund,
  RampTransaction,
  cardId,
  cardKind,
  fundId,
  mapCardStatus,
  mapInterval,
  mapTransaction,
  txId,
  usdCents,
} from "./normalize";

export const RAMP_SYNC_AUDIT_ACTION = "ramp.synced";

export type ResourceName = "funds" | "cards" | "transactions";
export type ResourceResult = {
  status: "OK" | "PARTIAL" | "FAILED";
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: { id: string; reason: string }[];
  error: string | null;
  truncated: boolean;
};
export type RampSyncResult = {
  label: typeof RAMP_READONLY_LABEL;
  status: "OK" | "PARTIAL" | "FAILED";
  syncedAt: string;
  resources: Record<ResourceName, ResourceResult>;
  incidents: MaterializeSummary | null;
  notice: string;
};

export const RAMP_SYNC_NOTICE = "Read-only: FailSafe never writes to Ramp, moves money, or requests card numbers.";

type Fetched<T> = { items: T[]; invalid: { id: string; reason: string }[]; error: string | null; truncated: boolean };
export type RampSnapshot = {
  funds: Fetched<RampFund>;
  cards: Fetched<RampCard & { _source: "physical" | "virtual" }>;
  transactions: Fetched<RampTransaction>;
};

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const errText = (e: unknown) => (e instanceof RampApiError ? `${e.code}: ${e.message}` : "unexpected error");
const suffix = (nodeId: string) => nodeId.replace(/^node-/, "");

function parseItems<T>(raw: Record<string, unknown>[], schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }) {
  const items: T[] = [];
  const invalid: { id: string; reason: string }[] = [];
  for (const r of raw) {
    const p = schema.safeParse(r);
    if (p.success) items.push(p.data);
    else invalid.push({ id: typeof r.id === "string" ? r.id : "(no id)", reason: "unrecognized item shape" });
  }
  return { items, invalid };
}

export async function fetchRampSnapshot(client: RampReadOnlyClient): Promise<RampSnapshot> {
  const empty = <T>(error: string | null = null): Fetched<T> => ({ items: [], invalid: [], error, truncated: false });
  const snap: RampSnapshot = { funds: empty(), cards: empty(), transactions: empty() };

  try {
    const r = await client.listAll("/developer/v1/funds");
    snap.funds = { ...parseItems(r.items, RampFund), error: null, truncated: r.truncated };
  } catch (e) {
    snap.funds = empty(errText(e));
  }

  const cardErrors: string[] = [];
  const cards: (RampCard & { _source: "physical" | "virtual" })[] = [];
  const cardInvalid: { id: string; reason: string }[] = [];
  let cardsTruncated = false;
  for (const [path, source] of [["/developer/v1/cards/physical", "physical"], ["/developer/v1/cards/virtual", "virtual"]] as const) {
    try {
      const r = await client.listAll(path);
      const p = parseItems(r.items, RampCard);
      cards.push(...p.items.map((c) => ({ ...c, _source: source })));
      cardInvalid.push(...p.invalid);
      cardsTruncated ||= r.truncated;
    } catch (e) {
      cardErrors.push(`${source}: ${errText(e)}`);
    }
  }
  snap.cards = { items: cards, invalid: cardInvalid, error: cardErrors.length ? cardErrors.join("; ") : null, truncated: cardsTruncated };

  try {
    const all = await client.listAll("/developer/v1/transactions", { state: "ALL" });
    const declined = await client.listAll("/developer/v1/transactions", { state: "DECLINED" });
    const byId = new Map<string, Record<string, unknown>>();
    for (const t of [...all.items, ...declined.items]) if (typeof t.id === "string") byId.set(t.id, t);
    snap.transactions = { ...parseItems([...byId.values()], RampTransaction), error: null, truncated: all.truncated || declined.truncated };
  } catch (e) {
    snap.transactions = empty(errText(e));
  }
  return snap;
}

const blank = (fetched: Fetched<unknown>): ResourceResult => ({
  status: fetched.error ? (fetched.items.length > 0 ? "PARTIAL" : "FAILED") : fetched.truncated || fetched.invalid.length ? "PARTIAL" : "OK",
  fetched: fetched.items.length,
  created: 0,
  updated: 0,
  unchanged: 0,
  skipped: [...fetched.invalid],
  error: fetched.error,
  truncated: fetched.truncated,
});

export type ApplyOptions = { now: Date; classification: Extract<SourceClass, "RAMP_SANDBOX" | "EXTERNAL_OBSERVED">; actor: string };

export async function applyRampSnapshot(repos: Repositories, snap: RampSnapshot, opts: ApplyOptions): Promise<RampSyncResult> {
  const at = iso(opts.now);
  const sourceSystem = opts.classification === "RAMP_SANDBOX" ? "ramp-sandbox" : "ramp-api";
  const res: Record<ResourceName, ResourceResult> = { funds: blank(snap.funds), cards: blank(snap.cards), transactions: blank(snap.transactions) };

  async function evidenceFor(recordId: string, resource: string, rampId: string, raw: unknown, excerpt: string, observedAt: string | null) {
    const h = hash(raw);
    const id = `ev-${recordId}-${h.slice(0, 10)}`;
    if (!(await repos.evidence.findById(id))) {
      const ev: EvidenceRecord = {
        id,
        kind: "API",
        sourceSystem,
        sourceId: `${resource}:${rampId}#${h.slice(0, 10)}`,
        capturedAt: at,
        observedAt,
        excerpt: `Read-only Ramp ${opts.classification === "RAMP_SANDBOX" ? "sandbox " : ""}read. ${excerpt}`,
        path: `/developer/v1/${resource}`,
        contentHash: h,
        classification: opts.classification,
        verificationStatus: "UNVERIFIED",
      };
      await repos.evidence.create(ev);
    }
    return id;
  }

  /** Create, update (new evidence) or leave unchanged; returns the outcome. */
  async function upsert<T extends { id: string; evidenceId: string }>(
    repo: { findById(id: string): Promise<T | null>; create(v: unknown): Promise<T>; update(id: string, p: Partial<Omit<T, "id">>): Promise<T> },
    next: T,
    r: ResourceResult,
  ) {
    const existing = await repo.findById(next.id);
    if (!existing) {
      await repo.create(next);
      r.created += 1;
    } else if (existing.evidenceId === next.evidenceId) {
      r.unchanged += 1;
    } else {
      const { id: _id, ...patch } = next;
      void _id;
      await repo.update(next.id, patch as Partial<Omit<T, "id">>);
      r.updated += 1;
    }
  }

  async function ensureNode(id: string, kind: "FUND" | "CARD" | "VENDOR", label: string, evidenceId: string) {
    const existing = await repos.nodes.findById(id);
    if (!existing) await repos.nodes.create({ id, kind, label, criticality: "UNKNOWN", owner: null, evidenceId });
    else if (existing.label !== label || existing.evidenceId !== evidenceId) await repos.nodes.update(id, { label, evidenceId });
  }

  async function ensureSuggestedEdge(from: string, to: string, relation: "BACKS" | "PAYS", evidenceId: string) {
    const id = `edge-${suffix(from)}--${suffix(to)}`;
    if (await repos.edges.findById(id)) return; // keep any reviewer decision
    await repos.edges.create({ id, fromNodeId: from, toNodeId: to, relation, dependencyStrength: "OPTIONAL", confidenceTier: "MEDIUM", reviewStatus: "SUGGESTED", evidenceId });
  }

  // Funds
  for (const f of snap.funds.items) {
    const id = fundId(f.id);
    const name = f.display_name?.trim() || `Ramp fund ${f.id}`;
    const limit = f.spending_restrictions?.limit;
    const limitCents = usdCents(limit?.amount, limit?.currency_code);
    const evidenceId = await evidenceFor(id, "funds", f.id, f, `Fund "${name}" (${f.state ?? "state unknown"}). Available allocation is not derived from the reported balance; it stays unknown.`, null);
    const next: FundingSource = {
      id,
      provider: "RAMP",
      externalFundId: f.id,
      name,
      interval: mapInterval(f.spending_restrictions?.interval),
      limitCents,
      availableCents: null,
      observedAt: at,
      evidenceId,
    };
    await upsert(repos.fundingSources, next, res.funds);
    await ensureNode(`node-${id}`, "FUND", name, evidenceId);
  }

  // Cards (metadata only)
  for (const c of snap.cards.items) {
    const id = cardId(c.id);
    const { _source, ...raw } = c;
    const fund = c.fund_id ? await repos.fundingSources.findById(fundId(c.fund_id)) : null;
    const label = c.display_name?.trim() || `Ramp ${_source} card`;
    const evidenceId = await evidenceFor(id, `cards/${_source}`, c.id, raw, `${_source === "physical" ? "Physical" : "Virtual"} card "${label}" metadata only (no PAN/CVV requested).`, null);
    const next: PaymentInstrument = { id, kind: cardKind(_source), externalCardId: c.id, fundingSourceId: fund ? fund.id : null, status: mapCardStatus(c.state), evidenceId };
    await upsert(repos.paymentInstruments, next, res.cards);
    await ensureNode(`node-${id}`, "CARD", label, evidenceId);
    if (fund) await ensureSuggestedEdge(`node-${fund.id}`, `node-${id}`, "BACKS", evidenceId);
  }

  // Transactions (+ vendors from merchants)
  for (const t of snap.transactions.items) {
    const m = mapTransaction(t);
    if (!m.ok) {
      res.transactions.skipped.push({ id: t.id, reason: m.reason });
      continue;
    }
    const vendorId = `vendor-${m.vendorKey}`;
    const vEvidence = await evidenceFor(vendorId, "transactions", t.id, { merchant_id: t.merchant_id ?? null, merchant_name: t.merchant_name ?? null }, `Merchant "${m.vendorName}" seen on a card transaction. Billing method not inferred.`, null);
    const existingVendor = await repos.vendors.findById(vendorId);
    if (!existingVendor) {
      const v: Vendor = { id: vendorId, name: m.vendorName, normalizedKey: m.vendorKey, billingMethod: "UNKNOWN", evidenceId: vEvidence };
      await repos.vendors.create(v);
    }
    await ensureNode(`node-${vendorId}`, "VENDOR", m.vendorName, existingVendor?.evidenceId ?? vEvidence);

    const fundRef = t.fund_id ?? t.limit_id ?? null;
    const fund = fundRef ? await repos.fundingSources.findById(fundId(fundRef)) : null;
    const id = txId(t.id);
    const evidenceId = await evidenceFor(id, "transactions", t.id, t, `Transaction ${t.id} (${t.state}) at "${m.vendorName}".${m.reason ? ` Decline reason as reported by Ramp: ${m.reason}.` : ""}`, m.occurredAt);
    const next: Transaction = {
      id,
      providerEventId: t.id,
      vendorId,
      fundingSourceId: fund ? fund.id : null,
      occurredAt: m.occurredAt,
      amountCents: m.amountCents,
      state: m.state,
      reason: m.reason,
      evidenceId,
    };
    await upsert(repos.transactions, next, res.transactions);
    if (t.card_id && (await repos.paymentInstruments.findById(cardId(t.card_id)))) {
      await ensureSuggestedEdge(`node-${cardId(t.card_id)}`, `node-${vendorId}`, "PAYS", evidenceId);
    }
  }
  for (const r of Object.values(res)) if (r.status === "OK" && r.skipped.length > 0) r.status = "PARTIAL";

  const statuses = Object.values(res).map((r) => r.status);
  const status = statuses.every((s) => s === "OK") ? "OK" : statuses.every((s) => s === "FAILED") ? "FAILED" : "PARTIAL";
  const incidents = status === "FAILED" ? null : await materializeIncidents(repos, opts.now);

  const [workspace] = await repos.workspaces.list();
  const result: RampSyncResult = { label: RAMP_READONLY_LABEL, status, syncedAt: at, resources: res, incidents, notice: RAMP_SYNC_NOTICE };
  await repos.auditEvents.create({
    id: `audit-${randomUUID()}`,
    actor: opts.actor,
    action: RAMP_SYNC_AUDIT_ACTION,
    subjectId: workspace!.id,
    detailsJson: JSON.parse(
      JSON.stringify({
        status,
        resources: Object.fromEntries(Object.entries(res).map(([k, r]) => [k, { status: r.status, fetched: r.fetched, created: r.created, updated: r.updated, unchanged: r.unchanged, skipped: r.skipped.length, error: r.error }])),
      }),
    ) as never,
    at,
  });
  return result;
}
