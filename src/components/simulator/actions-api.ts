import {
  ActionResponseDataSchema,
  type ActionResponseData,
  type ProposeActionRequest,
} from "@/lib/actions/schema";

export type ActionOutcome = { ok: true; data: ActionResponseData } | { ok: false; status: number; message: string };

function detailText(details: unknown): string | null {
  if (!details) return null;
  if (Array.isArray(details)) {
    const msgs = details
      .map((d) => (d && typeof d === "object" && "message" in d ? String((d as { message: unknown }).message) : null))
      .filter(Boolean);
    return msgs.length ? msgs.join("; ") : null;
  }
  if (typeof details === "object") {
    const d = details as Record<string, unknown>;
    if (d.reason === "SELF_APPROVAL") return "the approver must be a different person from the proposer";
    if (typeof d.reason === "string") return d.reason;
    if (typeof d.from === "string" && typeof d.to === "string") {
      return `a ${String(d.from).toLowerCase().replace(/_/g, " ")} action cannot become ${String(d.to).toLowerCase().replace(/_/g, " ")}`;
    }
  }
  return null;
}

async function post(url: string, body: unknown, okStatus: number): Promise<ActionOutcome> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server. Check your connection and try again." };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // keep null
  }
  if (res.status === okStatus) {
    const parsed = ActionResponseDataSchema.safeParse((json as { data?: unknown } | null)?.data);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, status: res.status, message: "The server returned a response this page could not read." };
  }
  const err = (json as { error?: { message?: string; details?: unknown } } | null)?.error;
  const base =
    res.status === 400
      ? "Not accepted"
      : res.status === 404
        ? "Not found"
        : res.status === 409
          ? "That step is not allowed from the current state"
          : res.status === 403
            ? "Actions are only available in demo mode"
            : res.status === 503
              ? "The demo clock is misconfigured"
              : "The request failed";
  const detail = detailText(err?.details) ?? err?.message ?? null;
  return { ok: false, status: res.status, message: detail ? `${base}: ${detail}.` : `${base}.` };
}

export const proposeAction = (body: ProposeActionRequest) => post("/api/actions/propose", body, 201);
export const submitAction = (id: string, submittedBy: string) =>
  post(`/api/actions/${encodeURIComponent(id)}/submit`, { submittedBy }, 200);
export const approveAction = (id: string, approver: string, note?: string) =>
  post(`/api/actions/${encodeURIComponent(id)}/approve`, note ? { approver, note } : { approver }, 200);
export const rejectAction = (id: string, reviewer: string, reason: string) =>
  post(`/api/actions/${encodeURIComponent(id)}/reject`, { reviewer, reason }, 200);
