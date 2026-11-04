/**
 * Server-only simulation service (FS-14). Reads a normalized snapshot through
 * the repositories, runs the pure engine, and persists the result as an
 * append-only Simulation record plus an AuditEvent ("simulation.run").
 *
 * It NEVER writes funds, charges, transactions, edges or incidents: the only
 * writes are repos.simulations.create and repos.auditEvents.create.
 *
 * Duplicates: every run is a new record and audit event, even for an identical
 * patch. A simulation is a log of what was explored and when; there is no dedupe.
 */
import { randomUUID } from "node:crypto";
import type { Repositories } from "@/lib/repositories";
import type { SimulationPatch } from "@/lib/schema";
import { simulate, type WorkspaceSnapshot } from "./engine";
import { SIMULATION_LABEL, SimulationResultSchema, type ScenarioRunData } from "./schema";

export const SIMULATION_AUDIT_ACTION = "simulation.run";
export const DEFAULT_SIMULATION_ACTOR = "demo-user";

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");

/** The persisted run number (beforeJson.seq); 0 for records without one. */
export function seqOf(sim: { beforeJson: unknown }): number {
  const seq = (sim.beforeJson as { seq?: unknown } | null)?.seq;
  return typeof seq === "number" && Number.isSafeInteger(seq) && seq > 0 ? seq : 0;
}

export async function loadWorkspaceSnapshot(repos: Repositories): Promise<WorkspaceSnapshot> {
  const [nodes, edges, vendors, fundingSources, charges, transactions, evidence] = await Promise.all([
    repos.nodes.list(),
    repos.edges.list(),
    repos.vendors.list(),
    repos.fundingSources.list(),
    repos.vendorCharges.list(),
    repos.transactions.list(),
    repos.evidence.list(),
  ]);
  return { nodes, edges, vendors, fundingSources, charges, transactions, evidence };
}

export type RunSimulationInput = {
  incidentId: string;
  patch: SimulationPatch;
  now: Date;
  actor?: string;
};

/**
 * Run and persist one simulation. Throws NotFoundError (unknown incident),
 * SimulationError (unknown target / infeasible patch) or WriteForbiddenError.
 */
export async function runSimulation(repos: Repositories, input: RunSimulationInput): Promise<ScenarioRunData> {
  const incident = await repos.incidents.getById(input.incidentId);
  const snapshot = await loadWorkspaceSnapshot(repos);
  const result = SimulationResultSchema.parse(
    simulate({ snapshot, patch: input.patch, focusIncidentKey: incident.scenarioKey ?? incident.id, now: input.now }),
  );
  const actor = input.actor ?? DEFAULT_SIMULATION_ACTOR;
  const createdAt = iso(input.now);
  // Persisted monotonic sequence: max existing + 1 (runs are serialized by the transaction).
  const seq = Math.max(0, ...(await repos.simulations.list()).map(seqOf)) + 1;

  const sim = await repos.simulations.create({
    id: `sim-${randomUUID()}`,
    incidentId: incident.id,
    patchJson: input.patch,
    beforeJson: { label: SIMULATION_LABEL, seq, findings: result.before },
    afterJson: result,
    createdAt,
    createdBy: actor,
    isDemo: true,
  });
  const audit = await repos.auditEvents.create({
    id: `audit-${randomUUID()}`,
    actor,
    action: SIMULATION_AUDIT_ACTION,
    subjectId: incident.id,
    detailsJson: {
      label: SIMULATION_LABEL,
      simulationId: sim.id,
      patch: input.patch,
      focus: {
        incidentKey: result.focus.incidentKey,
        severityBefore: result.focus.before?.severity ?? null,
        severityAfter: result.focus.after?.severity ?? null,
        changedFields: result.focus.changedFields,
      },
    },
    at: createdAt,
  });

  return {
    simulation: { id: sim.id, seq, incidentId: sim.incidentId, createdAt, createdBy: actor, isDemo: true, label: SIMULATION_LABEL, patch: input.patch, result },
    auditEventId: audit.id,
  };
}
