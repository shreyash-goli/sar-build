# Progress

## Now
- FS-05 — evidence ledger & Sources page (QA FAIL on e2e setup race + demo-off chip copy; fixes in progress)
- FS-07 — dependency graph UI (@frontend) + GET /api/graph (@backend, done, awaiting QA)
- FS-11 — risk engine & incidents (@backend, in progress)

## Next
- FS-12 after FS-11 + FS-01; FS-08 after FS-07
- FS-07 needs FS-06 + FS-01; FS-12 needs FS-11 + FS-01

## Done
- FS-00 — runnable repository (commit c7ec96f)
- FS-01 — design system & navigation (commit 647d66c)
- FS-02 — provenance & data-contract types (commit 10d2d07)
- FS-01 follow-up (commits 9de418d, f60135c)
- FS-03 — persistent normalized database (commit 6d82325)
- fix(graph) — verified evidence for every confirmed edge (commit f002912)
- FS-04 — Northstar seed & reset (commit 0bd17d0)
- FS-10 — charge/fund projection (commit 911ce62)
- FS-06 — graph algorithms (commit 810eb35; FS-05 dependency is documentation-only — code does not import FS-05)

## Blockers
- None

## Log
<!-- YYYY-MM-DD — what changed -->
- 2026-11-03 — Baseline commit 7394039 preserves the pre-existing scaffold and docs exactly as found (repo had no commits).

## FS-00 — 2026-11-03
- Status: PASS
- Implemented: Completed the pre-existing partial scaffold (Next 16.4.4 + runtime deps were present; no dev toolchain, configs, env template or README). Added TypeScript 6.0.3, ESLint 9.39.5 + eslint-config-next 16.4.4, Tailwind 4.3.4 via @tailwindcss/postcss, Prisma CLI 7.10.1 (matches @prisma/client 7), Vitest 5.1.0, @playwright/test 1.64.1, tsx. Replaced an unsupported `@tailwindcss/turbopack` loader rule with `postcss.config.mjs` per bundled Next docs. `typecheck` = `next typegen && tsc --noEmit` so `LayoutProps` globals exist on a clean clone. Offline starter screen "FailSafe / Demo" (Google fonts removed — build needs no network).
- Files: package.json, pnpm-lock.yaml, pnpm-workspace.yaml (allowBuilds: esbuild, prisma, @prisma/engines), next.config.ts, postcss.config.mjs, vitest.config.mts, playwright.config.ts, components.json, src/lib/utils.ts, .env.example, .gitignore, README.md, src/app/{layout.tsx,page.tsx,globals.css}; removed template SVGs in public/.
- Source inputs: docs/BUILD_BLUEPRINT.md FS-00; node_modules/next/dist/docs (CSS/Tailwind, typegen).
- Commands: `pnpm install` PASS (no peer issues after pinning); `pnpm lint` PASS; `pnpm typecheck` PASS; `pnpm build` PASS (routes `/`, `/_not-found`); `pnpm test` PASS (no tests yet, passWithNoTests); `pnpm start` → GET / 200 containing "FailSafe / Demo" and "DEMO DATA", compiled Tailwind CSS served.
- QA: @qa (failsafe-qa) independent review — PASS, no blocking defects.
- UX evidence: `/` renders starter screen with DEMO DATA chip, no keys or .env required.
- Limitations: `db:seed`, `demo:reset`, `check:provenance` are script slots that fail until FS-03/FS-04/FS-21; shadcn components not yet generated (config only); no tests yet.
- Commit: c7ec96f
- Next: FS-01 and FS-02 (parallel)

## FS-01 — 2026-11-03
- Status: PASS
- Implemented: (app) route group with shared shell for Overview (/dashboard), Dependency Graph (/graph), Incidents (/incidents), Response Studio (/scenarios), Sources (/sources); / redirects to /dashboard. Sidebar with active state, collapse, mobile drawer (focus trap, Escape, focus return), skip link. Top bar mode chip derived server-side from DEMO_MODE ("DEMO DATA" / "NO SOURCE CONNECTED"; sandbox not representable), "No data loaded" freshness, labeled demo clock. Dark navy theme tokens, global focus ring, reduced motion. Primitives: Button, Badge, Card, Skeleton, EmptyState, PageHeader, Toast provider; loading.tsx per route, (app) error boundary.
- Files: src/app/{globals.css,layout.tsx,page.tsx}, src/app/(app)/**, src/components/ui/**, src/components/layout/**, tests/e2e/shell.spec.ts.
- Commands: pnpm lint PASS; pnpm typecheck PASS; pnpm build PASS (5 dynamic routes); pnpm test:e2e 16/16 PASS (builder and QA independently).
- QA: PASS. QA probes: chip under DEMO_MODE true/unset/invalid DEMO_NOW; no horizontal overflow at 320/390/1280px on all routes; drawer Tab trap; lowest text contrast 4.61:1 (AA); zero console errors; every control functional; no hardcoded metrics.
- UX evidence: all 5 routes render consistent shell with honest empty state "No data loaded yet".
- Limitations (non-blocking QA findings, follow-up in progress): mobile top bar hides freshness (<640px); invalid DEMO_NOW silently hides clock; toast system has no real caller yet so is untested; error-boundary retry untested.
- Commit: 647d66c
- Next: FS-07/FS-12 once their backend deps land

## FS-02 — 2026-11-03
- Status: PASS
- Implemented: Zod v4 contracts in src/lib/schema (enums, primitives, money, evidence, domain, graph, risk, simulation, api). Unknown money = null, never 0; null-preserving add/subtract/compare return UNKNOWN; integer-cent formatter renders null as "Unknown". Edge requires evidenceId; ImportEdge only SUGGESTED; self-loops rejected. PaymentInstrument strict (PAN/CVV keys rejected), PAN-shaped externalCardId rejected. Evidence kind↔classification constrained (FIXTURE→DEMO_FIXTURE, MODEL→MODEL_SUGGESTED, RULE→DERIVED). RiskAssertion matches runtime provenance contract; every assertion cites ≥1 input except UNKNOWN-with-limitations. SimulationPatch strict 4-kind union, positive integer amounts, client risk scores rejected. Centralized SOURCE_CLASS_DISPLAY + getSimulationBadge in src/lib/provenance. Test wrapper scripts/vitest.mjs makes `pnpm test -- <filter>` filter and fail on zero matches.
- Files: src/lib/schema/*.ts, src/lib/provenance/{display,index}.ts, tests/unit/{provenance,money,schema}.test.ts, scripts/vitest.mjs, package.json (test script).
- Source inputs: BUILD_BLUEPRINT.md sections 2, 4, 5.
- Commands: pnpm test 96/96 PASS; pnpm test -- provenance 39/39 PASS; pnpm test -- nonexistentfilter exits 1 (intended); pnpm lint PASS; tsc --noEmit PASS.
- QA: initial PASS with 1 Medium + 4 Low → all fixed → re-verify PASS.
- Limitations: PAN embedded inside a longer ID string is not detected (anchored pattern); CONFIRMED-edge-with-unreviewed-model-evidence check deferred to FS-03 repository layer.
- Commit: 10d2d07
- Next: FS-03

## FS-01 follow-up — 2026-11-03
- Status: PASS
- Implemented: mode chip uses shared @/lib/provenance metadata (WORKSPACE_MODE_DISPLAY, getSimulationBadge); compact mobile freshness strip (<640px); "Demo clock invalid" for unparseable DEMO_NOW; shared ProvenanceTone→Badge map; shell-status uses shared isDemoModeEnabled so chip and write gate agree.
- Files: src/components/layout/{app-shell,brand,mode-chip,mode-copy,shell-status}.ts(x), src/components/ui/provenance-tone.ts, src/app/(app)/{layout.tsx,sources/page.tsx}, tests/e2e/shell.spec.ts, tests/unit/shell-status.test.ts.
- Commands: pnpm test -- shell-status 21/21; lint, typecheck, build PASS; pnpm test:e2e 21/21.
- QA: PASS (manual check of DEMO_NOW=garbage at 320/1280px; contrast 5.68:1 / 9.7:1).
- Limitations: "Demo clock invalid" rendering covered by unit + manual check only (e2e server uses valid clock); toast still has no real caller.
- Commit: 9de418d, f60135c

## FS-03 — 2026-11-03
- Status: PASS
- Implemented: Prisma 7.10 + SQLite (libSQL driver adapter) schema for all 13 models mirroring FS-02 Zod contracts; init migration; BigInt integer-cent money (Prisma Int is 32-bit); no @default, nullable unknowns; unique keys (externalFundId, externalCardId, Vendor.normalizedKey, Transaction.providerEventId, Incident.scenarioKey, Edge(from,to,relation), Evidence(sourceSystem,sourceId,capturedAt)); evidence FKs Restrict. getDb() singleton with browser guard. Typed repositories validating with Zod on read/write; idempotent transaction ingest; evidence/audit/simulation have no update/delete; incidents only via gated deleteForDemoReset. Edge provenance gate (USER_VERIFIED required for MODEL/MANIFEST/RULE or MODEL_SUGGESTED/UNKNOWN/DERIVED evidence and for any promotion to CONFIRMED). ActionProposal create limited to DRAFT/PENDING_APPROVAL, invalid transitions → 409. Write gate: DEMO_MODE (shared parser src/lib/env.ts) or ≥16-char ADMIN_TOKEN (constant-time).
- Files: prisma/schema.prisma, prisma/migrations/20261104064525_init/**, prisma.config.ts, src/lib/{db,env}.ts, src/lib/repositories/**, src/lib/security/write-gate.ts, tests/integration/repositories.test.ts, tests/unit/{edge-policy,env,write-gate}.test.ts, package.json (+@prisma/adapter-libsql 7.10.1, db:generate/db:deploy/postinstall; build/typecheck run prisma generate), .env.example (ADMIN_TOKEN), .gitignore (/src/generated/), eslint.config.mjs.
- Commands: prisma validate PASS; prisma migrate dev --name init applied, re-run "Already in sync"; prisma migrate status up to date; pnpm test 217/217 (incl. FS-04 prep tests); pnpm test -- repositories 33/33; lint, typecheck, build PASS.
- QA: initial PASS with 1 Medium (RULE/DERIVED evidence could confirm edges) + 4 Low → fixed → re-verify PASS. QA clean-clone check: frozen offline install regenerates client, typecheck/build/test pass with no .env/dev.db; dev.db sha1 unchanged by tests.
- Limitations: immutability enforced at repository layer only (no SQLite triggers; raw Prisma client can still update evidence); direct CONFIRMED create on unverified MANUAL/API evidence still allowed (fixed in f002912); first API route may need serverExternalPackages for libSQL; Prisma CLI does not read .env (defaults match .env.example).
- Commit: 6d82325
- Next: FS-04

## fix(graph) — 2026-11-03
- Status: PASS
- Implemented: any CONFIRMED edge needs USER_VERIFIED evidence unless evidence is FIXTURE+DEMO_FIXTURE and the write is not a promotion; closes delete-and-recreate bypass (QA FS-03 residual).
- Files: src/lib/repositories/{edge-policy,index}.ts, tests/unit/edge-policy.test.ts, tests/integration/repositories.test.ts.
- Commands: pnpm test 242/242; lint; tsc. QA probe cases 1a–1n all as intended.
- QA: PASS. Info: any gated writer can still create FIXTURE evidence (stays labeled demo); possible future tightening to DEMO mode only.
- Commit: f002912

## FS-04 — 2026-11-03
- Status: PASS
- Implemented: src/fixtures/northstar-demo.json (scenarios A–D, all fictional; 1 workspace, 3 funds, 3 cards, 4 vendors, 3 charges, 3 transactions, 18 nodes, 15 edges = 14 CONFIRMED / 1 SUGGESTED / 0 REJECTED, 49 FIXTURE/DEMO_FIXTURE/UNVERIFIED evidence records, one per record). Hero: fund-auth limit 400000 / available 200000, CloudComms charge 245000 due 2026-11-19T16:00:00Z, checkout edge DEGRADED. B: WebhookWorks DECLINED, local SPEND_LIMIT wording, edge MEDIUM confidence with potential-impact caveat. C: ComputeHarbor healthy. D: MetricsRelay billing UNKNOWN, no funding source. No precomputed incidents/simulations/proposals. Seed = transactional "ensure" (never overwrites; drift aborts → run reset). demo:reset = DEMO_MODE-only gated clear + reseed in one transaction (admin token cannot reset). Demo clock: getNow/resolveDemoClock/DEFAULT_DEMO_NOW. CLI defaults DEMO_MODE only if undefined.
- Files: src/fixtures/{northstar-demo.json,northstar.ts}, src/lib/demo/{northstar,cli-env}.ts, src/lib/time.ts, prisma/seed.ts, scripts/reset-demo.ts, prisma.config.ts, package.json, src/lib/repositories/index.ts, tests/integration/{seed,repositories}.test.ts, tests/unit/{fixtures,time}.test.ts. (Repository tx-client + demoReset.clearAllData additions landed early in 6d82325; reviewed under FS-04.)
- Source inputs: BUILD_BLUEPRINT.md section 3 demo dataset.
- Commands: pnpm db:seed && pnpm demo:reset && pnpm test -- fixtures → 28 PASS; second db:seed creates 0 rows; two consecutive resets → byte-identical sqlite dumps; DEMO_MODE=false / blank / 0 → reset refuses exit 1 with DB unchanged; FS-04 commit alone in clean worktree: 256/256 tests.
- QA: initial PASS with 4 Low (blank DEMO_MODE defaulted to true and could wipe; UI/server demo-clock mismatch; WebhookWorks edge lacked uncertainty; per-incident delete lacked demo gate) → all fixed → re-verify PASS.
- Limitations: rule lineage/incidents regenerate only once FS-11/FS-14 exist; shell still to switch to resolveDemoClock (in progress with FS-05 frontend); after fixture changes an existing dev.db needs one `pnpm demo:reset` before `db:seed` (drift guard by design).
- Commit: 0bd17d0
- Next: FS-05, FS-10

## FS-10 — 2026-11-03
- Status: PASS
- Implemented: src/lib/forecast — projectCharge/projectCharges (rule projected-shortfall-v1) with gates: vendor, CARD billing, funding source, amount, date, known availability, same billing period across UTC-12..+14 in 15-minute steps (else AMBIGUOUS → UNKNOWN), past-due, prior-charge billing; unknown → UNKNOWN_DATA listing every requested mapping, shortfall null (never $0). Only CARD priors deducted. Availability from the future → UNKNOWN; >7 days old → stale assumption. suggestRecurringCharges (rule recurring-charge-suggestion-v1): ≥3 cleared positive charges with non-rejected non-model evidence and consistent cadence; integer median; stale → UNKNOWN; displayLabel "Suggested from history".
- Files: src/lib/forecast/{period,projection,recurring,index}.ts, tests/unit/forecast.test.ts.
- Commands: pnpm test -- forecast 40/40; pnpm test 362/362; lint; tsc.
- Evidence: hero SCORED expected 245000, available 200000, shortfall 45000, dueInDays 2, inputs [ev-charge-cloudcomms-20261119, ev-vendor-cloudcomms, ev-fund-auth]; +60000 → shortfall 0, margin 15000; Scenario C shortfall 0; Scenario D UNKNOWN_DATA [BILLING_METHOD, FUNDING_SOURCE].
- QA: PASS with 1 Medium (UNKNOWN-billed priors inflated shortfall to 145000) + 4 Low → fixed → re-verify PASS.
- Limitations: DAILY-interval funds are rarely scorable (no workspace timezone modeled); "verified" recurring history = not REJECTED and not MODEL_SUGGESTED evidence (UNVERIFIED fixture/observed counts); stale-threshold 7 days is a documented constant.
- Commit: 911ce62

## FS-06 — 2026-11-03
- Status: PASS
- Implemented: src/lib/graph — enumeratePaths/computeBlastRadius: confirmed-only gating via countsAsConfirmed, REJECTED never followed, SUGGESTED only in separate possible set; deterministic path IDs; edge/evidence IDs per path; weakest dependency strength → POTENTIAL_INTERRUPTION / POTENTIAL_DEGRADATION / MINOR_DEPENDENCY wording; workflows deduped with path counts; sort by criticality, length, ID; reverse-reachability pruning + maxDepth/maxPaths/maxSteps (50k) with per-set truncated/depthLimited flags; dangling edges reported.
- Files: src/lib/graph/{traverse,impact,index}.ts, tests/unit/graph.test.ts.
- Commands: graph tests PASS; pnpm test 362/362; lint; tsc; committed tree verified in isolation (tsc OK, 320/320).
- Evidence: fund-auth → Account login (4 HARD edges) and Customer checkout (+DEGRADED edge) with exact path IDs; WebhookWorks → On-call escalation; MetricsRelay confirmed empty, Weekly growth reporting only possible.
- QA: PASS with 1 Medium (unbounded DFS when no terminal reachable: 3.4s on 56-node mesh) + 3 Low → fixed (now 1 ms) → re-verify PASS.
- Limitations: simple-path enumeration is bounded, not exhaustive, on dense graphs (truncation is flagged).
- Commit: 810eb35
