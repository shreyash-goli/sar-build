/** Server-only read path for past simulations (FS-14 Response Studio). */
// Note: imports ./run (node:crypto) for seqOf; this module is server-only either way.
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import type { Repositories } from "@/lib/repositories";
import { SimulationPatchSchema } from "@/lib/schema";
import { seqOf } from "./run";
import { SIMULATION_LABEL, SimulationResultSchema, type ScenarioListData, type SimulationRecordView } from "./schema";

/** Simulations newest first (optionally for one incident). Unreadable records are listed, not dropped. */
export async function buildSimulationList(repos: Repositories, incidentId?: string): Promise<ScenarioListData> {
  const records = incidentId ? await repos.simulations.listByIncident(incidentId) : await repos.simulations.list();
  const simulations: SimulationRecordView[] = [];
  const unreadableSimulationIds: string[] = [];
  for (const r of records) {
    const patch = SimulationPatchSchema.safeParse(r.patchJson);
    const result = SimulationResultSchema.safeParse(r.afterJson);
    const seq = seqOf(r);
    if (!r.isDemo || !patch.success || !result.success || seq === 0) {
      unreadableSimulationIds.push(r.id);
      continue;
    }
    simulations.push({
      id: r.id,
      seq,
      incidentId: r.incidentId,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
      isDemo: true,
      label: SIMULATION_LABEL,
      patch: patch.data,
      result: result.data,
    });
  }
  // Newest first: createdAt, then the persisted seq (the demo clock makes createdAt tie).
  simulations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.seq - a.seq);
  return { simulations, unreadableSimulationIds };
}

/** Server-component convenience (read-only). */
export function loadSimulations(incidentId?: string): Promise<ScenarioListData> {
  return buildSimulationList(createReadOnlyRepositories(), incidentId);
}
