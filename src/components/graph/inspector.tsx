"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, FileSearch, TriangleAlert, X } from "lucide-react";

import type { GraphEvidenceSummary } from "@/lib/graph";
import { EdgeReviewDataSchema } from "@/lib/graph/review-schema";
import { REVIEW_STATUS_DISPLAY } from "@/lib/provenance";
import type { EvidenceMethod } from "@/lib/schema/enums";
import type { GraphEdge, GraphNode } from "@/lib/schema";
import { formatUtc } from "@/components/layout/shell-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PROVENANCE_TONE_VARIANT } from "@/components/ui/provenance-tone";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { STRENGTH_LABEL } from "./labels";

const METHOD_LABEL: Readonly<Record<EvidenceMethod, string>> = {
  MANUAL: "Manual (human entered or reviewed)",
  MANIFEST: "Imported manifest (parsed, never executed)",
  MODEL: "Model suggestion (not a fact until reviewed)",
  FIXTURE: "Demo fixture seed",
  API: "Read-only provider API",
  RULE: "Deterministic rule",
};

const REVIEW_VARIANT = { CONFIRMED: "success", SUGGESTED: "accent", REJECTED: "danger" } as const;

const input = "h-9 w-full min-w-0 rounded-md border border-border-strong bg-surface-raised px-3 text-sm text-foreground";

type ReviewOutcome = { ok: true; message: string } | { ok: false; message: string };

async function postReview(edgeId: string, body: { decision: "CONFIRM" | "REJECT"; reviewer: string; justification: string }): Promise<ReviewOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/graph/edges/${encodeURIComponent(edgeId)}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // keep null
  }
  if (res.status === 200) {
    const parsed = EdgeReviewDataSchema.safeParse((json as { data?: unknown } | null)?.data);
    if (!parsed.success) return { ok: false, message: "The server returned a response this page could not read." };
    const d = parsed.data;
    const changed = d.incidents.updated.length + d.incidents.created.length + d.incidents.resolved.length;
    return {
      ok: true,
      message: `${d.decision === "CONFIRM" ? "Confirmed" : "Rejected"}. Risk re-evaluated: ${changed} incident${changed === 1 ? "" : "s"} changed.`,
    };
  }
  const err = (json as { error?: { message?: string; details?: Record<string, unknown> | unknown[] } } | null)?.error;
  const details = err?.details;
  const current =
    details && !Array.isArray(details) && typeof details === "object" && typeof details.currentStatus === "string"
      ? String(details.currentStatus).toLowerCase()
      : null;
  const issues = Array.isArray(details)
    ? details
        .map((d) => (d && typeof d === "object" && "message" in d ? String((d as { message: unknown }).message) : null))
        .filter(Boolean)
        .join("; ")
    : null;
  const message =
    res.status === 409
      ? `This edge was already reviewed${current ? ` (now ${current})` : ""}. Only suggested edges can be reviewed.`
      : res.status === 400
        ? `Not accepted: ${issues || err?.message || "invalid review"}.`
        : res.status === 403
          ? "Reviews are only available in demo mode."
          : res.status === 404
            ? "This edge no longer exists."
            : `The review failed${err?.message ? `: ${err.message}` : ""}.`;
  return { ok: false, message };
}

function ReviewForm({ edge, label }: { edge: GraphEdge; label: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [decision, setDecision] = React.useState<"CONFIRM" | "REJECT">("CONFIRM");
  const [reviewer, setReviewer] = React.useState("growth-lead");
  const [justification, setJustification] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reviewer.trim()) return setError("Enter the reviewer's name.");
    if (justification.trim().length < 10) return setError("Explain your decision in at least 10 characters.");
    setPending(true);
    const outcome = await postReview(edge.id, { decision, reviewer: reviewer.trim(), justification: justification.trim() });
    setPending(false);
    if (!outcome.ok) {
      setError(outcome.message);
      toast({ title: "Review not recorded", description: outcome.message, variant: "danger" });
      return;
    }
    toast({ title: `Edge ${decision === "CONFIRM" ? "confirmed" : "rejected"}`, description: outcome.message, variant: "success" });
    router.refresh(); // re-read the graph: style, evidence and impact update
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-accent/40 p-3" aria-labelledby="review-title" noValidate>
      <h3 id="review-title" className="text-sm font-semibold text-foreground">
        Review this suggested edge
      </h3>
      <p className="text-xs text-muted">
        Suggested edges never count toward confirmed impact. Confirming creates new reviewer evidence (the original is kept);
        rejecting hides the edge from impact.
      </p>
      <fieldset className="flex gap-2">
        <legend className="sr-only">Decision for {label}</legend>
        {(["CONFIRM", "REJECT"] as const).map((d) => (
          <label
            key={d}
            className={cn(
              "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
              decision === d
                ? d === "CONFIRM"
                  ? "border-success/60 bg-success-soft text-foreground"
                  : "border-danger/60 bg-danger-soft text-foreground"
                : "border-border bg-surface-raised text-muted",
            )}
          >
            <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="sr-only" />
            {d === "CONFIRM" ? <CircleCheck aria-hidden="true" className="size-4" /> : <CircleX aria-hidden="true" className="size-4" />}
            {d === "CONFIRM" ? "Confirm" : "Reject"}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor="review-reviewer" className="text-xs text-muted">
          Reviewer
        </label>
        <input id="review-reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} className={input} />
        <p className="text-[0.6875rem] text-subtle" data-testid="reviewer-identity-note">
          Demo reviewer identity, not authenticated.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="review-justification" className="text-xs text-muted">
          Justification (at least 10 characters)
        </label>
        <textarea
          id="review-justification"
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          className="min-h-20 w-full min-w-0 rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-sm text-foreground"
          placeholder="What did you check? e.g. the growth report reads from Product analytics daily."
        />
      </div>
      {error ? (
        <p role="alert" data-testid="review-error" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-foreground">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant={decision === "CONFIRM" ? "primary" : "danger"} disabled={pending} className="self-start">
        {pending ? "Recording…" : decision === "CONFIRM" ? "Confirm edge" : "Reject edge"}
      </Button>
    </form>
  );
}

/** Edge details drawer: why this edge exists, where the evidence came from, and (for SUGGESTED) review. */
export function EdgeInspector({
  edge,
  nodeById,
  evidence,
  onClose,
}: {
  edge: GraphEdge;
  nodeById: ReadonlyMap<string, GraphNode>;
  evidence: GraphEvidenceSummary | null;
  onClose: () => void;
}) {
  const from = nodeById.get(edge.fromNodeId)?.label ?? edge.fromNodeId;
  const to = nodeById.get(edge.toNodeId)?.label ?? edge.toNodeId;
  const label = `${from} ${edge.relation} ${to}`;
  const ref = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [edge.id, onClose]);

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      aria-labelledby="edge-inspector-title"
      data-testid="edge-inspector"
      data-edge-id={edge.id}
      data-review-status={edge.reviewStatus}
      className="absolute inset-x-2 bottom-2 z-20 flex max-h-[calc(100%-1rem)] flex-col gap-4 overflow-y-auto rounded-xl border border-border-strong bg-surface p-4 shadow-2xl outline-none sm:inset-x-auto sm:right-2 sm:top-2 sm:w-[22rem]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">Edge</p>
          <h2 id="edge-inspector-title" className="break-words text-sm font-semibold text-foreground">
            {from} <span className="font-mono text-info">{edge.relation}</span> {to}
          </h2>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close edge inspector">
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={REVIEW_VARIANT[edge.reviewStatus]} data-testid="edge-review-status" className="normal-case tracking-normal">
          {REVIEW_STATUS_DISPLAY[edge.reviewStatus].label}
        </Badge>
        <span className="text-xs text-muted">
          {STRENGTH_LABEL[edge.dependencyStrength]} dependency · {edge.confidenceTier.toLowerCase()} confidence
        </span>
      </div>

      <section aria-labelledby="edge-why-title" className="flex flex-col gap-2">
        <h3 id="edge-why-title" className="text-sm font-semibold text-foreground">
          Why this edge exists
        </h3>
        {evidence ? (
          <>
            <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-2 border-border-strong bg-background/60 px-3 py-2 font-mono text-xs leading-relaxed text-muted" data-testid="edge-evidence-excerpt">
              {evidence.excerpt ?? "No excerpt was captured for this evidence."}
            </blockquote>
            <div className="flex flex-wrap items-center gap-1.5">
              {evidence.badge ? (
                <Badge variant={PROVENANCE_TONE_VARIANT[evidence.badge.tone]} title={evidence.badge.description}>
                  {evidence.badge.label}
                </Badge>
              ) : null}
              <Badge variant={PROVENANCE_TONE_VARIANT[evidence.tone]} className="normal-case tracking-normal">
                {evidence.label}
              </Badge>
              <span className="text-xs text-subtle">
                {evidence.verificationStatus === "USER_VERIFIED"
                  ? "Verified by a reviewer"
                  : evidence.verificationStatus === "REJECTED"
                    ? "Rejected"
                    : "Unverified"}
              </span>
            </div>
            <dl className="grid gap-2 text-xs">
              <div>
                <dt className="text-subtle">Method</dt>
                <dd className="text-foreground" data-testid="edge-evidence-method" data-method={evidence.kind}>
                  {METHOD_LABEL[evidence.kind]}
                </dd>
              </div>
              <div>
                <dt className="text-subtle">Source system</dt>
                <dd className="break-all font-mono text-foreground">{evidence.sourceSystem}</dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-subtle">Captured</dt>
                  <dd className="font-mono text-foreground">{formatUtc(evidence.capturedAt)}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Observed</dt>
                  <dd className="font-mono text-foreground">{evidence.observedAt ? formatUtc(evidence.observedAt) : "Not recorded"}</dd>
                </div>
              </div>
            </dl>
            <Link
              href={`/sources?source=${encodeURIComponent(evidence.id)}`}
              className="inline-flex w-fit items-center gap-1 text-xs font-medium text-info hover:underline"
            >
              <FileSearch aria-hidden="true" className="size-3.5" />
              Open in Sources
            </Link>
          </>
        ) : (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-foreground">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warning" />
            Unknown provenance: evidence <code className="font-mono">{edge.evidenceId}</code> is cited but missing.
          </p>
        )}
      </section>

      {/* Review is offered ONLY for suggested edges. Confirmed/rejected edges are never re-reviewable here. */}
      {edge.reviewStatus === "SUGGESTED" ? <ReviewForm key={edge.id} edge={edge} label={label} /> : null}
    </aside>
  );
}
