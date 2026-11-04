# Progress

## Now
- FS-03 — persistent normalized database (@backend, in progress)
- FS-01 follow-up — shared provenance labels in mode chip, mobile freshness, invalid-clock label (@frontend, in progress)

## Next
- FS-04 seed (after FS-03) → FS-05 → FS-06; FS-10 after FS-04
- FS-07 needs FS-06 + FS-01; FS-12 needs FS-11 + FS-01

## Done
- FS-00 — runnable repository (commit c7ec96f)
- FS-01 — design system & navigation (commit 647d66c)
- FS-02 — provenance & data-contract types (commit 10d2d07)

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
