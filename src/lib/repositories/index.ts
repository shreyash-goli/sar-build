/**
 * Typed repositories over Prisma. All writes pass the injected write gate and
 * Zod validation; all reads are re-validated.
 *
 * Usage in a route handler:
 *   const repos = repositoriesForRequest(request); // gate = DEMO_MODE or admin token
 */
import type { PrismaClient } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";
import {
  ActionProposalSchema,
  AuditEventSchema,
  EdgeSchema,
  EvidenceRecordSchema,
  FundingSourceSchema,
  IncidentSchema,
  NodeSchema,
  PaymentInstrumentSchema,
  SimulationSchema,
  TransactionSchema,
  VendorChargeSchema,
  VendorSchema,
  WorkspaceSchema,
  canTransitionActionProposal,
  type ActionProposal,
  type AuditEvent,
  type EvidenceRecord,
  type FundingSource,
  type GraphEdge,
  type GraphNode,
  type Incident,
  type PaymentInstrument,
  type Simulation,
  type Transaction,
  type Vendor,
  type VendorCharge,
  type Workspace,
} from "@/lib/schema";
import { isDemoModeEnabled } from "@/lib/env";
import { WriteForbiddenError, assertRequestWritesAllowed } from "@/lib/security/write-gate";
import { appendOnlyRepository, decoder, mutableRepository, type WriteGate } from "./base";
import { checkEdgeEvidence } from "./edge-policy";
import { ConflictError, NotFoundError, ProvenanceViolationError, RepositoryError, parseOrThrow } from "./errors";
import {
  centsFromDb,
  centsToDb,
  fromDate,
  fromDateOrNull,
  jsonFromDb,
  jsonToDb,
  toDate,
  toDateOrNull,
} from "./mappers";

const byId = { orderBy: { id: "asc" as const } };

/** States an ActionProposal may be created in; approval/rejection only via transitions. */
export const ACTION_PROPOSAL_INITIAL_STATES: readonly ActionProposal["state"][] = ["DRAFT", "PENDING_APPROVAL"];

/** A PrismaClient or an interactive-transaction client (`db.$transaction(async (tx) => ...)`). */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export type RepositoryOptions = {
  /** Gate for every write (DEMO_MODE or admin token). */
  writeGate: WriteGate;
  /**
   * Extra gate for destructive demo-reset operations. Defaults to requiring
   * DEMO_MODE (an admin token alone never authorizes wiping data).
   */
  demoResetGate?: () => void;
};

const defaultDemoResetGate = () => {
  if (!isDemoModeEnabled()) throw new WriteForbiddenError("Demo reset requires DEMO_MODE=true");
};

export function createRepositories(db: DbClient, options: RepositoryOptions) {
  const { writeGate, demoResetGate = defaultDemoResetGate } = options;

  // ---- Append-only (no update/delete helpers): EvidenceRecord ----
  const evidenceCodec = {
    entity: "EvidenceRecord",
    schema: EvidenceRecordSchema,
    toData: (e: EvidenceRecord): Prisma.EvidenceRecordUncheckedCreateInput => ({
      ...e,
      capturedAt: toDate(e.capturedAt),
      observedAt: toDateOrNull(e.observedAt),
    }),
    fromRow: (r: Prisma.EvidenceRecordGetPayload<object>) => ({
      ...r,
      capturedAt: fromDate(r.capturedAt),
      observedAt: fromDateOrNull(r.observedAt),
    }),
  };
  const evidenceBase = appendOnlyRepository(
    evidenceCodec,
    {
      create: (data) => db.evidenceRecord.create({ data }),
      findUnique: (id) => db.evidenceRecord.findUnique({ where: { id } }),
      findMany: () => db.evidenceRecord.findMany(byId),
    },
    writeGate,
  );
  const decodeEvidence = decoder(evidenceCodec);
  const evidence = Object.freeze({
    ...evidenceBase,
    async listByIds(ids: readonly string[]): Promise<EvidenceRecord[]> {
      const rows = await db.evidenceRecord.findMany({ where: { id: { in: [...ids] } }, ...byId });
      return rows.map(decodeEvidence);
    },
  });

  // ---- Append-only (no update/delete helpers): AuditEvent ----
  const auditCodec = {
    entity: "AuditEvent",
    schema: AuditEventSchema,
    toData: (a: AuditEvent): Prisma.AuditEventUncheckedCreateInput => ({
      ...a,
      detailsJson: jsonToDb(a.detailsJson),
      at: toDate(a.at),
    }),
    fromRow: (r: Prisma.AuditEventGetPayload<object>) => ({
      ...r,
      detailsJson: jsonFromDb(r.detailsJson),
      at: fromDate(r.at),
    }),
  };
  const auditBase = appendOnlyRepository(
    auditCodec,
    {
      create: (data) => db.auditEvent.create({ data }),
      findUnique: (id) => db.auditEvent.findUnique({ where: { id } }),
      findMany: () => db.auditEvent.findMany({ orderBy: [{ at: "asc" }, { id: "asc" }] }),
    },
    writeGate,
  );
  const decodeAudit = decoder(auditCodec);
  const auditEvents = Object.freeze({
    ...auditBase,
    async listBySubject(subjectId: string): Promise<AuditEvent[]> {
      const rows = await db.auditEvent.findMany({ where: { subjectId }, orderBy: [{ at: "asc" }, { id: "asc" }] });
      return rows.map(decodeAudit);
    },
  });

  // ---- Simulation: no update/delete helpers (a saved counterfactual is a record, not a draft).
  // Rows are removed only by the incident cascade in incidents.deleteForDemoReset. ----
  const simulationCodec = {
    entity: "Simulation",
    schema: SimulationSchema,
    toData: (s: Simulation): Prisma.SimulationUncheckedCreateInput => ({
      ...s,
      patchJson: jsonToDb(s.patchJson),
      beforeJson: jsonToDb(s.beforeJson),
      afterJson: jsonToDb(s.afterJson),
      createdAt: toDate(s.createdAt),
    }),
    fromRow: (r: Prisma.SimulationGetPayload<object>) => ({
      ...r,
      patchJson: jsonFromDb(r.patchJson),
      beforeJson: jsonFromDb(r.beforeJson),
      afterJson: jsonFromDb(r.afterJson),
      createdAt: fromDate(r.createdAt),
    }),
  };
  const simulationBase = appendOnlyRepository(
    simulationCodec,
    {
      create: (data) => db.simulation.create({ data }),
      findUnique: (id) => db.simulation.findUnique({ where: { id } }),
      findMany: () => db.simulation.findMany(byId),
    },
    writeGate,
  );
  const decodeSimulation = decoder(simulationCodec);
  const simulations = Object.freeze({
    ...simulationBase,
    async listByIncident(incidentId: string): Promise<Simulation[]> {
      const rows = await db.simulation.findMany({ where: { incidentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      return rows.map(decodeSimulation);
    },
  });

  // ---- Mutable ----
  const workspaces = mutableRepository(
    {
      entity: "Workspace",
      schema: WorkspaceSchema,
      toData: (w: Workspace): Prisma.WorkspaceUncheckedCreateInput => w,
      fromRow: (r: Prisma.WorkspaceGetPayload<object>) => r,
    },
    {
      create: (data) => db.workspace.create({ data }),
      findUnique: (id) => db.workspace.findUnique({ where: { id } }),
      findMany: () => db.workspace.findMany(byId),
      update: (id, data) => db.workspace.update({ where: { id }, data }),
      delete: (id) => db.workspace.delete({ where: { id } }),
    },
    writeGate,
  );

  const fundingSources = mutableRepository(
    {
      entity: "FundingSource",
      schema: FundingSourceSchema,
      toData: (f: FundingSource): Prisma.FundingSourceUncheckedCreateInput => ({
        ...f,
        limitCents: centsToDb(f.limitCents),
        availableCents: centsToDb(f.availableCents),
        observedAt: toDate(f.observedAt),
      }),
      fromRow: (r: Prisma.FundingSourceGetPayload<object>) => ({
        ...r,
        limitCents: centsFromDb(r.limitCents),
        availableCents: centsFromDb(r.availableCents),
        observedAt: fromDate(r.observedAt),
      }),
    },
    {
      create: (data) => db.fundingSource.create({ data }),
      findUnique: (id) => db.fundingSource.findUnique({ where: { id } }),
      findMany: () => db.fundingSource.findMany(byId),
      update: (id, data) => db.fundingSource.update({ where: { id }, data }),
      delete: (id) => db.fundingSource.delete({ where: { id } }),
    },
    writeGate,
  );

  const paymentInstruments = mutableRepository(
    {
      entity: "PaymentInstrument",
      schema: PaymentInstrumentSchema,
      toData: (p: PaymentInstrument): Prisma.PaymentInstrumentUncheckedCreateInput => p,
      fromRow: (r: Prisma.PaymentInstrumentGetPayload<object>) => r,
    },
    {
      create: (data) => db.paymentInstrument.create({ data }),
      findUnique: (id) => db.paymentInstrument.findUnique({ where: { id } }),
      findMany: () => db.paymentInstrument.findMany(byId),
      update: (id, data) => db.paymentInstrument.update({ where: { id }, data }),
      delete: (id) => db.paymentInstrument.delete({ where: { id } }),
    },
    writeGate,
  );

  const vendorCodec = {
    entity: "Vendor",
    schema: VendorSchema,
    toData: (v: Vendor): Prisma.VendorUncheckedCreateInput => v,
    fromRow: (r: Prisma.VendorGetPayload<object>) => r,
  };
  const vendorBase = mutableRepository(
    vendorCodec,
    {
      create: (data) => db.vendor.create({ data }),
      findUnique: (id) => db.vendor.findUnique({ where: { id } }),
      findMany: () => db.vendor.findMany(byId),
      update: (id, data) => db.vendor.update({ where: { id }, data }),
      delete: (id) => db.vendor.delete({ where: { id } }),
    },
    writeGate,
  );
  const decodeVendor = decoder(vendorCodec);
  const vendors = Object.freeze({
    ...vendorBase,
    async findByNormalizedKey(normalizedKey: string): Promise<Vendor | null> {
      const row = await db.vendor.findUnique({ where: { normalizedKey } });
      return row === null ? null : decodeVendor(row);
    },
  });

  const vendorChargeCodec = {
    entity: "VendorCharge",
    schema: VendorChargeSchema,
    toData: (c: VendorCharge): Prisma.VendorChargeUncheckedCreateInput => ({
      ...c,
      expectedAt: toDate(c.expectedAt),
      expectedCents: centsToDb(c.expectedCents),
    }),
    fromRow: (r: Prisma.VendorChargeGetPayload<object>) => ({
      ...r,
      expectedAt: fromDate(r.expectedAt),
      expectedCents: centsFromDb(r.expectedCents),
    }),
  };
  const vendorChargeBase = mutableRepository(
    vendorChargeCodec,
    {
      create: (data) => db.vendorCharge.create({ data }),
      findUnique: (id) => db.vendorCharge.findUnique({ where: { id } }),
      findMany: () => db.vendorCharge.findMany({ orderBy: [{ expectedAt: "asc" }, { id: "asc" }] }),
      update: (id, data) => db.vendorCharge.update({ where: { id }, data }),
      delete: (id) => db.vendorCharge.delete({ where: { id } }),
    },
    writeGate,
  );
  const decodeCharge = decoder(vendorChargeCodec);
  const vendorCharges = Object.freeze({
    ...vendorChargeBase,
    async listByVendor(vendorId: string): Promise<VendorCharge[]> {
      const rows = await db.vendorCharge.findMany({ where: { vendorId }, orderBy: [{ expectedAt: "asc" }, { id: "asc" }] });
      return rows.map(decodeCharge);
    },
  });

  const transactionCodec = {
    entity: "Transaction",
    schema: TransactionSchema,
    toData: (t: Transaction): Prisma.TransactionUncheckedCreateInput => ({
      ...t,
      occurredAt: toDate(t.occurredAt),
      amountCents: centsToDb(t.amountCents),
    }),
    fromRow: (r: Prisma.TransactionGetPayload<object>) => ({
      ...r,
      occurredAt: fromDate(r.occurredAt),
      amountCents: centsFromDb(r.amountCents),
    }),
  };
  const transactionBase = mutableRepository(
    transactionCodec,
    {
      create: (data) => db.transaction.create({ data }),
      findUnique: (id) => db.transaction.findUnique({ where: { id } }),
      findMany: () => db.transaction.findMany({ orderBy: [{ occurredAt: "asc" }, { id: "asc" }] }),
      update: (id, data) => db.transaction.update({ where: { id }, data }),
      delete: (id) => db.transaction.delete({ where: { id } }),
    },
    writeGate,
  );
  const decodeTransaction = decoder(transactionCodec);
  const transactions = Object.freeze({
    ...transactionBase,
    async findByProviderEventId(providerEventId: string): Promise<Transaction | null> {
      const row = await db.transaction.findUnique({ where: { providerEventId } });
      return row === null ? null : decodeTransaction(row);
    },
    /**
     * Idempotent ingest keyed on providerEventId: replaying an identical event
     * returns the stored row; a different payload under the same key is a conflict.
     */
    async ingest(input: unknown): Promise<{ transaction: Transaction; created: boolean }> {
      writeGate();
      const tx = parseOrThrow(TransactionSchema, input, "Transaction");
      if (tx.providerEventId === null) {
        throw new RepositoryError("BAD_REQUEST", "idempotent ingest requires providerEventId");
      }
      const existing = await transactions.findByProviderEventId(tx.providerEventId);
      if (existing) {
        // Both sides are schema-parsed (same key order). Ignore the row id (a replay
        // may carry a fresh UUID) and normalize the timestamp format.
        const incoming = { ...tx, id: existing.id, occurredAt: fromDate(toDate(tx.occurredAt)) };
        if (JSON.stringify(existing) !== JSON.stringify(incoming)) {
          throw new ConflictError(`providerEventId ${tx.providerEventId} was already ingested with different data`);
        }
        return { transaction: existing, created: false };
      }
      return { transaction: await transactionBase.create(tx), created: true };
    },
  });

  const nodes = mutableRepository(
    {
      entity: "Node",
      schema: NodeSchema,
      toData: (n: GraphNode): Prisma.NodeUncheckedCreateInput => n,
      fromRow: (r: Prisma.NodeGetPayload<object>) => r,
    },
    {
      create: (data) => db.node.create({ data }),
      findUnique: (id) => db.node.findUnique({ where: { id } }),
      findMany: () => db.node.findMany(byId),
      update: (id, data) => db.node.update({ where: { id }, data }),
      delete: (id) => db.node.delete({ where: { id } }),
    },
    writeGate,
  );

  const edgeCodec = {
    entity: "Edge",
    schema: EdgeSchema,
    toData: (e: GraphEdge): Prisma.EdgeUncheckedCreateInput => e,
    fromRow: (r: Prisma.EdgeGetPayload<object>) => r,
  };
  const edgeBase = mutableRepository(
    edgeCodec,
    {
      create: (data) => db.edge.create({ data }),
      findUnique: (id) => db.edge.findUnique({ where: { id } }),
      findMany: () => db.edge.findMany(byId),
      update: (id, data) => db.edge.update({ where: { id }, data }),
      delete: (id) => db.edge.delete({ where: { id } }),
    },
    writeGate,
    {
      // Provenance gate on every create and update.
      async beforeWrite(edge, existing) {
        const ev = await evidence.findById(edge.evidenceId);
        if (ev === null) throw new NotFoundError("EvidenceRecord", edge.evidenceId);
        const check = checkEdgeEvidence(edge.reviewStatus, ev, existing?.reviewStatus ?? null);
        if (!check.ok) {
          throw new ProvenanceViolationError(check.reason, {
            edgeId: edge.id,
            evidenceId: ev.id,
            previousReviewStatus: existing?.reviewStatus ?? null,
            classification: ev.classification,
            verificationStatus: ev.verificationStatus,
          });
        }
      },
    },
  );
  const decodeEdge = decoder(edgeCodec);
  const edges = Object.freeze({
    ...edgeBase,
    async listByReviewStatus(reviewStatus: GraphEdge["reviewStatus"]): Promise<GraphEdge[]> {
      const rows = await db.edge.findMany({ where: { reviewStatus }, ...byId });
      return rows.map(decodeEdge);
    },
  });

  const incidentCodec = {
    entity: "Incident",
    schema: IncidentSchema,
    toData: (i: Incident): Prisma.IncidentUncheckedCreateInput => ({
      ...i,
      firstSeenAt: toDate(i.firstSeenAt),
      updatedAt: toDate(i.updatedAt),
      snapshotJson: jsonToDb(i.snapshotJson),
    }),
    fromRow: (r: Prisma.IncidentGetPayload<object>) => ({
      ...r,
      firstSeenAt: fromDate(r.firstSeenAt),
      updatedAt: fromDate(r.updatedAt),
      snapshotJson: jsonFromDb(r.snapshotJson),
    }),
  };
  const incidentBase = mutableRepository(
    incidentCodec,
    {
      create: (data) => db.incident.create({ data }),
      findUnique: (id) => db.incident.findUnique({ where: { id } }),
      findMany: () => db.incident.findMany(byId),
      update: (id, data) => db.incident.update({ where: { id }, data }),
      delete: (id) => db.incident.delete({ where: { id } }),
    },
    writeGate,
  );
  const decodeIncident = decoder(incidentCodec);
  // No generic delete: removing an incident cascades to its simulations and
  // proposals, so it is only exposed as an explicit demo-reset operation.
  const { delete: deleteIncident, ...incidentRest } = incidentBase;
  const incidents = Object.freeze({
    ...incidentRest,
    /**
     * Demo reset only: deletes the incident AND (via onDelete: Cascade) its
     * simulations and action proposals, so they can be regenerated by real logic.
     * Passes the write gate.
     */
    async deleteForDemoReset(id: string): Promise<void> {
      await deleteIncident(id);
    },
    async findByScenarioKey(scenarioKey: string): Promise<Incident | null> {
      const row = await db.incident.findUnique({ where: { scenarioKey } });
      return row === null ? null : decodeIncident(row);
    },
  });

  const actionProposalCodec = {
    entity: "ActionProposal",
    schema: ActionProposalSchema,
    toData: (a: ActionProposal): Prisma.ActionProposalUncheckedCreateInput => ({
      ...a,
      payloadJson: jsonToDb(a.payloadJson),
      createdAt: toDate(a.createdAt),
    }),
    fromRow: (r: Prisma.ActionProposalGetPayload<object>) => ({
      ...r,
      payloadJson: jsonFromDb(r.payloadJson),
      createdAt: fromDate(r.createdAt),
    }),
  };
  const actionProposalBase = mutableRepository(
    actionProposalCodec,
    {
      create: (data) => db.actionProposal.create({ data }),
      findUnique: (id) => db.actionProposal.findUnique({ where: { id } }),
      findMany: () => db.actionProposal.findMany(byId),
      update: (id, data) => db.actionProposal.update({ where: { id }, data }),
      delete: (id) => db.actionProposal.delete({ where: { id } }),
    },
    writeGate,
    {
      beforeWrite(next, existing) {
        if (existing === null && !ACTION_PROPOSAL_INITIAL_STATES.includes(next.state)) {
          throw new ConflictError(
            `ActionProposal must be created as ${ACTION_PROPOSAL_INITIAL_STATES.join(" or ")}, not ${next.state}`,
          );
        }
      },
      beforeUpdate(existing, next) {
        if (existing.state !== next.state && !canTransitionActionProposal(existing.state, next.state)) {
          throw new ConflictError(`ActionProposal cannot transition ${existing.state} -> ${next.state}`);
        }
        if (existing.state === "APPROVED_FOR_DEMO" || existing.state === "REJECTED") {
          throw new ConflictError(`ActionProposal in terminal state ${existing.state} cannot be modified`);
        }
      },
    },
  );
  const decodeProposal = decoder(actionProposalCodec);
  // No delete helper: proposals are removed only by the incident cascade (demo reset).
  const { delete: _noProposalDelete, ...actionProposalRest } = actionProposalBase;
  void _noProposalDelete;
  const actionProposals = Object.freeze({
    ...actionProposalRest,
    async listByIncident(incidentId: string): Promise<ActionProposal[]> {
      const rows = await db.actionProposal.findMany({ where: { incidentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      return rows.map(decodeProposal);
    },
  });

  /**
   * Named demo-reset path: the ONLY way evidence, audit events and fixture rows
   * are removed. Requires the write gate AND the demo-reset gate. Incidents are
   * removed via incidents.deleteForDemoReset (cascading to simulations and
   * proposals). Run inside a transaction together with the reseed.
   */
  const demoReset = Object.freeze({
    async clearAllData(): Promise<DemoResetClearSummary> {
      writeGate();
      demoResetGate();
      const simulationsCount = await db.simulation.count();
      const actionProposalsCount = await db.actionProposal.count();
      const incidentRows = await db.incident.findMany({ select: { id: true }, ...byId });
      for (const { id } of incidentRows) await incidents.deleteForDemoReset(id);
      return {
        auditEvents: (await db.auditEvent.deleteMany()).count,
        incidents: incidentRows.length,
        simulations: simulationsCount,
        actionProposals: actionProposalsCount,
        edges: (await db.edge.deleteMany()).count,
        nodes: (await db.node.deleteMany()).count,
        transactions: (await db.transaction.deleteMany()).count,
        vendorCharges: (await db.vendorCharge.deleteMany()).count,
        paymentInstruments: (await db.paymentInstrument.deleteMany()).count,
        vendors: (await db.vendor.deleteMany()).count,
        fundingSources: (await db.fundingSource.deleteMany()).count,
        workspaces: (await db.workspace.deleteMany()).count,
        evidence: (await db.evidenceRecord.deleteMany()).count,
      };
    },
  });

  return Object.freeze({
    demoReset,
    workspaces,
    evidence,
    fundingSources,
    paymentInstruments,
    vendors,
    vendorCharges,
    transactions,
    nodes,
    edges,
    incidents,
    simulations,
    actionProposals,
    auditEvents,
  });
}

export type Repositories = ReturnType<typeof createRepositories>;

export type DemoResetClearSummary = {
  auditEvents: number;
  incidents: number;
  simulations: number;
  actionProposals: number;
  edges: number;
  nodes: number;
  transactions: number;
  vendorCharges: number;
  paymentInstruments: number;
  vendors: number;
  fundingSources: number;
  workspaces: number;
  evidence: number;
};

/** Repositories for a route handler: writes require DEMO_MODE=true or a valid admin token header. */
export async function repositoriesForRequest(request: Request): Promise<Repositories> {
  const { getDb } = await import("@/lib/db");
  return createRepositories(getDb(), { writeGate: () => assertRequestWritesAllowed(request) });
}

export { checkEdgeEvidence, evidenceRequiresReview } from "./edge-policy";
export * from "./errors";
export type { AppendOnlyRepository, MutableRepository, WriteGate } from "./base";
