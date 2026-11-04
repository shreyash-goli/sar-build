"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Bell, BellOff, CheckCheck, Clock, X } from "lucide-react";

import { ALERT_CHANNEL_NOTICE, type AlertListData, type AlertView } from "@/lib/alerts/schema";
import { formatUtc } from "@/components/layout/format-utc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { SEVERITY_LABEL, SEVERITY_VARIANT } from "@/components/dashboard/format";
import { cn } from "@/lib/utils";
import { ackAlert, fetchAlerts, snoozeAlert, snoozeUntil } from "./alerts-api";
import { ALERT_KIND_LABEL, SNOOZE_OPTIONS } from "./labels";

type View = "active" | "all";

function AlertCard({
  alert,
  actor,
  asOf,
  onChanged,
  onNavigate,
}: {
  alert: AlertView;
  actor: string;
  asOf: string;
  onChanged: () => void;
  onNavigate: () => void;
}) {
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [days, setDays] = React.useState<number>(1);
  const sid = `alert-${alert.id}`;

  async function run(label: string, call: () => ReturnType<typeof ackAlert>) {
    if (!actor.trim()) {
      setError("Enter who is acting (demo identity) at the top of the panel.");
      return;
    }
    setPending(true);
    setError(null);
    const r = await call();
    setPending(false);
    if (!r.ok) {
      setError(r.message);
      toast({ title: `${label} failed`, description: r.message, variant: "danger" });
      return;
    }
    toast({
      title: r.data.idempotent ? `${label}: already done` : `${label} recorded`,
      description: `${r.data.alert.title}. ${ALERT_CHANNEL_NOTICE}.`,
      variant: r.data.idempotent ? "info" : "success",
    });
    onChanged();
  }

  const canAct = alert.displayState !== "ACKNOWLEDGED";

  return (
    <li
      data-testid="alert-card"
      data-alert-id={alert.id}
      data-kind={alert.kind}
      data-display-state={alert.displayState}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border p-3.5",
        alert.displayState === "ACTIVE" ? "border-border-strong bg-surface-raised" : "border-dashed border-border bg-transparent",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="neutral" className="normal-case tracking-normal" data-testid="alert-kind">
          {ALERT_KIND_LABEL[alert.kind]}
        </Badge>
        {alert.previousSeverity && alert.previousSeverity !== alert.severity ? (
          <span className="flex items-center gap-1 text-xs text-muted">
            <Badge variant={SEVERITY_VARIANT[alert.previousSeverity]}>{SEVERITY_LABEL[alert.previousSeverity]}</Badge>
            <ArrowRight aria-label="to" className="size-3" />
          </span>
        ) : null}
        <Badge variant={SEVERITY_VARIANT[alert.severity]} data-testid="alert-severity">
          {SEVERITY_LABEL[alert.severity]}
        </Badge>
        <span className="ml-auto font-mono text-[0.6875rem] text-subtle">#{alert.seq}</span>
      </div>
      <p className="break-words text-sm font-medium text-foreground">{alert.title}</p>
      <p className="break-words text-xs leading-relaxed text-muted">{alert.message}</p>
      <dl className="grid gap-x-3 gap-y-0.5 text-xs text-muted sm:grid-cols-2">
        <div>
          <dt className="inline text-subtle">Source </dt>
          <dd className="inline break-all font-mono">{alert.source}</dd>
        </div>
        <div>
          <dt className="inline text-subtle">Owner </dt>
          <dd className={cn("inline", !alert.owner && "text-warning")}>{alert.owner ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt className="inline text-subtle">Raised </dt>
          <dd className="inline font-mono">{formatUtc(alert.createdAt)}</dd>
        </div>
        <div data-testid="alert-status">
          <dt className="sr-only">Status</dt>
          <dd className="inline">
            {alert.displayState === "ACKNOWLEDGED"
              ? `Acknowledged by ${alert.acknowledgedBy ?? "unknown"}${alert.acknowledgedAt ? ` · ${formatUtc(alert.acknowledgedAt)}` : ""}`
              : alert.displayState === "SNOOZED"
                ? `Snoozed until ${alert.snoozedUntil ? formatUtc(alert.snoozedUntil) : "?"} by ${alert.snoozedBy ?? "unknown"}`
                : "Active"}
          </dd>
        </div>
      </dl>
      <p className="text-[0.6875rem] text-subtle" data-testid="alert-notice">
        {alert.notice}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={alert.link} onClick={onNavigate} className="inline-flex items-center gap-1 text-xs font-medium text-info hover:underline" data-testid="alert-link">
          Open incident
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
        {canAct ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run("Acknowledgement", () => ackAlert(alert.id, actor.trim()))}
              className="ml-auto"
            >
              <CheckCheck aria-hidden="true" />
              Acknowledge
            </Button>
            {alert.displayState === "ACTIVE" ? (
              <div className="flex items-center gap-1">
                <label htmlFor={`${sid}-snooze`} className="sr-only">
                  Snooze for
                </label>
                <select
                  id={`${sid}-snooze`}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="h-8 rounded-md border border-border-strong bg-surface-raised px-2 text-xs text-foreground"
                >
                  {SNOOZE_OPTIONS.map((o) => (
                    <option key={o.days} value={o.days}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run("Snooze", () => snoozeAlert(alert.id, actor.trim(), snoozeUntil(asOf, days)))}
                >
                  <BellOff aria-hidden="true" />
                  Snooze
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {error ? (
        <p role="alert" data-testid="alert-error" className="rounded-md border border-danger/40 bg-danger-soft px-2.5 py-1.5 text-xs text-foreground">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * FS-20 alert center: bell with active count + a drawer (native modal <dialog>,
 * so focus is trapped, Escape closes, and focus returns to the bell).
 * In-app only: nothing here is ever sent to Slack, email or anywhere else.
 */
export function AlertCenter({ activeCount }: { activeCount: number }) {
  const router = useRouter();
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [view, setView] = React.useState<View>("active");
  const [data, setData] = React.useState<AlertListData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [actor, setActor] = React.useState("ops-lead");
  const titleId = React.useId();

  const load = React.useCallback(async (v: View) => {
    setLoading(true);
    setError(null);
    const r = await fetchAlerts(v);
    setLoading(false);
    if (r.ok) setData(r.data);
    else setError(r.message);
  }, []);

  const open = () => {
    dialogRef.current?.showModal();
    void load(view);
  };

  const switchView = (v: View) => {
    setView(v);
    void load(v);
  };

  const changed = () => {
    void load(view);
    router.refresh(); // refresh the bell count and any incident timeline
  };

  const counts = data?.counts;

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={open}
        aria-label={`Alerts: ${activeCount} active`}
        data-testid="alert-bell"
        className="relative"
      >
        <Bell aria-hidden="true" />
        {activeCount > 0 ? (
          <span
            aria-hidden="true"
            data-testid="alert-count"
            className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] font-bold leading-4 text-background"
          >
            {activeCount > 99 ? "99+" : activeCount}
          </span>
        ) : null}
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        data-testid="alert-center"
        className="ml-auto mr-0 mt-0 mb-0 h-dvh max-h-dvh w-[min(28rem,100vw)] max-w-none border-l border-border-strong bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/50"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-border p-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold">
                <Bell aria-hidden="true" className="size-4 text-subtle" />
                Alerts
              </h2>
              <p className="text-xs font-medium text-subtle" data-testid="alert-center-notice">
                {ALERT_CHANNEL_NOTICE}. Alerts are raised by the risk engine when a risk materially changes.
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="Close alerts" onClick={() => dialogRef.current?.close()}>
              <X aria-hidden="true" />
            </Button>
          </div>

          <div className="flex flex-col gap-3 border-b border-border p-4">
            <div role="tablist" aria-label="Alert view" className="flex gap-1 rounded-md bg-background/60 p-1">
              {(["active", "all"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  type="button"
                  aria-selected={view === v}
                  onClick={() => switchView(v)}
                  data-testid={`alert-tab-${v}`}
                  className={cn(
                    "flex-1 cursor-pointer rounded px-3 py-1.5 text-sm",
                    view === v ? "bg-surface-raised font-medium text-foreground" : "text-muted hover:text-foreground",
                  )}
                >
                  {v === "active" ? "Active" : "History"}
                </button>
              ))}
            </div>
            {counts ? (
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" data-testid="alert-counts">
                <span>{counts.active} active</span>
                <span>
                  {counts.snoozed} snoozed
                  {data?.snoozeHint ? (
                    <span className="mt-1 flex items-start gap-1 text-warning" data-testid="snooze-hint">
                      <Clock aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                      {data.snoozeHint}
                    </span>
                  ) : null}
                </span>
                <span>{counts.acknowledged} acknowledged</span>
              </p>
            ) : null}
            <div className="flex flex-col gap-1">
              <label htmlFor="alert-actor" className="text-xs text-muted">
                Acting as
              </label>
              <input
                id="alert-actor"
                value={actor}
                onChange={(e) => setActor(e.target.value)}
                className="h-8 w-full rounded-md border border-border-strong bg-surface-raised px-2.5 text-sm text-foreground"
              />
              <p className="text-[0.6875rem] text-subtle" data-testid="alert-identity-note">
                Demo identity, not authenticated.
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4" aria-busy={loading}>
            {error ? (
              <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-foreground">
                {error}
              </p>
            ) : !data ? (
              <p className="text-sm text-muted">Loading alerts…</p>
            ) : data.alerts.length === 0 ? (
              <p className="text-sm text-muted" data-testid="alerts-empty">
                {view === "active" ? "No active alerts." : "No alerts have been raised."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5" data-testid="alert-list">
                {data.alerts.map((a) => (
                  <AlertCard
                    key={a.id}
                    alert={a}
                    actor={actor}
                    asOf={data.asOf}
                    onChanged={changed}
                    onNavigate={() => dialogRef.current?.close()}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
