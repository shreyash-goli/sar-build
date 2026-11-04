# Architecture

FailSafe is one Next.js App Router application (TypeScript). It contains the UI, the route-handler
API and a deterministic domain core, all on top of SQLite through Prisma 7 (libSQL adapter). The
domain core makes no network calls. The only outbound integrations are optional and off by
default: an LLM for dependency suggestions (FS-19) and a read-only Ramp sandbox sync (FS-18).

## Data flow

```
 fixtures / manifest import / (optional) Ramp sandbox read
        │  src/fixtures, src/lib/demo, src/lib/providers
        ▼
 Zod validation at every boundary            src/lib/schema
        ▼
 Repositories + write gate ──► SQLite        src/lib/repositories, prisma/schema.prisma
        │   every record cites an EvidenceRecord (append-only ledger, src/lib/provenance)
        ▼
 Graph (confirmed vs suggested) · Forecast (charge projection) · Risk classifier
   src/lib/graph                  src/lib/forecast              src/lib/risk
        ▼
 Incidents (idempotent, DERIVED rule evidence) ──► Alerts on material transitions
   src/lib/incidents                                src/lib/alerts
        ▼
 Simulations (cloned snapshot) · Action proposals (approval-gated, audited, never executed)
   src/lib/simulations             src/lib/actions
        ▼
 API route handlers: { data, meta } | { error }   src/app/api/**/route.ts → src/app/api/_lib
        ▼
 UI (server components + client islands)          src/app/(app), src/components
```

A demo reset (`pnpm demo:reset` or `POST /api/demo/reset`) clears the database and reseeds the
fictional Northstar fixture. It then rebuilds incidents and alerts by running the real engine,
not by inserting precomputed rows. Every evaluation writes evidence that names a versioned rule
(`DERIVED` for engine rules; AI suggestions are `MODEL_SUGGESTED`):

| Rule | What it evaluates |
| --- | --- |
| `projected-shortfall-v1` | Projected shortfall |
| `observed-decline-v1` | Observed transaction declines |
| `risk-severity-v1` | Risk severity |
| `alert-transition-v1` | Alert transitions |
| `simulation-v1` | Simulations |
| `recurring-charge-suggestion-v1` | Suggested recurring charges |
| `llm-dependency-suggestion-v1` | AI dependency suggestions |

## Key decisions

| Decision | Why | Where enforced |
| --- | --- | --- |
| Money is integer cents | No floating-point drift in shortfall math | `src/lib/schema/money.ts`, Zod `z.int()` |
| Unknown is `null`, never `0` | A missing balance or limit must not look like "$0 available" | Schemas; normalizers (Ramp `availableCents: null`) |
| Append-only evidence and audit | Every edge, risk and action stays traceable to its source | Repositories refuse updates/deletes; `pnpm check:provenance` |
| Confirmed-only blast radius | Suggested edges appear as "possible impacts" and never raise severity | `src/lib/graph/impact.ts`; edge policy: confirming needs `USER_VERIFIED` evidence (demo fixtures excepted) |
| Deterministic, versioned rules | Same inputs give the same result; reproducible demo clock (`DEMO_NOW`) | `src/lib/risk`, `src/lib/time.ts` |
| Simulation on a cloned snapshot | Counterfactuals rerun the same risk engine and never change stored funds | `src/lib/simulations/engine.ts` |
| Human approval, no execution | Proposals go draft → submitted → approved/rejected by a different identity; "Executed externally: Never" | `src/lib/actions/service.ts` |
| Model output is a suggestion | Only taxonomy-grounded, schema-valid suggestions; stored as `SUGGESTED` | `src/lib/providers/llm-suggestions.ts` |
| Read-only Ramp, sandbox only | GET plus token only; no vault scopes; PAN/CVV-like payloads refused | `src/lib/providers/ramp` |

## Module boundaries

| Module | Responsibility | Depends on |
| --- | --- | --- |
| `src/lib/schema` | Zod contracts for domain, evidence, API envelopes. Client-safe. | Zod |
| `src/lib/repositories` | Only DB access path. Validates on read and write; write gate; edge policy. | schema, Prisma client |
| `src/lib/provenance` | Evidence ledger, display mapping, integrity checker | repositories |
| `src/lib/graph`, `forecast`, `risk` | Pure computation over loaded snapshots (bounded traversal: depth, path and step caps); `graph/load.ts` and `graph/review.ts` are the DB-facing entry points | schema (graph load/review: repositories) |
| `src/lib/incidents`, `alerts` | Materialize findings into incidents and alerts, idempotently, in one transaction | risk, repositories |
| `src/lib/simulations`, `actions` | Counterfactuals; proposal lifecycle; runbooks | risk, repositories |
| `src/lib/providers` | Manifest parsing (never executed), taxonomy, optional LLM and Ramp clients | schema, repositories |
| `src/lib/security` | Write gate (`DEMO_MODE` / `ADMIN_TOKEN`), log redaction | env |
| `src/app/api/_lib` | Handler bodies: gate → origin check → size-limited body → transaction → envelope | everything above |
| `src/app/(app)`, `src/components` | UI. Client components never import server-only modules (checked by `tests/unit/boundaries.test.ts`) | schema, API |

Writes happen only in route handlers and CLI scripts (`prisma/seed.ts`, `scripts/*.ts`), always
through the repositories; multi-record writes (seed, reset, materialization, simulations, actions,
reviews, imports, sync) run inside a transaction. GET handlers use read-only repositories. Errors
are mapped to typed codes. Unexpected errors return a generic 500, and the server log line is
redacted.

## Verification

`pnpm verify` runs lint, typecheck, Vitest (unit, integration, API smoke and boundary suites) and
`check:provenance`. `pnpm test:e2e` runs `check:provenance` on a freshly reset database before it
builds and serves the app for Playwright.
