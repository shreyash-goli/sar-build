import type { SimulationPatch } from "@/lib/schema/simulation";
import { ScenarioRunDataSchema, type ScenarioRunData } from "@/lib/simulations/schema";

export type RunOutcome = { ok: true; data: ScenarioRunData } | { ok: false; status: number; message: string };

type ErrorEnvelope = {
  error?: { code?: string; message?: string; details?: unknown };
};

function describeDetails(details: unknown): string | null {
  if (!details) return null;
  if (Array.isArray(details)) {
    const parts = details
      .map((d) => (d && typeof d === "object" && "message" in d ? String((d as { message: unknown }).message) : null))
      .filter(Boolean);
    return parts.length ? parts.join("; ") : null;
  }
  if (typeof details === "object" && details && "reason" in details) {
    return String((details as { reason: unknown }).reason);
  }
  return null;
}

/** POST /api/scenarios/run. Maps every documented error to readable text. */
export async function runScenario(incidentId: string, patch: SimulationPatch): Promise<RunOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/scenarios/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ incidentId, patch }),
    });
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server. Check your connection and try again." };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through with null body
  }

  if (res.status === 201) {
    const parsed = ScenarioRunDataSchema.safeParse((body as { data?: unknown } | null)?.data);
    if (parsed.success) return { ok: true, data: parsed.data };
    return { ok: false, status: 201, message: "The server returned a result this page could not read." };
  }

  const err = (body as ErrorEnvelope | null)?.error;
  const detail = describeDetails(err?.details);
  const base =
    res.status === 400
      ? "This change cannot be modeled"
      : res.status === 404
        ? "Something this change refers to no longer exists"
        : res.status === 403
          ? "Simulations are only available in demo mode"
          : res.status === 503
            ? "The demo clock is misconfigured, so nothing can be evaluated"
            : "The simulation failed";
  const message = [base, detail ?? err?.message].filter(Boolean).join(": ");
  return { ok: false, status: res.status, message: `${message}.`.replace(/\.\.$/, ".") };
}
