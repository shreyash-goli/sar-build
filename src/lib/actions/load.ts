/** Server-only read path for action proposals (FS-15). */
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import type { Repositories } from "@/lib/repositories";
import { SIMULATION_ONLY_NOTICE, type ActionListData, type ActionProposalView } from "./schema";
import { simulatedAtFor, toView, viewById } from "./view";

/** Proposals newest first (optionally for one incident). Unreadable ones are listed, not dropped. */
export async function buildActionList(repos: Repositories, incidentId?: string): Promise<ActionListData> {
  const proposals = incidentId ? await repos.actionProposals.listByIncident(incidentId) : await repos.actionProposals.list();
  const auditsByIncident = new Map<string, Awaited<ReturnType<Repositories["auditEvents"]["listBySubject"]>>>();
  const simsByIncident = new Map<string, Map<string, string>>();
  const actions: ActionProposalView[] = [];
  const unreadableActionIds: string[] = [];
  for (const p of proposals) {
    if (!auditsByIncident.has(p.incidentId)) {
      auditsByIncident.set(p.incidentId, await repos.auditEvents.listBySubject(p.incidentId));
      simsByIncident.set(p.incidentId, await simulatedAtFor(repos, p.incidentId));
    }
    const v = toView(p, auditsByIncident.get(p.incidentId)!, simsByIncident.get(p.incidentId));
    if (v) actions.push(v);
    else unreadableActionIds.push(p.id);
  }
  actions.sort((a, b) => new Date(b.proposedAt).getTime() - new Date(a.proposedAt).getTime() || b.id.localeCompare(a.id));
  return { actions, unreadableActionIds, notice: SIMULATION_ONLY_NOTICE };
}

export function loadActions(incidentId?: string): Promise<ActionListData> {
  return buildActionList(createReadOnlyRepositories(), incidentId);
}

export function loadAction(id: string): Promise<ActionProposalView | null> {
  return viewById(createReadOnlyRepositories(), id);
}
