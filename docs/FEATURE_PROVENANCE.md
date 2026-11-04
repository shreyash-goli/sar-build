# Feature Provenance

Each feature records why it exists (provenance status per blueprint §4), the implementation
commit(s), and the test that proves it. Runtime *data* provenance (per-record evidence) is a
separate mechanism — see `EvidenceRecord` and `/sources`.

Status vocabulary: `RAMP_DOCUMENTED` (public Ramp docs; still tested here), `PRODUCT_HYPOTHESIS`,
`DEMO_FIXTURE`, `DERIVED`, `MODEL_SUGGESTED`, `EXTERNAL_OBSERVED`, `USER_VERIFIED`.

| ID | Feature | Provenance | Task(s) | Commit(s) | Proof |
| --- | --- | --- | --- | --- | --- |
| FP-01 | Distinct demo / read-only source modes | PRODUCT_HYPOTHESIS | FS-01, FS-02, FS-05, FS-18 UI | 647d66c, 10d2d07, 9de418d, 71cc33f, b257c94 | `tests/unit/shell-status.test.ts`, `tests/e2e/shell.spec.ts`, `tests/e2e/integrations.spec.ts` — chip derives from the stored workspace; never claims sandbox without a sandbox workspace |
| FP-02 | Normalized fund / card / transaction model (no card secrets) | RAMP_DOCUMENTED | FS-03, FS-18 | 6d82325, bf18d61 | `tests/unit/schema.test.ts` (PAN/CVV rejected), `tests/integration/repositories.test.ts`, `tests/integration/ramp-adapter.test.ts` (mocked API only) |
| FP-03 | Deterministic Northstar workspace | DEMO_FIXTURE | FS-04 | 0bd17d0 | `tests/integration/seed.test.ts` (two resets → identical snapshots; QA: byte-identical dumps) |
| FP-04 | Interactive financial dependency graph | PRODUCT_HYPOTHESIS | FS-06, FS-07 | 810eb35, 9c3c961 | `tests/unit/graph.test.ts`, `tests/unit/graph-model.test.ts`, `tests/e2e/graph.spec.ts` |
| FP-05 | Provenance inspector for nodes / edges | PRODUCT_HYPOTHESIS | FS-05, FS-08 | 71cc33f, a8e37ef, 4c69130 | `tests/integration/sources.test.ts` (every seeded record resolves to evidence), `tests/e2e/graph-review.spec.ts` |
| FP-06 | Manifest discovery (suggestions, not facts) | EXTERNAL_OBSERVED / DEMO_FIXTURE | FS-09 | c78e77d, e2959c9 | `tests/unit/manifest-import.test.ts`, `tests/integration/manifest-import-api.test.ts` (no confirmed-risk change until review) |
| FP-07 | Charge forecast | DEMO_FIXTURE / DERIVED | FS-10 | 911ce62 | `tests/unit/forecast.test.ts` ($2,450 due 2026-11-19 traced to inputs) |
| FP-08 | Funding shortage detection | DERIVED | FS-10, FS-11 | 911ce62, 9a0cf99 | `tests/unit/forecast.test.ts` (45000 cents exact), `tests/unit/risk.test.ts` |
| FP-09 | Observed decline classification | RAMP_DOCUMENTED (state=ALL) / DEMO_FIXTURE | FS-11, FS-18 | 9a0cf99, bf18d61 | `tests/unit/risk.test.ts` (separate OBSERVED_DECLINE, "not a confirmed outage"), `tests/integration/ramp-adapter.test.ts` |
| FP-10 | Blast-radius ranking | DERIVED | FS-06, FS-11 | 810eb35, 9a0cf99 | `tests/unit/graph.test.ts` (confirmed-only, suggested/rejected excluded) |
| FP-11 | Executive overview | PRODUCT_HYPOTHESIS | FS-12 | fecd3dd | `tests/integration/dashboard.test.ts` (fixture change moves totals), `tests/e2e/dashboard.spec.ts` |
| FP-12 | Incident evidence and uncertainty | PRODUCT_HYPOTHESIS | FS-13 | 6afda58 | `tests/integration/incidents-api.test.ts`, `tests/e2e/incidents.spec.ts` ($450 reconstructable; forecast vs observed) |
| FP-13 | What-if simulation | DERIVED | FS-14 | 90c9099, 83e38ee | `tests/unit/simulation.test.ts`, `tests/integration/scenarios-api.test.ts` (base data unchanged), `tests/e2e/scenarios.spec.ts` |
| FP-14 | Human approval and audit timeline | PRODUCT_HYPOTHESIS | FS-15 | f69c9d0, 83e38ee | `tests/integration/actions-api.test.ts` (T-18/T-19, funds unchanged), `tests/e2e/actions.spec.ts` |
| FP-15 | Actionable runbook | PRODUCT_HYPOTHESIS | FS-16 | d31ede2, 3bace82 | `tests/unit/runbooks.test.ts`, `tests/e2e/runbook.spec.ts` |
| FP-16 | End-to-end reproducible demo | PRODUCT_HYPOTHESIS | FS-17, FS-21 | 2790251, 2099af7 | `tests/e2e/hero.spec.ts` (T-21 golden path), full suite 80/80 |
| FP-17 | Ramp read-only sandbox sync | RAMP_DOCUMENTED | FS-18 | bf18d61, b257c94 | `tests/integration/ramp-adapter.test.ts` — **BLOCKED for live use: no sandbox credentials; mocked API only** |
| FP-18 | AI mapping proposal | MODEL_SUGGESTED | FS-19 | fe6e55a, f5bfb08 | `tests/unit/llm-suggestions.test.ts`, `tests/integration/ai-suggestions-api.test.ts` — AI OFF without a key; cannot enter the confirmed graph unreviewed |
| FP-19 | Alerts and event timeline | PRODUCT_HYPOTHESIS | FS-20 | 10ed651, d25aef4, 36d320a | `tests/integration/alerts.test.ts` (one alert per transition, reopen), `tests/e2e/alerts.spec.ts` — in-app only, nothing sent |
| FP-20 | Hardening, demo docs, pitch | PRODUCT_HYPOTHESIS | FS-21–FS-23 | 2099af7, the FS-23 docs commit | `tests/unit/boundaries.test.ts`, `tests/integration/smoke.test.ts`, `pnpm verify`; FS-22 deployment pending human approval |

## Official sources consulted (not endorsements)

- Ramp developer docs (getting started, authorization/scopes, rate limiting, webhooks, transactions),
  read via the docs.ramp.com plain-text mirrors; URLs are cited in `src/lib/providers/ramp/*`.
- Finding that differs from the blueprint's caution: Ramp documents a `transactions.declined`
  webhook. FailSafe still detects declines by polling with `state=ALL` plus `state=DECLINED`;
  webhooks are out of scope.

## What is *not* claimed

- No outcomes data: severities are rule-based, not calibrated probabilities.
- No live Ramp sandbox read, and no real model call, has been performed.
- No production deployment exists.
- No screenshots or demo recording are committed yet; recording the 90-second to 2-minute
  walkthrough (docs/DEMO_SCRIPT.md) is left to the presenter.
