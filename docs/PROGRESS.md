# Progress

## Now
- FS-01 — design system & navigation (@frontend, in progress)
- FS-02 — provenance & data-contract types (@backend, in progress)

## Next
- FS-03 — persistent normalized database (after FS-02)
- FS-07 needs FS-06 + FS-01; FS-12 needs FS-11 + FS-01

## Done
- FS-00 — runnable repository (commit c7ec96f)

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
