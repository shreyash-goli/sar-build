"use client";

import * as React from "react";
import { ClipboardCheck, ClipboardCopy, Hand, ListChecks, UserRound } from "lucide-react";

import type { Runbook } from "@/lib/actions/runbooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<Runbook["nextOwner"]["role"], string> = {
  FINANCE: "Finance",
  SERVICE_OWNER: "Service owner",
  VENDOR_OWNER: "Vendor owner",
};

function ownerText(o: Runbook["nextOwner"]): string {
  return `${o.name ?? "Unassigned"} (${ROLE_LABEL[o.role]})`;
}

function useCopy() {
  const { toast } = useToast();
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const copy = async (id: string, text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast({ title: `Copied ${what}`, description: "Paste it into a ticket or message. It is a manual step.", variant: "success" });
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
    } catch {
      toast({
        title: "Could not copy automatically",
        description: "Open “Show text to copy” and select it manually.",
        variant: "warning",
      });
    }
  };
  return { copy, copiedId };
}

/**
 * FS-16 response checklist. Every step is a human task: nothing is shown as
 * done or automatic, and the disclaimer is always visible.
 */
export function RunbookChecklist({ runbook }: { runbook: Runbook }) {
  const { copy, copiedId } = useCopy();
  const titleById = new Map(runbook.steps.map((s, i) => [s.id, `${i + 1}. ${s.title}`]));
  const allText = runbook.steps.map((s, i) => `${i + 1}. ${s.copyText}`).join("\n\n");

  return (
    <section
      aria-labelledby="runbook-title"
      data-testid="runbook"
      data-rule-id={runbook.ruleId}
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="runbook-title" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <ListChecks aria-hidden="true" className="size-4 text-accent" />
            Response checklist
          </h2>
          <p className="break-words text-sm text-foreground" data-testid="runbook-title">
            {runbook.title}
          </p>
          <p className="flex items-center gap-1.5 text-sm text-muted" data-testid="runbook-next-owner">
            <UserRound aria-hidden="true" className="size-4" />
            Next owner:{" "}
            <span className={cn("font-medium", runbook.nextOwner.name ? "text-foreground" : "text-warning")}>
              {ownerText(runbook.nextOwner)}
            </span>
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => copy("__all", allText, "the checklist")}>
          {copiedId === "__all" ? <ClipboardCheck aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
          Copy whole checklist
        </Button>
      </div>

      <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm font-semibold text-foreground" data-testid="runbook-disclaimer">
        {runbook.disclaimer}
      </p>

      <ol className="flex flex-col gap-3" data-testid="runbook-steps">
        {runbook.steps.map((s, i) => (
          <li
            key={s.id}
            data-step-id={s.id}
            data-step-kind={s.kind}
            className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="flex min-w-0 items-start gap-2 text-sm font-semibold text-foreground">
                <span aria-hidden="true" className="font-mono text-subtle">
                  {i + 1}.
                </span>
                <span className="break-words">{s.title}</span>
              </h3>
              <Badge variant="neutral" className="normal-case tracking-normal" title="FailSafe does not perform this step">
                <Hand aria-hidden="true" />
                Manual step
              </Badge>
            </div>
            <p className="break-words text-sm text-muted">{s.detail}</p>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              <span data-testid="step-owner">
                Owner:{" "}
                <span className={s.owner.name ? "text-foreground" : "text-warning"}>{ownerText(s.owner)}</span>
              </span>
              {s.dependsOn.length ? (
                <span data-testid="step-after">
                  After: {s.dependsOn.map((d) => titleById.get(d) ?? d).join("; ")}
                </span>
              ) : (
                <span className="text-subtle">Can start now</span>
              )}
            </p>
            {s.unknowns.length ? (
              <div className="flex flex-col gap-1 rounded-md border border-border px-3 py-2" data-testid="step-unknowns">
                <p className="text-xs font-medium text-subtle">Still unknown</p>
                <ul className="list-disc pl-5 text-xs text-muted">
                  {s.unknowns.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copy(s.id, s.copyText, `step ${i + 1}`)}
                aria-label={`Copy step ${i + 1}: ${s.title}`}
                data-testid="copy-step"
              >
                {copiedId === s.id ? <ClipboardCheck aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
                {copiedId === s.id ? "Copied" : "Copy"}
              </Button>
              <details className="min-w-0 text-xs">
                <summary className="cursor-pointer text-subtle hover:text-muted">Show text to copy</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-background/60 p-2 font-mono text-[0.6875rem] text-muted" data-testid="step-copy-text">
                  {s.copyText}
                </pre>
              </details>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
