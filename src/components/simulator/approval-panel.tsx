"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCheck, FilePlus2, Send } from "lucide-react";

import { SIMULATION_ONLY_NOTICE, type ActionProposalView, type ActionResponseData } from "@/lib/actions/schema";
import type { SimulationRecordView } from "@/lib/simulations/schema";
import { formatUtc } from "@/components/layout/shell-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { approveAction, proposeAction, rejectAction, submitAction, type ActionOutcome } from "./actions-api";
import { ACTION_STATE_LABEL, ACTION_STATE_VARIANT } from "./action-labels";
import { AuditTimeline } from "./audit-timeline";
import { describePatch } from "./result-view";

const input =
  "h-9 w-full min-w-0 rounded-md border border-border-strong bg-surface-raised px-3 text-sm text-foreground";
const textarea =
  "min-h-20 w-full min-w-0 rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm text-foreground";

function Notice() {
  return (
    <p className="text-sm font-bold text-warning" data-testid="action-notice">
      {SIMULATION_ONLY_NOTICE}
    </p>
  );
}

function useActionRunner(onUpdated: (a: ActionProposalView) => void) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (label: string, call: () => Promise<ActionOutcome>): Promise<ActionResponseData | null> => {
    setPending(true);
    setError(null);
    const outcome = await call();
    setPending(false);
    if (!outcome.ok) {
      setError(outcome.message);
      toast({ title: `${label} failed`, description: outcome.message, variant: "danger" });
      return null;
    }
    onUpdated(outcome.data.action);
    toast(
      outcome.data.idempotent
        ? { title: `${label}: already done`, description: "Nothing changed; no new audit event was recorded.", variant: "info" }
        : {
            title: `${label} recorded`,
            description: `${ACTION_STATE_LABEL[outcome.data.action.state]}. ${SIMULATION_ONLY_NOTICE}.`,
            variant: "success",
          },
    );
    router.refresh();
    return outcome.data;
  };
  return { run, pending, error, setError };
}

function ProposeForm({
  incidentId,
  simulation,
  onCreated,
}: {
  incidentId: string;
  simulation: SimulationRecordView;
  onCreated: (a: ActionProposalView) => void;
}) {
  const [rationale, setRationale] = React.useState("");
  const [proposedBy, setProposedBy] = React.useState("finance-ops");
  const { run, pending, error, setError } = useActionRunner(onCreated);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rationale.trim().length < 10) {
      setError("Explain the rationale in at least 10 characters.");
      return;
    }
    if (!proposedBy.trim()) {
      setError("Enter who is proposing this.");
      return;
    }
    const done = await run("Proposal", () =>
      proposeAction({
        incidentId,
        kind: simulation.patch.kind,
        payload: simulation.patch,
        rationale: rationale.trim(),
        proposedBy: proposedBy.trim(),
        simulationId: simulation.id,
      }),
    );
    if (done) setRationale("");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-labelledby="propose-title" noValidate>
      <h3 id="propose-title" className="text-sm font-semibold text-foreground">
        Propose this change
      </h3>
      <p className="text-xs text-muted" data-testid="propose-patch">
        {describePatch(simulation.patch)} (from simulation run #{simulation.seq})
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="action-rationale" className="text-xs font-medium text-muted">
          Rationale
        </label>
        <textarea
          id="action-rationale"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          className={textarea}
          placeholder="Why this response, and what the reviewer should check"
          aria-invalid={error ? true : undefined}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="action-proposer" className="text-xs font-medium text-muted">
          Proposed by
        </label>
        <input id="action-proposer" value={proposedBy} onChange={(e) => setProposedBy(e.target.value)} className={input} />
      </div>
      {error ? (
        <p role="alert" data-testid="propose-error" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-foreground">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        <FilePlus2 aria-hidden="true" />
        {pending ? "Proposing…" : "Create draft proposal"}
      </Button>
    </form>
  );
}

function ActionCard({ action, onUpdated }: { action: ActionProposalView; onUpdated: (a: ActionProposalView) => void }) {
  const [submittedBy, setSubmittedBy] = React.useState(action.proposedBy);
  const [approver, setApprover] = React.useState("ops-lead");
  const [note, setNote] = React.useState("");
  const [reviewer, setReviewer] = React.useState("ops-lead");
  const [reason, setReason] = React.useState("");
  const { run, pending, error, setError } = useActionRunner(onUpdated);
  const can = (s: ActionProposalView["state"]) => action.allowedTransitions.includes(s);
  const idp = `act-${action.id}`;

  return (
    <li
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4"
      data-testid="action-card"
      data-action-id={action.id}
      data-state={action.state}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant={ACTION_STATE_VARIANT[action.state]} data-testid="action-state">
          {ACTION_STATE_LABEL[action.state]}
        </Badge>
        <span className="font-mono text-[0.6875rem] text-subtle">{action.id.slice(0, 16)}</span>
      </div>
      <Notice />
      <p className="text-sm text-foreground">{describePatch(action.payload)}</p>
      <dl className="grid gap-1 text-xs text-muted sm:grid-cols-2">
        <div>
          <dt className="inline text-subtle">Proposed by </dt>
          <dd className="inline font-mono">{action.proposedBy}</dd>
        </div>
        <div>
          <dt className="inline text-subtle">Decided by </dt>
          <dd className="inline font-mono">{action.decidedBy ?? "nobody yet"}</dd>
        </div>
        <div>
          <dt className="inline text-subtle">Simulated </dt>
          <dd className="inline">{action.simulatedAt ? formatUtc(action.simulatedAt) : "not linked to a simulation"}</dd>
        </div>
        <div>
          <dt className="inline text-subtle">Executed externally </dt>
          <dd className="inline" data-testid="executed-externally">
            Never: simulation only
          </dd>
        </div>
      </dl>

      {can("PENDING_APPROVAL") ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-40 flex-1 flex-col gap-1">
            <label htmlFor={`${idp}-submitter`} className="text-xs text-muted">
              Submitted by
            </label>
            <input id={`${idp}-submitter`} value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)} className={input} />
          </div>
          <Button
            variant="primary"
            size="md"
            disabled={pending}
            onClick={() => run("Submission", () => submitAction(action.id, submittedBy.trim()))}
          >
            <Send aria-hidden="true" />
            Submit for approval
          </Button>
        </div>
      ) : null}

      {can("APPROVED_FOR_DEMO") ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idp}-approver`} className="text-xs text-muted">
                Approver (must differ from proposer)
              </label>
              <input id={`${idp}-approver`} value={approver} onChange={(e) => setApprover(e.target.value)} className={input} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idp}-note`} className="text-xs text-muted">
                Approval note (optional)
              </label>
              <input id={`${idp}-note`} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
            </div>
          </div>
          <Button
            variant="primary"
            disabled={pending}
            className="self-start"
            onClick={() => {
              if (!approver.trim()) {
                setError("Enter the approver's name.");
                return;
              }
              void run("Approval", () => approveAction(action.id, approver.trim(), note.trim() || undefined));
            }}
          >
            <CheckCheck aria-hidden="true" />
            Approve for demo
          </Button>
        </div>
      ) : null}

      {can("REJECTED") ? (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted">Reject this proposal</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idp}-reviewer`} className="text-xs text-muted">
                Reviewer
              </label>
              <input id={`${idp}-reviewer`} value={reviewer} onChange={(e) => setReviewer(e.target.value)} className={input} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idp}-reason`} className="text-xs text-muted">
                Reason (at least 10 characters)
              </label>
              <input id={`${idp}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
            </div>
          </div>
          <Button
            variant="danger"
            size="sm"
            disabled={pending}
            className="mt-2"
            onClick={() => {
              if (reason.trim().length < 10) {
                setError("Give a rejection reason of at least 10 characters.");
                return;
              }
              void run("Rejection", () => rejectAction(action.id, reviewer.trim(), reason.trim()));
            }}
          >
            <Ban aria-hidden="true" />
            Reject
          </Button>
        </details>
      ) : null}

      {error ? (
        <p role="alert" data-testid="action-error" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-foreground">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-subtle">Audit trail</h4>
        <AuditTimeline history={action.history} />
      </div>
    </li>
  );
}

/**
 * FS-15 approval panel: propose the selected simulation, then submit,
 * approve (by someone else) or reject. Approval changes only the simulated
 * plan; nothing is executed and no Ramp funds change.
 */
export function ApprovalPanel({
  incidentId,
  simulation,
  actions,
  unreadableCount,
}: {
  incidentId: string;
  simulation: SimulationRecordView | null;
  actions: ActionProposalView[];
  unreadableCount: number;
}) {
  // Local overrides show results immediately; router.refresh() then re-reads the server list.
  const [overrides, setOverrides] = React.useState<Record<string, ActionProposalView>>({});
  const update = React.useCallback((a: ActionProposalView) => setOverrides((o) => ({ ...o, [a.id]: a })), []);
  const serverIds = new Set(actions.map((a) => a.id));
  const merged = [
    ...Object.values(overrides).filter((a) => !serverIds.has(a.id)),
    ...actions.map((a) => overrides[a.id] ?? a),
  ];

  return (
    <section aria-labelledby="approval-title" className="flex flex-col gap-4" data-testid="approval-panel">
      <div className="flex flex-col gap-1">
        <h2 id="approval-title" className="text-base font-semibold text-foreground">
          Approval
        </h2>
        <Notice />
        <p className="text-xs text-muted">
          Draft → pending approval → approved for demo, or rejected. Every step is recorded in an immutable audit trail.
          Approval only changes the simulated plan.
        </p>
        <p className="text-xs font-medium text-subtle" data-testid="demo-identities-note">
          Demo identities, not authenticated: names are typed in and recorded as given.
        </p>
      </div>

      {simulation ? (
        <div className="rounded-lg border border-border p-4">
          <ProposeForm key={simulation.id} incidentId={incidentId} simulation={simulation} onCreated={update} />
        </div>
      ) : (
        <p className="text-sm text-muted">Run a simulation first; a proposal is always based on a modeled change.</p>
      )}

      {unreadableCount > 0 ? (
        <p role="status" className="text-xs text-warning">
          {unreadableCount} stored proposal{unreadableCount === 1 ? "" : "s"} could not be read and{" "}
          {unreadableCount === 1 ? "is" : "are"} not listed.
        </p>
      ) : null}

      {merged.length ? (
        <ul className="flex flex-col gap-3" data-testid="action-list">
          {merged.map((a) => (
            <ActionCard key={a.id} action={a} onUpdated={update} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No proposals for this incident yet.</p>
      )}
    </section>
  );
}
