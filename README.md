# FailSafe

> Prototype: "PagerDuty for financial dependencies." **Not an official Ramp product.**
> All bundled data is fictional (`DEMO_FIXTURE`, the Northstar Labs workspace). No live funds,
> cards or Ramp data are ever changed; Ramp sandbox data is only *read*, and only if you configure the
> optional adapter (FS-18). Every simulated action is labeled `SIMULATION ONLY`.

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
| `pnpm ramp:init --confirm` | Optional: clear all data and create an empty read-only Ramp sandbox workspace (FS-18) |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | ESLint / `tsc` (after typegen) / Vitest unit + integration |
| `pnpm test:e2e` | Playwright; builds and serves on `:3100` with its own `e2e-3100.db`. Run `pnpm exec playwright install chromium` once. |
| `pnpm check:provenance` | Read-only audit: fails on dangling evidence, unjustified confirmed edges, unreadable incidents or assertions without inputs (also runs before every e2e build) |
| `pnpm verify` | CI-style gate: lint, typecheck, unit + integration tests (incl. the API smoke suite), then `check:provenance` |

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
- `src/lib/providers` — safe static manifest discovery (no execution, no network); optional AI
  suggestions and read-only Ramp sandbox adapter (network only when configured).

## Data and safety disclaimers

- All data is fictional demo data. Vendor names (CloudComms, WebhookWorks, ComputeHarbor,
  MetricsRelay) are invented. `SPEND_LIMIT` is local demo wording, not a verified Ramp enum.
- FailSafe never requests card PAN/CVV, never calls Ramp write endpoints, and never claims a
  simulated action changed live funds or card limits.
- Risk is *potential* impact through confirmed dependencies, not a prediction that a vendor will
  suspend service.
- Alerts are **in-app only**; nothing is sent by email, Slack or webhook.
- Server hardening (FS-21): every write route is refused without `DEMO_MODE=true` (Ramp sync also
  accepts `ADMIN_TOKEN`), refuses cross-origin browser requests, and reads at most 16 KiB of JSON
  (manifest import: its own larger cap). Unexpected errors return a generic `500 Internal error`
  without stack traces; server logs redact credentials, tokens and secret environment values.
- **AI-assisted suggestions (FS-19) are optional and OFF by default.** With `LLM_API_KEY` and
  `LLM_MODEL` set (an OpenAI-style chat-completions endpoint via `LLM_BASE_URL`, tested with mocked
  responses only; the server must support JSON mode via `response_format`), a manifest import with
  `suggester: "ai"` asks the model to map parsed dependency references to known vendors. Only
  references that match the built-in provider list are sent (file name, line, the reference, and its
  version only when it is plain semver-like, such as `^1.2.3`; prerelease/build tags and
  git/URL/`file:`/`workspace:` specs are omitted and URL credentials stripped). Other references
  never leave the process (counted as `suggester.omittedFindings`), and file contents and secrets
  are never sent. Output is schema-validated; anything not grounded in a real finding, a provider
  the built-in taxonomy assigns to that exact reference, and a matching vendor node is rejected, so
  the model can explain known mappings but never introduce new ones. In AI mode, rules matches the
  model did not return are not suggested (run a rules import to see them). AI suggestions are stored
  as `SUGGESTED` edges with `MODEL_SUGGESTED` evidence and count only after human review. Without a
  key the API answers `AI OFF` (HTTP 503 for `suggester: "ai"`), `GET /api/integrations/ai/status`
  reports `AI_OFF`, and a model failure is reported as `AI_ERROR` with an explicitly labelled rules
  fallback. Without a key the app makes no network calls.
- **Read-only Ramp sandbox adapter (FS-18) is optional and NOT CONNECTED by default.** With
  `RAMP_CLIENT_ID`/`RAMP_CLIENT_SECRET` set, `POST /api/integrations/ramp/sync` reads funds, cards
  and transactions (including declines) from `https://demo-api.ramp.com` with read-only scopes
  (`transactions:read cards:read funds:read`), using only GET requests plus the OAuth token request.
  It never requests card vault scopes and refuses any card payload containing PAN/CVV-like fields.
  Only the sandbox host is supported in this MVP: any other `RAMP_API_BASE_URL` (including
  production) is `NOT_CONFIGURED`. Sync runs only in a separate, empty `RAMP_SANDBOX` workspace
  created by `pnpm ramp:init --confirm` (this clears the demo; restore it with `pnpm demo:reset`),
  so demo and Ramp data are never mixed. Ramp records are stored as `RAMP_SANDBOX` API evidence;
  unknown values stay unknown (available balance, billing method), and fund→card→vendor links are
  `SUGGESTED` until reviewed. Partial reads are reported as `PARTIAL` with per-resource errors,
  never as success (an overall `FAILED` sync is HTTP 502), and there is no fallback to demo data.
  Without credentials, `GET /api/integrations/ramp/status` reports `NOT_CONFIGURED` and sync returns
  HTTP 503 without any network call. **Live sandbox sync is BLOCKED/untested:** it is verified only
  against a mocked Ramp API, as no sandbox credentials were available. The card-secret key scan
  matches generic field names (e.g. `number`, `expiration`, `pin`), so it could refuse real card
  payloads; that fails safe (cards are not stored), but it is untested against real Ramp data.

## Known limitations

- Demo identities (proposer, approver, reviewer) are typed in, not authenticated.
- `POST /api/demo/reset` requires `DEMO_MODE=true` and a loopback (or `DEMO_RESET_ALLOWED_HOSTS`)
  Host plus same-origin headers. A route handler cannot see the caller's socket address, so a
  non-browser client on the same LAN could forge `Host: localhost`; present with
  `pnpm start:local` (127.0.0.1) unless LAN access is intended. Browser requests from another
  origin (including another localhost port) are refused. There is no rate limit.
- Under the fixed demo clock, snoozed alerts do not expire on their own.
- Funds with a `DAILY` interval are rarely scorable (no workspace timezone is modeled).
- Unknown incident pages render the not-found UI with HTTP 200 (streamed route); the API returns 404.
- Record immutability is enforced in the repository layer, not by database triggers.
