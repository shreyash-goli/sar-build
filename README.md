# FailSafe

> Prototype: "PagerDuty for financial dependencies." **Not an official Ramp product.**
> All bundled data is fictional (`DEMO_FIXTURE`, the Northstar Labs workspace). No live funds,
> cards or Ramp data are ever read or changed. Every simulated action is labeled `SIMULATION ONLY`.

FailSafe detects when a payment issue could put a critical business workflow at risk, explains
the operational blast radius through a source-backed dependency graph, and lets a human approve a
*simulated* mitigation before a potential interruption.

The authoritative spec is [`docs/BUILD_BLUEPRINT.md`](docs/BUILD_BLUEPRINT.md); the build journal
with verification evidence is [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Requirements

- Node.js 22+
- pnpm 12 (`corepack enable`)
- No API keys, accounts or network services.

## Setup (fresh clone, no keys required)

```bash
pnpm install              # also generates the Prisma client
cp .env.example .env      # DEMO_MODE=true, SQLite file:./dev.db, fixed demo clock
pnpm demo:setup           # = pnpm db:deploy && pnpm db:seed  (migrate + seed Northstar Labs)
pnpm dev                  # http://localhost:3000  → redirects to /dashboard
```

`cp .env.example .env` matters: with `DEMO_MODE` unset the app is read-only, so the Response
Studio, edge reviews, manifest import and **Reset demo** are refused by the server (HTTP 403).

To present the demo from a production build, bind to loopback only:

```bash
pnpm build && pnpm start:local   # next start --hostname 127.0.0.1 → http://127.0.0.1:3000
```

## The golden path (about 2 minutes)

1. **Overview** (`/dashboard`) — a **$450.00** potential shortfall: CloudComms' $2,450.00 charge due
   in 2 days against $2,000.00 available on the Auth Infrastructure fund. Each KPI explains how it
   is counted, and each exposure links to the incident that produced it.
2. **Incident** — the calculation step by step, the confirmed chain
   `Auth Infrastructure fund → Auth virtual card → CloudComms → OTP gateway → Account login`
   (→ Customer checkout, degraded), owners, a manual runbook, and caveats: potential interruption
   only; whether the vendor would suspend service is unknown.
3. **Dependency graph** (`/graph`) — click a vendor to highlight its confirmed downstream impact;
   click an edge to see *why it exists* (evidence, method, timestamps). Suggested edges are dashed
   and never counted until a human reviews them.
4. **Sources** (`/sources`) — every record's evidence, class (synthetic / observed / derived /
   suggested / unknown), verification status and rule lineage.
5. **Response Studio** (`/scenarios`) — model "+$600 to the Auth Infrastructure fund": shortfall
   $450.00 → $0.00, $150.00 margin, Critical → Low. Propose it, submit it, and approve it as a
   *different* demo identity: **APPROVED FOR DEMO — Executed externally: Never.** The incident
   still shows $450.00 because nothing real changed.
6. **Observed decline** — the WebhookWorks incident: an observed transaction decline, explicitly
   *not* a confirmed outage.
7. **Reset demo** (sidebar footer) — restores the seeded fixture and regenerates incidents and
   alerts through the real engine.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js app (`build` runs `prisma generate` first) |
| `pnpm start:local` | Production server bound to `127.0.0.1` (recommended for presenting) |
| `pnpm demo:setup` | Apply migrations and seed the Northstar Labs demo (safe to re-run on an untouched DB; after using the demo, run `pnpm demo:reset`) |
| `pnpm db:deploy` / `pnpm db:migrate` | Apply migrations / create a migration during development |
| `pnpm db:seed` | Transactional "ensure" seed; never overwrites drifted rows (use `demo:reset`) |
| `pnpm demo:reset` | Restore the demo: clears all data, reseeds, regenerates incidents and alerts |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | ESLint / `tsc` (after typegen) / Vitest unit + integration |
| `pnpm test:e2e` | Playwright; builds and serves on `:3100` with its own `e2e-3100.db`. Run `pnpm exec playwright install chromium` once. |
| `pnpm check:provenance` | Read-only audit: fails on dangling evidence, unjustified confirmed edges, unreadable incidents or assertions without inputs |

The seed and reset CLIs default `DEMO_MODE` to `true` only when it is unset; an explicit
`DEMO_MODE=false` (or blank) refuses.

## Architecture (short)

Next.js App Router + TypeScript, Tailwind CSS v4, Lucide, React Flow (`@xyflow/react`), Recharts,
Prisma 7 + SQLite (libSQL adapter), Zod 4, Vitest, Playwright.

- `src/lib/schema` — Zod contracts; money is integer cents, unknown is `null` (never `$0`).
- `src/lib/forecast` — charge projection with validation gates (`projected-shortfall-v1`).
- `src/lib/graph` — confirmed-only blast radius; suggested edges only as "possible impacts".
- `src/lib/risk`, `src/lib/incidents` — deterministic risk classifier and idempotent incident
  builder; every evaluation is stored as append-only `DERIVED` rule evidence.
- `src/lib/simulations`, `src/lib/actions` — counterfactual engine on a cloned snapshot;
  approval-gated proposals with an immutable audit trail; runbooks.
- `src/lib/alerts` — in-app alerts on material risk transitions.
- `src/lib/providers` — safe static manifest discovery (no execution, no network).

## Data and safety disclaimers

- All data is fictional demo data. Vendor names (CloudComms, WebhookWorks, ComputeHarbor,
  MetricsRelay) are invented. `SPEND_LIMIT` is local demo wording, not a verified Ramp enum.
- FailSafe never requests card PAN/CVV, never calls Ramp write endpoints, and never claims a
  simulated action changed live funds or card limits.
- Risk is *potential* impact through confirmed dependencies, not a prediction that a vendor will
  suspend service.
- Alerts are **in-app only**; nothing is sent by email, Slack or webhook.
- **Not implemented in this MVP:** a read-only Ramp sandbox adapter (FS-18) and AI-assisted edge
  suggestions (FS-19). The app makes no network calls and has no integration settings; the
  `RAMP_*` and `LLM_*` variables in `.env.example` are unused placeholders.

## Known limitations

- Demo identities (proposer, approver, reviewer) are typed in, not authenticated.
- `POST /api/demo/reset` requires `DEMO_MODE=true` and a loopback (or `DEMO_RESET_ALLOWED_HOSTS`)
  Host plus same-origin headers. A route handler cannot see the caller's socket address, so a
  non-browser client on the same LAN could forge `Host: localhost`; present with
  `pnpm start:local` (127.0.0.1) unless LAN access is intended. Any page on another localhost port
  can also trigger a reset. There is no rate limit.
- Under the fixed demo clock, snoozed alerts do not expire on their own.
- Funds with a `DAILY` interval are rarely scorable (no workspace timezone is modeled).
- Unknown incident pages render the not-found UI with HTTP 200 (streamed route); the API returns 404.
- Record immutability is enforced in the repository layer, not by database triggers.
