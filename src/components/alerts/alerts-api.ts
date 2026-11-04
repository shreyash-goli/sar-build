import {
  AlertListDataSchema,
  AlertResponseDataSchema,
  type AlertListData,
  type AlertResponseData,
} from "@/lib/alerts/schema";

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorText(status: number, json: unknown): string {
  const err = (json as { error?: { message?: string; details?: unknown } } | null)?.error;
  const details = Array.isArray(err?.details)
    ? (err!.details as { message?: string }[]).map((d) => d.message).filter(Boolean).join("; ")
    : null;
  const base =
    status === 409
      ? "Not allowed in the alert's current state"
      : status === 400
        ? "Not accepted"
        : status === 404
          ? "This alert no longer exists"
          : status === 403
            ? "Alert actions are only available in demo mode"
            : "The request failed";
  const extra = details || err?.message;
  return extra ? `${base}: ${extra}.` : `${base}.`;
}

export async function fetchAlerts(view: "active" | "all"): Promise<Result<AlertListData>> {
  let res: Response;
  try {
    res = await fetch(`/api/alerts?view=${view}`, { cache: "no-store" });
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server." };
  }
  const json = await readJson(res);
  if (!res.ok) return { ok: false, status: res.status, message: errorText(res.status, json) };
  const parsed = AlertListDataSchema.safeParse((json as { data?: unknown } | null)?.data);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, status: res.status, message: "The server returned alerts this page could not read." };
}

async function post(url: string, body: unknown): Promise<Result<AlertResponseData>> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server." };
  }
  const json = await readJson(res);
  if (!res.ok) return { ok: false, status: res.status, message: errorText(res.status, json) };
  const parsed = AlertResponseDataSchema.safeParse((json as { data?: unknown } | null)?.data);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, status: res.status, message: "The server returned a response this page could not read." };
}

export const ackAlert = (id: string, actor: string) => post(`/api/alerts/${encodeURIComponent(id)}/ack`, { actor });
export const snoozeAlert = (id: string, actor: string, until: string) =>
  post(`/api/alerts/${encodeURIComponent(id)}/snooze`, { actor, until });

/** Snooze end from the server's (demo) clock: never the browser clock. */
export function snoozeUntil(asOf: string, days: number): string {
  return new Date(Date.parse(asOf) + days * 86_400_000).toISOString().replace(".000Z", "Z");
}
