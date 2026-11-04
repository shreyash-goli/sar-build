# Progress

## Now
- MVP FS-00–FS-17 COMPLETE. FS-19, FS-20, FS-21 COMPLETE.
- FS-18 — implementation complete (bf18d61 backend, b257c94 UI); status BLOCKED for live sandbox read (no credentials) per the blueprint, so the box stays unchecked.
- FS-23 — demo script, feature provenance appendix, final QA (in progress).
- FS-22 — deployment: awaiting explicit human approval and target host.

## Next
- FS-21 hardening (check:provenance prep committed 9440132/eedd507), FS-22 deployment (requires human approval), FS-23 pitch/docs

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
- FS-11 — risk engine & incidents (commit 9a0cf99; committed before FS-05 because FS-05 tests read FS-11 rule evidence)
- FS-05 — evidence ledger & Sources inspector, incl. FS-07 graph API backend and per-port e2e DB (commit 71cc33f)
- FS-14 backend — simulation engine + scenarios API (commit 90c9099)
- FS-07 — dependency graph UI (commit 9c3c961)
- FS-05 inspector follow-up — lineage status + demo-input trust line (commit fb1a416); trust-summary unit tests (6919fc6)
- FS-14 limit-wording fix (5855016); fix(actions) 8cef304; fix(graph) fee02f2; fix(simulation) a220725
- FS-15 backend — approval actions + audit trail (commit f69c9d0)
- FS-08 backend — suggested-edge review API (commit a8e37ef)
- FS-16 backend — runbook rules module (commit d31ede2; wired into incident detail in 6afda58)
- FS-12 — Overview dashboard (commit fecd3dd)
- FS-13 — incident list & detail (commit 6afda58)
- FS-14 UI + FS-15 UI — Response Studio with approvals (commit 83e38ee)
- FS-20 backend — in-app alerts (commit 10ed651); FS-21 prep check:provenance (9440132, eedd507)
- FS-09 — safe manifest discovery (commit c78e77d; fixes e2959c9)
- FS-17 backend — demo reset API (5fbe260; fixes fde1e7a, 4f0f8ef; start:local 33a7bfa)
- FS-08 UI — edge inspector + review (commit 4c69130)
- FS-16 UI — runbook checklist (commit 3bace82)
- FS-17 — MVP lock: reset control, golden-path e2e, README (commit 2790251)
- frontend Lows — inspector focus return, checklist copy (640bc23)
- FS-20 UI — alert center (d25aef4)
- FS-19 — AI suggestions, AI OFF by default (fe6e55a)
- FS-18 backend — read-only Ramp sandbox adapter, mocked API only (bf18d61)
- fix(providers) honest 'used' when model skipped (f5bfb08); fix(alerts) message wording (36d320a)
- FS-18/19 UI — integrations panel (b257c94)
- FS-21 — security hardening + regression suite (2099af7)

## Blockers
- FS-18 live sandbox sync: BLOCKED — no Ramp sandbox credentials available (mocked-API implementation only).
- FS-19 live model calls: BLOCKED — no LLM key; product runs in clearly labeled AI OFF mode.
- FS-22 deployment: requires explicit human approval before any external deployment.

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

## FS-11 — 2026-11-04
- Status: PASS
- Implemented: src/lib/risk/classify.ts evaluateRisk (rules projected-shortfall-v1, observed-decline-v1, risk-severity-v1): section 5 ladder over confirmed paths through the vendor; severity ≠ confidence (weakest driving edge tier; capped at MEDIUM when availability stale; capped at LOW with limitation + mapping request when the fund→vendor payment link is not confirmed); no confirmed path → UNKNOWN; >14 days → LOW labeled "outside the 14-day scoring window; monitoring". OBSERVED_DECLINE is a separate incident: "vendor service impact unconfirmed… not a confirmed outage"; SPEND_LIMIT labeled local demo terminology. src/lib/incidents materializeIncidents: stable incidentKey/scenarioKey, idempotent (unchanged rerun writes nothing), snapshotJson with evaluation/impact/evidence, append-only RULE/DERIVED evidence per evaluation fingerprint; status transitions documented (re-open on escalation with previousSeverity). Seed/reset regenerate incidents through the engine in-transaction. PathIdSchema (max 4096).
- Files: src/lib/risk/**, src/lib/incidents/{materialize,status,index}.ts, src/lib/schema/risk.ts, src/lib/demo/northstar.ts, tests/unit/{risk,schema}.test.ts, tests/integration/{incidents,seed}.test.ts.
- Commands: pnpm test 460/460; risk+incidents 45; lint; tsc; demo:reset regenerated 4 incidents; db:seed rerun 0 changes; two resets byte-identical dumps; isolated committed tree tsc + 362/362.
- Evidence: CloudComms CRITICAL/HIGH $450 PROJECTED_SHORTFALL citing login + checkout path IDs; WebhookWorks HIGH/MEDIUM OBSERVED_DECLINE; ComputeHarbor LOW (margin $10,200); MetricsRelay UNKNOWN with requested mappings.
- QA: PASS with 1 Medium (rejected/suggested payment edge still scored HIGH confidence) + 3 Low → fixed → re-verify PASS (probe: PAYS REJECTED/SUGGESTED and BACKS REJECTED → CRITICAL/LOW with caveat).
- Limitations: one incident per declined transaction; healthy charges materialize as MONITORING/LOW rows (UI must not count them as alerts); confidence for NO_RISK derives from graph edge tiers.
- Commit: 9a0cf99

## FS-05 — 2026-11-04
- Status: PASS
- Implemented: evidence resolvers for all subject types; ledger (supported assertions, totals, unresolved refs, rule lineage CURRENT/SUPERSEDED/NOT_APPLICABLE with recordedRule, DEMO DATA badge on derived evidence from demo inputs); GET /api/sources[/id] (strict validation, 400/404/503, generic 500); category definitions; /sources page with filters, deep-linkable inspector (supported assertions, demo-vs-verified trust summary, lineage), unresolved warning, loading/empty/error. Shell: chip from stored workspace mode with "Demo mode off · read-only" hint, honest freshness from latest evidence capturedAt, shared resolveDemoClock. E2E: per-port DB prepared in the webServer command (db:deploy + demo:reset), reuseExistingServer false. Includes FS-07 backend half (GET /api/graph, loadGraph, vendor needsMapping) because sources.test exercises it and it depends on the ledger schema.
- Files: src/lib/provenance/{index,definitions,ledger-schema,ledger}.ts, src/app/api/_lib/{http,sources,graph}.ts, src/app/api/{sources,graph}/**, src/lib/graph/{schema,load,index}.ts, src/app/(app)/{layout.tsx,sources/**}, src/components/{evidence,layout}/**, playwright.config.ts, tests/e2e/{sources,shell}.spec.ts, tests/integration/{sources,graph-api}.test.ts, tests/unit/{definitions,shell-status,shell-freshness}.test.ts.
- Commands: pnpm test 462/462 (main tree); lint; typecheck; build; e2e 43/43 on a clean run (QA); committed tree in isolation tsc + 420/420 + lint.
- UX evidence: inspector for ev-edge-vendor-cloudcomms--service-otp-gateway shows "CloudComms POWERS OTP gateway", Confirmed, DEMO DATA, "Demo / mock data… Unverified"; no RAMP_DOCUMENTED anywhere; overflow 0 at 320/390/768/1024/1280px; DEMO_MODE=false with seeded DB shows DEMO DATA + read-only hint.
- QA: initial FAIL (High: Playwright starts webServer before globalSetup, which deleted the open e2e.db → 30/34 fail; Medium: "Nothing shown is live or demo data" above 49 demo records) → fixed → re-verify PASS (43/43). Ledger add-on (superseded lineage, demo-input badge) PASS.
- Limitations: freshness lists all evidence per request (fine at demo scale); e2e shell.spec in this commit asserts /graph as a data route, which the FS-07 UI commit completes; graph API + Sources share this commit.
- Commit: 71cc33f

## FS-14 backend — 2026-11-04
- Status: PASS (backend half; Response Studio UI pending)
- Implemented: src/lib/simulations — structuredClone snapshot, validated SimulationPatch (4 kinds with feasibility checks), same evaluateRisk before/after, per-incident diff, changedInputs, assumptions ("Modeled change; no Ramp funds or card limits were changed"), ruleVersion, label SIMULATION ONLY. runSimulation writes only an append-only Simulation (isDemo) + simulation.run AuditEvent in one transaction. POST /api/scenarios/run (400/404/403/503), GET /api/scenarios.
- Files: src/lib/simulations/**, src/app/api/_lib/scenarios.ts, src/app/api/scenarios/**, tests/unit/simulation.test.ts, tests/integration/scenarios-api.test.ts.
- Commands: simulation+scenarios 21/21; pnpm test 483; lint; tsc; isolated committed tree 441/441.
- Evidence: T-02 +$600 → available 260000, shortfall 0, margin 15000, hero CRITICAL → NO_RISK/LOW; T-03 full sqlite dump hash identical after 3 runs + 11 rejected (excluding simulation/audit rows).
- QA: PASS, 1 Low (limit wording when limitCents unknown) — fixed in working tree, pending commit.
- Limitations: no rate limit on simulation POST in demo mode; each run appends (exploration log, no dedupe).
- Commit: 90c9099

## FS-07 — 2026-11-04
- Status: PASS
- Implemented: /graph React Flow view on loadGraph(): deterministic 6-column layout, kind icons, minimap/zoom/fit, search, filters, deep links; vendor selection highlights confirmed downstream workflows (computeBlastRadius) + upstream funding chain; possible impacts separate; exact-path isolation; solid/dashed/dotted edges; 11px relation pills; canonical needs-mapping in amber "not a risk rating"; node evidence with View source; non-canvas path list; keyboard + aria-live. Backend half (GET /api/graph) committed in 71cc33f.
- Files: src/app/(app)/graph/**, src/components/graph/**, tests/e2e/graph.spec.ts, tests/unit/graph-model.test.ts.
- Commands: lint, typecheck, build, pnpm test 486, e2e 48/48 clean (QA); isolated committed tree tsc + lint + 459/459.
- UX evidence (QA, 1440x900): all six hero nodes legible in one row at fit zoom ≈0.71; clicking CloudComms highlights Account login (potential interruption) + Customer checkout (potential degradation), auto-scrolls 168px so impacts/paths/evidence are visible (instant under reduced motion); MetricsRelay amber "Needs mapping" with 3 reasons; no "at risk" wording; overflow 0 at 320–1024px.
- QA: PASS with 2 Low (7px edge labels; panel below fold) → fixed → final PASS. Side panel deliberately not used (would drop fit zoom to ≈0.5).
- Limitations: no risk colouring until incidents are wired into the graph; REQUIRES pill slightly overlaps OTP node border (cosmetic).
- Commit: 9c3c961 (+ inspector follow-up fb1a416)

## FS-15 backend / FS-08 backend / FS-16 backend — 2026-11-04
- FS-15 backend (f69c9d0): ActionProposal lifecycle DRAFT→PENDING_APPROVAL→APPROVED_FOR_DEMO|REJECTED enforced server-side (409 with from/to); idempotent repeats write no audit (T-18); invalid transitions 409 (T-19); required approver ≠ proposer; rationale ≥10 chars; payload feasibility via FS-14 engine; one append-only AuditEvent per transition recording executedExternally=false; rationale/notes live only in the audit trail (no migration). QA PASS; full-DB dump hash unchanged apart from proposal/audit/simulation rows. Follow-up 8cef304: unreadable audit trail → 500 ACTION_AUDIT_UNREADABLE; simulatedAt.
- FS-08 backend (a8e37ef): POST /api/graph/edges/:id/review; CONFIRM creates new USER_VERIFIED MANUAL evidence from the human justification (prior evidence untouched, nothing invented) and confirms the edge; REJECT keeps evidence; audit per decision; risk re-materialized in-transaction; only SUGGESTED reviewable (409). QA PASS. Follow-up fee02f2: non-DEMO confirmations classified UNKNOWN, never EXTERNAL_OBSERVED.
- FS-16 backend (d31ede2): buildRunbook rule runbook-v1 per category with owners from graph nodes ("Unassigned" when none), dependencies, unknowns, automatic=false, copyable text and disclaimer "FailSafe does not contact vendors, move money or change card limits". QA PASS on all four seeded runbooks.

## FS-12 — 2026-11-04
- Status: PASS
- Implemented: loadDashboard / GET /api/dashboard; KPIs from engine incidents only (at-risk workflows 2, unresolved exposures 2, potential shortfall $450.00 + 1 unquantified, never summed as $0), each with definition + contributing incident IDs; MONITORING/LOW never counted; ranked exposures, covered vendors, top workflows, per-vendor forecast, freshness, resultsEvaluatedAt/lastChangedAt. /dashboard UI with definitions disclosures, links to incidents/graph, Recharts forecast with table alternative.
- Files: src/lib/dashboard/**, src/app/api/{_lib/dashboard.ts,dashboard/**}, src/app/(app)/dashboard/**, src/components/dashboard/**, tests/integration/dashboard.test.ts, tests/e2e/dashboard.spec.ts, tests/unit/dashboard-format.test.ts.
- Commands: pnpm test 554; lint; typecheck; e2e 63/63 clean (QA); isolated committed tree tsc + lint + 510/510; fixture-change tests move totals (100000 → $1,450; 260000 → $0).
- QA: backend PASS (2 Low fixed) → UI PASS → final re-verify PASS.
- Commit: fecd3dd

## FS-13 — 2026-11-04
- Status: PASS
- Implemented: loadIncidents/loadIncident + GET /api/incidents[/id] (signal pill, filters, calculation steps, chains with evidence, possible impacts separate, owners, verbatim caveats, projected timeline, runbook); UI list with alerts vs muted "Healthy, monitoring only"; detail answering "where the $450 came from" ($2,450.00 − $2,000.00) with caveats "whether the vendor would suspend service is unknown"; decline "not a confirmed outage"; NO_RISK "No shortfall · $10,200.00 headroom".
- Files: src/lib/incidents/{schema,load}.ts, src/app/api/{_lib/incidents.ts,incidents/**}, src/app/(app)/incidents/**, src/components/risks/**, src/lib/forecast/projection.ts (availabilityObservedAt), tests/integration/incidents-api.test.ts, tests/e2e/incidents.spec.ts, tests/unit/incident-amount.test.ts, tests/e2e/shell.spec.ts.
- Commands: e2e 63/63 clean (QA); isolated committed tree tsc + lint + 529/529.
- QA: backend PASS (2 Low fixed) → UI PASS (2 Low fixed) → final PASS.
- Limitations: unknown incident page renders not-found UI with HTTP 200 (streamed route; API returns 404); incident status cannot be changed from the UI (no write API).
- Commit: 6afda58

## FS-14 UI + FS-15 UI — 2026-11-04
- Status: PASS
- Implemented: Response Studio at /scenarios — incident picker, run form (4 patch kinds, integer-cent parsing), before/after table, changed inputs, verbatim assumptions, rule versions, other-incident diff, graph path link, history (Run #seq), toasts, sticky SIMULATION ONLY banner; approval panel (propose from simulation, submit, approve/reject with distinct demo identities and "Demo identities, not authenticated" note, allowedTransitions-driven buttons, audit timeline, readable errors, "Executed externally: Never").
- Files: src/app/(app)/scenarios/**, src/components/simulator/**, tests/e2e/{scenarios,actions}.spec.ts, tests/unit/money-input.test.ts.
- Commands: lint; typecheck; pnpm test 576; e2e 67/67 clean (QA); isolated committed tree tsc + lint + 555/555.
- UX evidence (QA): +$600 → Critical→Low, $450→$0, margin $150, available $2,000→$2,600 (modeled); fund-auth unchanged after 6 runs + full approval flow (dump hash identical); self-approval refused; overflow 0 at 320–1024px.
- QA: FS-14 UI PASS (1 cosmetic Low fixed); FS-15 UI PASS. Committed together because the Studio composes both.
- Limitations: identities are free text (no auth) — labeled in UI; forbidden-transition 409 reachable only from a stale page (covered in e2e).
- Commit: 83e38ee

## Process notes — 2026-11-04
- Concurrent e2e runs share `.next`; per-port DBs (e2e-${PORT}.db) isolate data only. Rule adopted: no build/typecheck/e2e in the repo without explicit orchestrator go; builders use isolated scratch copies.
- Commit-boundary deviations (documented in commit messages): FS-11 before FS-05; FS-07 graph API inside FS-05 commit; FS-14+FS-15 UI combined; FS-16 runbook wiring inside FS-13.

## FS-09 — 2026-11-04
- Status: PASS
- Implemented: pure static parsers for package.json / docker-compose / Terraform (no execution, file system or network); bare filenames, format/size/line/file-count caps; curated taxonomy (real providers unmatched, never invent vendors); SUGGESTED LOW OPTIONAL edges with MANIFEST evidence citing file:line + sha256; demo-workspace and bundled-sample imports are DEMO_FIXTURE ("Fictional sample file."); dedupe respecting reviewer REJECT; audit + risk re-materialization; POST /api/imports/manifest (demo check before body read).
- Commands: manifest + provenance tests 64; pnpm test 588; QA probes: hostile scripts never read, YAML billion-laughs inert, 250 KB lines ~1 ms, path traversal rejected, re-import after REJECT stays REJECTED, confirmed risk unchanged.
- QA: FAIL (fictional sample shown as Observed) → fixed → PASS; Low fixed (e2959c9).
- Limitations: no import UI (not required by FS-09); manifest suggestions need FS-08 review to count.
- Commit: c78e77d (+ e2959c9)

## FS-08 — 2026-11-04
- Status: PASS
- Implemented: backend review API (a8e37ef, fee02f2) and UI edge inspector: "Why this edge exists" (evidence excerpt, method, source system, timestamps, badges, Open in Sources), review form only on SUGGESTED edges with required justification and demo-identity note; confirm creates USER_VERIFIED evidence and promotes the edge; reject removes it from possible impacts; both audited; graph and impact refresh.
- Commands: e2e graph-review 4/4 within 74/74 clean (QA); isolated committed tree 608/608.
- QA: PASS. Low queued: restore focus to trigger after Escape.
- Commit: 4c69130 (backend a8e37ef)

## FS-16 — 2026-11-04
- Status: PASS
- Implemented: runbook-v1 rules (d31ede2) rendered on incident detail: next owner ("Unassigned" when none), disclaimer, numbered manual steps with owners, dependencies, unknowns and copyable text.
- Commands: runbook.spec + incidents.spec within 74/74 clean (QA); clipboard copy verified by mouse and keyboard.
- QA: PASS. Low queued: whole-checklist copy double-numbers steps.
- Commit: 3bace82 (backend d31ede2)

## FS-17 — 2026-11-04 — MVP LOCK
- Status: PASS
- Implemented: POST /api/demo/reset (DEMO_MODE + loopback Host + same-origin; 5fbe260, fde1e7a, 4f0f8ef); shell Reset demo control with confirm dialog; pnpm start:local (127.0.0.1); pnpm demo:setup; tests/e2e/hero.spec.ts golden path (T-21); README rewritten.
- Commands (QA, exact FS-17 verify): `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` → exit 0; 608 unit/integration; 74/74 e2e incl. hero.spec. Literal README setup on a clean clone (no .env/dev.db/.next/generated client): install → cp .env.example .env → demo:setup → dev → every page and read API 200 with zero keys; start:local listens on 127.0.0.1 only.
- UX evidence: dashboard $450.00 → incident ($2,450.00 − $2,000.00) → exact graph path → Sources DEMO DATA → +$600 → $0.00 / $150.00 margin SIMULATION ONLY → APPROVED FOR DEMO, executed externally never → incident still $450.00 → UI reset → seeded state, 3 alerts.
- QA: FAIL (README setup could not seed; stale scripts table) → README rewritten → accuracy fixes (FS-18/19 described as not implemented; KPI link claim; demo:setup re-run caveat; "potential interruption") → PASS.
- Limitations: see README "Known limitations" (unauthenticated demo identities, LAN Host spoofing unless start:local, frozen-clock snoozes, DAILY funds, not-found HTTP 200, repository-level immutability).
- Commit: 2790251

## FS-20 — 2026-11-04
- Status: PASS
- Implemented: backend (10ed651) — Alert model via additive migration 20261104091245_alerts; one alert per material transition (CREATED risky-only, ESCALATED, DEESCALATED, RECLASSIFIED, RESOLVED, REOPENED) recorded in materializeIncidents' transaction; idempotent (T-13 preserved); demo-gated audited ack/snooze bounded by the demo clock; "In-app only: no external notification sent", no Slack/email/webhook code. UI (d25aef4) — top-bar bell with active count, modal drawer (Active/History, counts, snooze hint, demo identity), per-alert kind/severity/source/owner/link, ack and 1/3/7-day snooze from the server clock.
- Commands: alerts tests 14; full chain lint/typecheck/test(649)/build/e2e(78/78) exit 0 (QA).
- QA: backend PASS with 1 Medium (silent reopen) → fixed → PASS; UI PASS.
- Limitations: snoozes do not expire under the frozen demo clock (UI explains); copy nit "a UNKNOWN unknown data incident".
- Commit: 10ed651, d25aef4

## FS-19 — 2026-11-04
- Status: PASS (AI OFF mode; live model calls BLOCKED — no LLM key)
- Implemented: AI off unless LLM_API_KEY + LLM_MODEL; suggester "ai" without them → 503 AI_OFF, zero network calls. Prompt: taxonomy-matched findings only (omittedFindings counted), strict semver versions, URL credentials stripped, bounded. Strict output schema with grounding (HALLUCINATED_SOURCE, TOKEN_NOT_IN_TAXONOMY, PROVIDER_TOKEN_MISMATCH, UNKNOWN_NODE, PROVIDER_VENDOR_MISMATCH). Accepted → SUGGESTED edges with MODEL_SUGGESTED evidence, confirmable only via FS-08 review. AI_ERROR → explicitly labeled rules fallback, redacted errors. Fetch-based OpenAI-style caller, mocked only.
- Commands: llm/ai/manifest tests; pnpm test 649; e2e 78/78 (QA); fetch stubbed → 0 calls without key.
- QA: FAIL (git-URL credentials in versions; twilio/express pinned to CloudComms) → FAIL (secret-shaped names, prerelease tags) → PASS.
- Limitations: never exercised against a real model endpoint; in AI mode, rules matches the model omits are not suggested (documented); "AI OFF" badge UI pending.
- Commit: fe6e55a

## FS-18 backend — 2026-11-04
- Status: backend PASS; task OPEN (UI label pending); live sandbox sync BLOCKED — no credentials
- Implemented: sandbox-only base URL; read scopes only, never vault; GET-only to allow-listed paths + token POST; foreign/vault page.next blocked; PAN/CVV payloads refused; sync only in an empty RAMP_SANDBOX workspace (pnpm ramp:init --confirm), DEMO → 409; state=ALL + state=DECLINED; unknowns null; SUGGESTED BACKS/PAYS; idempotent; PARTIAL/FAILED honest (FAILED → 502); no demo fallback; not configured → 503 with zero fetches. Ramp endpoint details confirmed from docs.ramp.com text mirrors (cited in code); cursor param name and /cards/virtual unconfirmed (failure → PARTIAL).
- Commands: ramp-adapter tests; QA recording-fetch probes (exactly token POST + 5 GETs; no writes).
- QA: PASS with 1 Medium (non-sandbox host labeled sandbox) → sandbox-only fix → PASS.
- Docs note: Ramp documents a `transactions.declined` webhook (contrary to the blueprint's caution); out of scope — polling used.
- Commit: bf18d61

## FS-18 / FS-19 UI — 2026-11-04
- Status: PASS
- Implemented: /sources Integrations panel from public status APIs — "Ramp sandbox: Not connected" with missing variable names (never values), "READ-ONLY RAMP SANDBOX" + host + last sync when configured, sync button only when syncAllowed (never in DEMO); "AI OFF: no LLM key configured. Showing rules-based suggestions."; RAMP_SANDBOX workspace chip reads "READ-ONLY RAMP SANDBOX".
- QA: three server configs (no keys / keys + DEMO / RAMP_SANDBOX via ramp:init on a scratch copy); secret values absent from HTML and APIs; e2e 80/80. PASS. Low queued: empty RAMP_SANDBOX ledger copy still suggests db:seed.
- Commit: b257c94
- FS-18 overall: BLOCKED — live sandbox read untested (no credentials); mocked-API verification only; documented in README.

## FS-21 — 2026-11-04
- Status: PASS
- Implemented: write gate → same-origin CSRF guard → 16 KiB stream-capped JSON body on all 11 POST routes; boundaries unit test over every "use client" import graph; generic 500s across all API families; redactSecrets/logServerError in API and scripts; GET smoke suite on a seeded temp DB; `pnpm verify`; check:provenance runs before every e2e build.
- Commands (QA): `pnpm verify` exit 0 (681 tests; check:provenance zero problems); `pnpm build && pnpm test:e2e` 80/80 (first attempt interrupted by host sleep, re-run under caffeinate); curl probes: cross-origin/port-mismatch/null-origin/cross-site → 403, no-Origin → gate only, 17 KB body with and without Content-Length → 400, broken DB → generic 500 with secret-free logs.
- QA: PASS. Lows queued: X-Forwarded-Host trusted without a proxy flag (CSRF still holds for browsers); README lacks a write-route auth table.
- Commit: 2099af7
