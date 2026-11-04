import { EVIDENCE_CATEGORY_DEFINITIONS } from "@/lib/provenance";
import { sourceClassLabel } from "./labels";

/** User-readable definitions: synthetic vs observed vs derived (and more). */
export function EvidenceDefinitions() {
  const defs = Object.values(EVIDENCE_CATEGORY_DEFINITIONS);
  return (
    <section aria-labelledby="definitions-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="definitions-title" className="text-sm font-semibold text-foreground">
          How to read evidence
        </h2>
        <p className="text-sm text-muted">
          Every record carries one evidence class. Human review is tracked
          separately: a synthetic record can be unverified or verified.
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="evidence-definitions">
        {defs.map((d) => (
          <div
            key={d.category}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
          >
            <dt className="text-sm font-semibold text-foreground">{d.label}</dt>
            <dd className="flex flex-col gap-2 text-sm leading-relaxed text-muted">
              <p>{d.definition}</p>
              <p className="text-subtle">
                <span className="font-medium text-muted">How to read: </span>
                {d.howToRead}
              </p>
              <p className="text-xs text-subtle">
                Classes: {d.sourceClasses.map(sourceClassLabel).join(", ")}
              </p>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
