# FailSafe

> Prototype: "PagerDuty for financial dependencies." **Not an official Ramp product.**
> All bundled data is fictional (`DEMO_FIXTURE`). No live funds or cards are ever changed.

FailSafe detects when a payment issue could put a critical business workflow at risk,
explains the operational blast radius through a source-backed dependency graph, and lets a
human approve a *simulated* mitigation.

The authoritative spec is [`docs/BUILD_BLUEPRINT.md`](docs/BUILD_BLUEPRINT.md); the build
journal is [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Requirements

- Node.js 22+
- pnpm 12 (`corepack enable`)

## Setup (no keys required)

```bash
pnpm install
cp .env.example .env      # DEMO_MODE=true, SQLite, fixed demo clock
pnpm dev                  # http://localhost:3000
```

## Scripts

| Script | Purpose | Status |
| --- | --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js app | available |
| `pnpm lint` | ESLint (next core-web-vitals + TS) | available |
| `pnpm typecheck` | `tsc --noEmit` | available |
| `pnpm test` | Vitest unit/integration (`tests/unit`, `tests/integration`) | available |
| `pnpm test:e2e` | Playwright (`tests/e2e`) — run `pnpm exec playwright install chromium` once | available |
| `pnpm db:migrate` / `pnpm db:seed` | Prisma SQLite | slot — implemented in FS-03/FS-04 |
| `pnpm demo:reset` | Restore seeded demo | slot — implemented in FS-04 |
| `pnpm check:provenance` | Dangling-assertion checker | slot — implemented in FS-21 |

## Stack

Next.js App Router + TypeScript, Tailwind CSS v4, shadcn/ui conventions (`components.json`),
Lucide, React Flow (`@xyflow/react`), Recharts, Prisma + SQLite, Zod, Vitest, Playwright.

## Safety

FailSafe never requests card PAN/CVV, never calls Ramp write endpoints, and labels every
simulated action as `SIMULATION ONLY`. Optional Ramp sandbox and LLM features are off unless
configured, and say so in the UI.
