import type { ActionHistoryEntry } from "@/lib/actions/schema";
import { formatUtc } from "@/components/layout/format-utc";
import { HISTORY_ACTION_LABEL } from "./action-labels";

/** Immutable audit trail for one action, rendered in server order (do not re-sort: the demo clock ties). */
export function AuditTimeline({ history }: { history: ActionHistoryEntry[] }) {
  if (history.length === 0) return <p className="text-xs text-subtle">No audit events recorded.</p>;
  return (
    <ol className="flex flex-col gap-2.5 border-l border-border-strong pl-4" data-testid="audit-timeline">
      {history.map((h) => (
        <li key={h.auditEventId} className="relative flex flex-col gap-0.5" data-audit-action={h.action}>
          <span aria-hidden="true" className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-border-strong" />
          <span className="text-sm text-foreground">
            <span className="font-medium">{HISTORY_ACTION_LABEL[h.action]}</span> by{" "}
            <span className="font-mono text-xs">{h.actor}</span>
          </span>
          {h.text ? <span className="break-words text-xs text-muted">“{h.text}”</span> : null}
          <span className="font-mono text-[0.6875rem] text-subtle">
            {formatUtc(h.at)} · audit {h.auditEventId.slice(0, 14)}
          </span>
        </li>
      ))}
    </ol>
  );
}
