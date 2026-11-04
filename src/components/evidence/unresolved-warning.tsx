import { TriangleAlert } from "lucide-react";

import type { SourcesListData } from "@/lib/provenance";
import { SUBJECT_TYPE_LABEL } from "./labels";

export function UnresolvedWarning({
  unresolved,
}: {
  unresolved: SourcesListData["unresolved"];
}) {
  if (unresolved.length === 0) return null;
  const n = unresolved.length;
  return (
    <section
      role="alert"
      aria-labelledby="unresolved-title"
      data-testid="unresolved-warning"
      className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft p-4"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="unresolved-title" className="text-sm font-semibold text-foreground">
            {n} {n === 1 ? "record cites" : "records cite"} missing evidence
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            These subjects reference an evidence ID that does not exist in the
            ledger. Their provenance is treated as unknown, not assumed.
          </p>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5 pl-7 text-sm">
        {unresolved.map((u) => (
          <li
            key={`${u.subjectType}:${u.subjectId}:${u.evidenceId}`}
            className="min-w-0 break-words text-muted"
          >
            {SUBJECT_TYPE_LABEL[u.subjectType]}{" "}
            <code className="break-all font-mono text-foreground">{u.subjectId}</code>{" "}
            cites{" "}
            <code className="break-all font-mono text-warning">{u.evidenceId}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}
