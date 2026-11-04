"use client";

import {
  CircleHelp,
  FileSearch,
  MousePointerClick,
  TriangleAlert,
  X,
} from "lucide-react";

import type {
  GraphEvidenceSummary,
  GraphVendorStatus,
  ImpactedNode,
  ImpactPath,
  VendorMappingReason,
} from "@/lib/graph";
import Link from "next/link";
import type { GraphEdge, GraphNode } from "@/lib/schema";
import { Badge } from "@/components/ui/badge";
import { PROVENANCE_TONE_VARIANT } from "@/components/ui/provenance-tone";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CRITICALITY_LABEL, IMPACT_LABEL, STRENGTH_LABEL } from "./labels";
import { KIND_LABEL, type Selection } from "./model";
import { PathChain } from "./path-chain";

const MAPPING_REASON_LABEL: Readonly<Record<VendorMappingReason, string>> = {
  BILLING_METHOD_UNKNOWN: "Billing method is unknown",
  NO_VENDOR_RECORD: "No vendor record matches this node",
  CHARGE_WITHOUT_FUNDING_SOURCE: "An upcoming charge has no funding source",
  NO_CONFIRMED_PAYMENT_EDGE: "No confirmed card or fund pays this vendor",
};

type Props = {
  selection: Selection | null;
  focusPathId: string | null;
  /** Server mapping status, for VENDOR nodes. */
  vendorStatus: GraphVendorStatus | null;
  /** Evidence summary for the selected node; null = cited evidence is missing. */
  evidence: GraphEvidenceSummary | null;
  nodeById: ReadonlyMap<string, GraphNode>;
  edgeById: ReadonlyMap<string, GraphEdge>;
  onFocusPath: (pathId: string | null) => void;
  onClear: () => void;
};

function ImpactList({
  items,
  testId,
}: {
  items: ImpactedNode[];
  testId: string;
}) {
  return (
    <ul className="flex flex-col gap-1.5" data-testid={testId}>
      {items.map((n) => (
        <li
          key={n.nodeId}
          data-node-id={n.nodeId}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-raised px-3 py-2"
        >
          <span className="min-w-0 break-words text-sm font-medium text-foreground">
            {n.label}
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span>{IMPACT_LABEL[n.potentialImpact]}</span>
            <span aria-hidden="true">·</span>
            <span>
              {n.pathCount} {n.pathCount === 1 ? "path" : "paths"}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function PathButtons({
  paths,
  focusPathId,
  onFocusPath,
  nodeById,
  edgeById,
}: {
  paths: ImpactPath[];
  focusPathId: string | null;
  onFocusPath: (id: string | null) => void;
  nodeById: ReadonlyMap<string, GraphNode>;
  edgeById: ReadonlyMap<string, GraphEdge>;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {paths.map((p) => {
        const active = p.pathId === focusPathId;
        return (
          <li key={p.pathId}>
            <button
              type="button"
              aria-pressed={active}
              data-path-id={p.pathId}
              onClick={() => onFocusPath(active ? null : p.pathId)}
              className={cn(
                "flex w-full cursor-pointer flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors",
                active
                  ? "border-accent/60 bg-accent-soft"
                  : "border-border bg-surface-raised hover:bg-surface-hover",
              )}
            >
              <PathChain
                nodeIds={p.nodeIds}
                edgeIds={p.edgeIds}
                nodeById={nodeById}
                edgeById={edgeById}
              />
              <span className="text-xs text-subtle">
                Weakest link: {STRENGTH_LABEL[p.weakestStrength].toLowerCase()}{" "}
                · {p.length} {p.length === 1 ? "step" : "steps"}
                {active ? " · showing only this path" : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function SelectionPanel({
  selection,
  focusPathId,
  vendorStatus,
  evidence,
  nodeById,
  edgeById,
  onFocusPath,
  onClear,
}: Props) {
  if (!selection) {
    return (
      <div
        className="flex flex-col items-start gap-2 p-5"
        data-testid="selection-empty"
      >
        <MousePointerClick aria-hidden="true" className="size-5 text-subtle" />
        <h2 className="text-sm font-semibold text-foreground">
          Select a node to trace its impact
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          Click a vendor, or Tab to it and press Enter, to highlight every
          confirmed downstream service, workflow and customer outcome, plus the
          funding chain that pays for it.
        </p>
      </div>
    );
  }

  const node = nodeById.get(selection.nodeId)!;
  const { confirmed, possible } = selection.blast;
  const confirmedTargets = [...confirmed.workflows, ...confirmed.outcomes];
  const possibleOnly = [...possible.workflows, ...possible.outcomes].filter(
    (n) => possible.onlyPossibleNodeIds.includes(n.nodeId),
  );

  return (
    <div
      className="flex flex-col gap-5 p-5"
      data-testid="selection-panel"
      data-node-id={node.id}
    >
      {/* Header row: identity + evidence (side by side at xl to keep the panel short). */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between xl:gap-6">
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
              {KIND_LABEL[node.kind]}
            </p>
            <h2 className="break-words text-base font-semibold text-foreground">
              {node.label}
            </h2>
            <p className="text-xs text-muted">
              Owner:{" "}
              {node.owner ?? <span className="text-warning">not recorded</span>}{" "}
              · Criticality: {CRITICALITY_LABEL[node.criticality]}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClear}
            aria-label="Clear selection"
            className="xl:order-last"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div
          className="flex flex-wrap items-center gap-1.5 text-xs text-muted xl:max-w-md xl:justify-end"
          data-testid="node-evidence"
        >
          <span className="font-medium text-subtle">Evidence:</span>
          {evidence ? (
            <>
              {evidence.badge ? (
                <Badge
                  variant={PROVENANCE_TONE_VARIANT[evidence.badge.tone]}
                  title={evidence.badge.description}
                >
                  {evidence.badge.label}
                </Badge>
              ) : null}
              <Badge
                variant={PROVENANCE_TONE_VARIANT[evidence.tone]}
                className="normal-case tracking-normal"
              >
                {evidence.label}
              </Badge>
              <span>
                {evidence.verificationStatus === "USER_VERIFIED"
                  ? "Verified"
                  : evidence.verificationStatus === "REJECTED"
                    ? "Rejected"
                    : "Unverified"}
              </span>
              <Link
                href={`/sources?source=${encodeURIComponent(evidence.id)}`}
                className="ml-auto inline-flex items-center gap-1 rounded text-info hover:underline"
              >
                <FileSearch aria-hidden="true" className="size-3.5" />
                View source
              </Link>
            </>
          ) : (
            <span className="flex items-center gap-1 text-warning">
              <TriangleAlert aria-hidden="true" className="size-3.5" />
              Unknown provenance: cited evidence is missing
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2 xl:gap-6">
        <div className="flex min-w-0 flex-col gap-5">
          {vendorStatus?.needsMapping ? (
            <div
              data-testid="needs-mapping"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground"
            >
              <CircleHelp
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-warning"
              />
              <div className="flex min-w-0 flex-col gap-1">
                <p>
                  Needs mapping: how this vendor is funded is unknown. This is
                  not a risk rating.
                </p>
                <ul className="list-disc pl-4 text-xs text-muted">
                  {vendorStatus.needsMappingReasons.map((r) => (
                    <li key={r}>{MAPPING_REASON_LABEL[r]}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          <section
            aria-labelledby="confirmed-impact-title"
            className="flex flex-col gap-2"
          >
            <h3
              id="confirmed-impact-title"
              className="text-sm font-semibold text-foreground"
            >
              Confirmed downstream impact{" "}
              <Badge
                variant="accent"
                className="ml-1 align-middle"
                data-testid="confirmed-count"
              >
                {confirmedTargets.length}
              </Badge>
            </h3>
            {confirmedTargets.length === 0 ? (
              <p className="text-sm text-muted">
                No confirmed downstream workflows or outcomes.
              </p>
            ) : (
              <ImpactList items={confirmedTargets} testId="confirmed-impacts" />
            )}
          </section>

          {possibleOnly.length > 0 ? (
            <section
              aria-labelledby="possible-impact-title"
              className="flex flex-col gap-2"
            >
              <h3
                id="possible-impact-title"
                className="text-sm font-semibold text-foreground"
              >
                Possible impact via unreviewed links
              </h3>
              <p className="text-xs text-muted">
                Reached only through suggested edges. Not counted until a
                reviewer confirms them.
              </p>
              <ImpactList items={possibleOnly} testId="possible-impacts" />
            </section>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {confirmed.paths.length + possible.paths.length > 0 ? (
            <section
              aria-labelledby="paths-title"
              className="flex flex-col gap-2"
            >
              <h3
                id="paths-title"
                className="text-sm font-semibold text-foreground"
              >
                Exact paths
              </h3>
              <p className="text-xs text-muted">
                Choose a path to show only that causal chain on the graph.
              </p>
              <PathButtons
                paths={[...confirmed.paths, ...possible.paths]}
                focusPathId={focusPathId}
                onFocusPath={onFocusPath}
                nodeById={nodeById}
                edgeById={edgeById}
              />
            </section>
          ) : null}

          {confirmed.truncated || confirmed.depthLimited ? (
            <p
              role="status"
              className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-foreground"
            >
              Results may be incomplete: the path search hit its size or depth
              limit.
            </p>
          ) : null}
        </div>
      </div>

      <p className="border-t border-border pt-3 text-xs leading-relaxed text-subtle">
        Reachable means potentially affected, not predicted to fail. Risk
        scoring is not part of this view yet.
      </p>
    </div>
  );
}
