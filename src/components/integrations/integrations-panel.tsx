"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bot, Plug, RefreshCw, ShieldCheck } from "lucide-react";

import { AiStatusSchema, type AiStatus } from "@/lib/providers/llm/status-schema";
import { RAMP_LABEL, RampStatusSchema, RampSyncResultSchema, type RampStatus } from "@/lib/providers/ramp/schema";
import { formatUtc } from "@/components/layout/shell-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

type Loaded<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: T };

async function getStatus<T>(url: string, parse: (d: unknown) => { success: true; data: T } | { success: false }): Promise<Loaded<T>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as { data?: unknown; error?: { message?: string } } | null;
    if (!res.ok) return { state: "error", message: json?.error?.message ?? `Status unavailable (HTTP ${res.status}).` };
    const parsed = parse(json?.data);
    return parsed.success ? { state: "ok", data: parsed.data } : { state: "error", message: "The status response could not be read." };
  } catch {
    return { state: "error", message: "Could not reach the server." };
  }
}

/** Shows variable NAMES only; values are never sent to the browser. */
function Missing({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="text-xs text-muted" data-testid="missing-vars">
      Missing configuration:{" "}
      {names.map((n, i) => (
        <span key={n}>
          {i > 0 ? ", " : null}
          <code className="font-mono text-foreground">{n}</code>
        </span>
      ))}
    </p>
  );
}

function RampRow({ status, onSynced }: { status: RampStatus; onSynced: () => void }) {
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);

  async function sync() {
    setPending(true);
    let res: Response | null = null;
    try {
      res = await fetch("/api/integrations/ramp/sync", { method: "POST" });
    } catch {
      // handled below
    }
    setPending(false);
    const json = res ? ((await res.json().catch(() => null)) as { data?: unknown; error?: { message?: string } } | null) : null;
    const parsed = res?.ok ? RampSyncResultSchema.safeParse(json?.data) : null;
    if (!parsed?.success) {
      toast({
        title: "Ramp sync failed",
        description: json?.error?.message ?? "Nothing was imported. Existing data is unchanged.",
        variant: "danger",
      });
      return;
    }
    const r = parsed.data;
    toast({
      title: r.status === "OK" ? "Ramp sandbox synced (read-only)" : `Ramp sync ${r.status.toLowerCase()}`,
      description: `${r.notice} Funds ${r.resources.funds.fetched}, cards ${r.resources.cards.fetched}, transactions ${r.resources.transactions.fetched}.`,
      variant: r.status === "OK" ? "success" : "warning",
    });
    onSynced();
  }

  return (
    <div className="flex flex-col gap-2" data-testid="ramp-status" data-status={status.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Plug aria-hidden="true" className="size-4 text-subtle" />
        {status.status === "CONFIGURED" ? (
          <Badge variant="info" data-testid="ramp-label">
            <ShieldCheck aria-hidden="true" />
            {RAMP_LABEL}
          </Badge>
        ) : (
          <span className="text-sm font-medium text-foreground" data-testid="ramp-not-connected">
            Ramp sandbox: Not connected
          </span>
        )}
      </div>
      {status.status === "NOT_CONFIGURED" ? (
        <>
          {status.reason ? <p className="text-sm text-muted">{status.reason}</p> : null}
          <Missing names={status.missing} />
        </>
      ) : (
        <dl className="grid gap-1 text-xs text-muted sm:grid-cols-2">
          <div>
            <dt className="inline text-subtle">Host </dt>
            <dd className="inline font-mono">{status.host ?? "unknown"}</dd>
          </div>
          <div data-testid="ramp-last-sync">
            <dt className="inline text-subtle">Last sync </dt>
            <dd className="inline">
              {status.lastSync ? `${formatUtc(status.lastSync.at)} (${status.lastSync.status.toLowerCase()})` : "Never synced"}
            </dd>
          </div>
        </dl>
      )}
      {status.status === "CONFIGURED" && !status.syncAllowed && status.syncBlockedReason ? (
        <p className="text-xs text-muted">Sync unavailable: {status.syncBlockedReason}</p>
      ) : null}
      {status.syncAllowed ? (
        <Button variant="secondary" size="sm" className="self-start" disabled={pending} onClick={sync}>
          <RefreshCw aria-hidden="true" />
          {pending ? "Syncing…" : "Sync from Ramp sandbox (read-only)"}
        </Button>
      ) : null}
      <p className="text-[0.6875rem] text-subtle">{status.notice}</p>
    </div>
  );
}

function AiRow({ status }: { status: AiStatus }) {
  return (
    <div className="flex flex-col gap-2" data-testid="ai-status" data-status={status.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Bot aria-hidden="true" className="size-4 text-subtle" />
        {status.status === "AI_OFF" ? (
          <>
            <Badge variant="neutral" data-testid="ai-off-badge">
              AI OFF
            </Badge>
            <span className="text-sm text-foreground" data-testid="ai-off-text">
              AI OFF: no LLM key configured. Showing rules-based suggestions.
            </span>
          </>
        ) : (
          <>
            <Badge variant="accent">AI suggestions on</Badge>
            <span className="text-sm text-muted">
              {status.model ?? "model unknown"}
              {status.host ? ` · ${status.host}` : ""}
            </span>
          </>
        )}
      </div>
      {status.status === "AI_OFF" ? <Missing names={status.missing} /> : null}
      <p className="text-[0.6875rem] text-subtle">{status.notice}</p>
    </div>
  );
}

/** FS-18/FS-19 integrations status: honest connection state, never a mock connection, never secret values. */
export function IntegrationsPanel() {
  const router = useRouter();
  const [ramp, setRamp] = React.useState<Loaded<RampStatus>>({ state: "loading" });
  const [ai, setAi] = React.useState<Loaded<AiStatus>>({ state: "loading" });

  const load = React.useCallback(async () => {
    const [r, a] = await Promise.all([
      getStatus("/api/integrations/ramp/status", (d) => RampStatusSchema.safeParse(d)),
      getStatus("/api/integrations/ai/status", (d) => AiStatusSchema.safeParse(d)),
    ]);
    setRamp(r);
    setAi(a);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getStatus("/api/integrations/ramp/status", (d) => RampStatusSchema.safeParse(d)),
      getStatus("/api/integrations/ai/status", (d) => AiStatusSchema.safeParse(d)),
    ]).then(([r, a]) => {
      if (cancelled) return;
      setRamp(r);
      setAi(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const row = <T,>(s: Loaded<T>, render: (d: T) => React.ReactNode, label: string) =>
    s.state === "loading" ? (
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">Loading {label} status…</span>
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
    ) : s.state === "error" ? (
      <p role="alert" className="text-sm text-warning">
        {label} status unavailable: {s.message}
      </p>
    ) : (
      render(s.data)
    );

  return (
    <section
      aria-labelledby="integrations-title"
      data-testid="integrations-panel"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5"
    >
      <h2 id="integrations-title" className="text-base font-semibold text-foreground">
        Integrations
      </h2>
      <div className="grid gap-5 md:grid-cols-2">
        {row(ramp, (d) => <RampRow status={d} onSynced={() => { void load(); router.refresh(); }} />, "Ramp")}
        {row(ai, (d) => <AiRow status={d} />, "AI")}
      </div>
    </section>
  );
}
