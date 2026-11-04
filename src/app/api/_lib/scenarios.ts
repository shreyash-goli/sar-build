/**
 * POST /api/scenarios/run and GET /api/scenarios handler bodies (testable without Next).
 * Runs are demo-only (DEMO_MODE) and transactional; they only write a Simulation
 * record and an AuditEvent.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { isDemoModeEnabled } from "@/lib/env";
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { createRepositories } from "@/lib/repositories";
import { IdSchema, ScenarioRunRequestSchema } from "@/lib/schema";
import { WriteForbiddenError } from "@/lib/security/write-gate";
import { SimulationError } from "@/lib/simulations/engine";
import { buildSimulationList } from "@/lib/simulations/load";
import { runSimulation } from "@/lib/simulations/run";
import { getNow } from "@/lib/time";
import { ApiFailure, buildMeta, handle, jsonData } from "./http";
import { readAuthorizedJsonBody } from "./request";

type Env = Readonly<Record<string, string | undefined>>;
export type ScenarioContext = { db: PrismaClient; env: Env };

export function runScenario(request: Request, { db, env }: ScenarioContext): Promise<Response> {
  return handle(async () => {
    const demoGate = () => {
      if (!isDemoModeEnabled(env)) throw new WriteForbiddenError("Simulations are available only in demo mode (DEMO_MODE=true)");
    };
    const body = await readAuthorizedJsonBody(request, ScenarioRunRequestSchema, demoGate, { invalidMessage: "Invalid simulation request" });
    const now = getNow({ env });
    try {
      const data = await db.$transaction((tx) =>
        runSimulation(createRepositories(tx, { writeGate: demoGate, demoResetGate: demoGate }), {
          incidentId: body.incidentId,
          patch: body.patch,
          now,
        }),
      );
      const meta = await buildMeta({ repos: createReadOnlyRepositories(db), env });
      return jsonData(data, meta, 201);
    } catch (e) {
      if (e instanceof SimulationError) {
        throw new ApiFailure(e.code === "TARGET_NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST", e.message, e.details);
      }
      throw e;
    }
  });
}

export function listScenarios(request: Request, { db, env }: ScenarioContext): Promise<Response> {
  return handle(async () => {
    const url = new URL(request.url);
    const keys = [...new Set(url.searchParams.keys())];
    const unknown = keys.filter((k) => k !== "incidentId");
    if (unknown.length > 0) throw new ApiFailure("BAD_REQUEST", `Unknown query parameter(s): ${unknown.join(", ")}`);
    const values = url.searchParams.getAll("incidentId");
    if (values.length > 1) throw new ApiFailure("BAD_REQUEST", '"incidentId" may only be given once');
    let incidentId: string | undefined;
    if (values.length === 1) {
      const r = IdSchema.safeParse(values[0]);
      if (!r.success) throw new ApiFailure("BAD_REQUEST", "Invalid incidentId");
      incidentId = r.data;
    }
    const repos = createReadOnlyRepositories(db);
    if (incidentId) await repos.incidents.getById(incidentId); // 404 for unknown incidents
    const [data, meta] = await Promise.all([buildSimulationList(repos, incidentId), buildMeta({ repos, env })]);
    return jsonData(data, meta);
  });
}
