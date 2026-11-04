# FAILSAFE
## Autonomous Build Blueprint, Feature Provenance, and Hackathon Demo Plan

**Version:** 1.0 | **Prepared:** November 3, 2026 | **Project:** FailSafe | **Mode:** Agent-loop-ready implementation from an empty repository

> **North star:** Detect when a payment issue could put a critical business workflow at risk, explain the *operational blast radius* through a source-backed dependency graph, and let a human approve a practical mitigation before an outage occurs.
>
> **Winning demo:** A finance event triggers a visible path `Ramp fund → payment instrument → vendor → technical service → customer workflow`. The app predicts a shortfall, explains its evidence, generates a mitigation plan, simulates the fix, and shows the risk disappear without pretending it actually changed a live card.

**Product position:** *“PagerDuty for financial dependencies.”* FailSafe is a **prototype**, not an official Ramp product, and the demo must clearly distinguish simulated inputs, third-party observations, forecasts, and verified Ramp data. Never imply a declined payment automatically means a vendor has suspended service.

---

# 0. How to execute this document with a coding agent

This document is both a product specification and an ordered task queue. Each task is deliberately scoped to one demonstrable outcome. Work through tasks `FS-00` onward. **MVP gate: FS-00 through FS-17.** Complete `FS-18` through `FS-23` only after the MVP demo path works end to end. A task's dependency is a hard gate; never fake its acceptance checks.

## One-time setup

1. Create a fresh repository named `failsafe` and place this document at `docs/BUILD_BLUEPRINT.md`.
2. Start a coding agent in the repository root. Give it the **agent operating prompt** below and say: **“Implement the first unchecked task in docs/BUILD_BLUEPRINT.md. Do not start a second task.”**
3. After each task, run the stated checks, inspect the result, and mark it `[x]` only when verified. Record implementation evidence in `docs/PROGRESS.md`.
4. Repeat the same instruction to the agent in successive runs. If using an automated agent loop, each invocation must reload this file and `docs/PROGRESS.md` from disk rather than relying on prior chat context.
5. Once the MVP passes, record the actual UI and demo in a 90-second to 2-minute screen recording. Use the pitch script near the end of this document.

### Agent operating prompt (paste into an autonomous coding agent)

```text
You are the lead engineer implementing FailSafe in an existing local repository.
Before each work cycle:
1. Read docs/BUILD_BLUEPRINT.md, docs/PROGRESS.md, and relevant code/tests.
2. Find the FIRST unchecked task whose dependencies are complete.
3. Implement only that task, including tests and documentation changes.
4. Follow the system architecture, evidence contract, guardrails, and demo behavior.
5. Run the task's acceptance commands plus pnpm lint, pnpm typecheck, and pnpm test.
6. If checks pass, check off its task in docs/BUILD_BLUEPRINT.md, append factual
   evidence to docs/PROGRESS.md, and make one descriptive git commit.
7. If checks fail, fix issues within scope. If blocked, document the exact blocker
   and the smallest reproducible failure. Do NOT mark the task complete.
8. Conclude with: task ID, files modified, commands run, test results,
   remaining risks, and next task ID.

Rules:
- Never claim functionality is implemented when it is stubbed.
- Do not create fake production data or live Ramp integrations.
- Do not request or expose card PAN, CVV, tokens, or real company credentials.
- Never call a Ramp write endpoint in this project.
- All demo actions must be deterministic and reversible.
- No graph edge, risk assertion, or mitigation may exist without provenance.
- LLM output is an untrusted suggestion, not a verified business fact.
- Never silently fall back from a failed real integration to a mock.
- Keep the app runnable with zero external API keys in DEMO mode.
- Do not scope-creep into payments processing, purchasing, or billing execution.
```

### Standard result appended to `docs/PROGRESS.md`

```md
## FS-XX — 2026-11-03
- Status: PASS / BLOCKED
- Implemented: <concise factual summary>
- Files: <exact paths>
- Source inputs: <official docs / fixtures / verified user mappings>
- Commands: <exact commands and pass/fail>
- UX evidence: <route tested and what was observed>
- Limitations: <known gaps>
- Commit: <hash or "not committed">
- Next: FS-YY
```

**Loop rule:** No task may be marked `[x]` for a screenshot alone. A passing build is insufficient if the behavior, tests, and provenance specified in that task are not present.

---

# 1. Product definition and boundaries

## The specific problem

Many companies pay for software and infrastructure through card-backed arrangements, but finance data and operational dependencies live in separate systems. A payment decline, depleted spend-control fund, card issue, or unexpected vendor charge may create operational exposure. Finance knows about payments; engineering knows which services power customer workflows. **FailSafe links those two worlds before a preventable disruption.**

**Initial buyer:** Finance operations / controller at a software company, working with engineering or IT.  
**Daily user:** Finance admin, with engineering owners reviewing critical dependencies.  
**Trigger:** An observed declined card transaction, or a *projected* upcoming charge exceeding a known available allocation.  
**Action:** Explain exposure, notify an owner, prepare an approval-based remediation, and track resolution.  
**Non-goal:** Guarantee that payment failure causes an outage, autonomously change live budgets, or claim calibrated probabilities without outcomes data.

## Three differentiators to emphasize to judges

1. **Financial-to-technical dependency graph:** Show exactly how a vendor payment issue propagates to infrastructure and a customer-facing workflow.
2. **Source-backed reasoning:** Click any risk or graph edge to see *where the assertion came from*, including whether it is verified, inferred, or fictional demo data.
3. **Counterfactual recovery:** Compare “do nothing” with a specific mitigation (for example, a reviewed limit increase or verified alternate payment route) and show how the modeled exposure changes.

## Golden-path story

A fictional company, **Northstar Labs**, depends on an SMS provider for login codes. In the demo, a fund has **$2,000** available and the next assumed card-billed vendor charge is **$2,450** in **two days**. FailSafe detects a **$450 shortfall**, traces the provider to the login/checkout workflow, and raises an at-risk alert. The user opens the incident, sees the source evidence, proposes increasing the available budget by **$600**, gets a **simulated finance approval**, runs the counterfactual, and sees the forecast shortfall disappear. This demonstrates modeled risk mitigation, **not proof of averted downtime or a real Ramp card update**.

A separate scenario contains an **observed declined transaction** from synthetic transaction data to demonstrate incident classification rather than just forecasting.

## Must-have / should-have / cut

| Priority | Deliverable | Why |
| --- | --- | --- |
| P0 | Fully working deterministic demo with no keys | Judges can actually interact with the product |
| P0 | Payment-to-workflow graph | Visually memorable differentiator |
| P0 | Risk calculation, traceable sources, incident detail | Real technical substance |
| P0 | What-if simulator and approval-gated remediation | Real action, not a static dashboard |
| P0 | Reset demo, empty/errors/loading states, tests | Reliable live presentation |
| P1 | Repo manifest scan (non-secret sample) | Auto-discovery / AI-relevant engineering story |
| P1 | Read-only Ramp sandbox adapter | Strong fit with Ramp if access exists |
| P1 | AI-assisted edge proposal (behind flag) | Helps with nontrivial mapping, keeps truthfulness |
| P2 | Slack/email delivery, auth/multitenancy, commercial deployment | Not necessary to prove the idea |
| CUT | Auto-charge cards, live funds write, PCI card details | Unsafe/unnecessary for a hackathon |

---

# 2. Architecture and stack

### Chosen stack

- **Next.js App Router + TypeScript** for UI and server API routes.
- **Tailwind CSS + shadcn/ui + Lucide** for clean, fast, credible UI.
- **React Flow (`@xyflow/react`)** for the dependency graph; use dagre or deterministic manual positioning.
- **Recharts** for spend versus charge forecasts.
- **Prisma + SQLite** for zero-credential local demo, with persistent SQLite storage on a single-instance deployment; do not deploy an ephemeral database and assume it persists.
- **Zod** for validating every imported payload and server action.
- **Vitest** for pure-engine tests; **Playwright** for an end-to-end demo test.
- Optional: **OpenAI-compatible LLM API** for *edge suggestions and explanations only*. Everything must still work without the key.
- Optional: **Ramp Developer API sandbox** for read-only ingest if credentials are available.

**Why not an LLM-first architecture?** The risk arithmetic and graph reachability are deterministic. AI is useful for identifying potential links between a vendor and a service, but those links must be reviewed and supported by evidence before being treated as confirmed.

### Logical architecture

```text
Ramp read-only connector (optional)      Local fixtures / sample CSV / repo manifests
               |                                      |
               v                                      v
         Provider adapters  ----------->  Zod normalization layer
                                                |
                                                v
                                 SQLite entities + EvidenceRecords
                                                |
                     +--------------------------+----------------------+
                     |                          |                      |
                     v                          v                      v
               Dependency graph           Risk/forecast engine   Scenario engine
                     |                          |                      |
                     +--------------------------+----------------------+
                                                |
                                                v
                                 Server API / server actions
                                                |
                    +---------------------------+------------------+
                    |                           |                  |
                    v                           v                  v
                Dashboard                Graph + evidence     Response studio
                                                |
                                                v
                                  Human review + audit log
```

### Project structure to converge on

```text
failsafe/
├─ docs/
│  ├─ BUILD_BLUEPRINT.md      # this document
│  ├─ PROGRESS.md             # factual build journal
│  ├─ FEATURE_PROVENANCE.md   # machine-readable-in-spirit feature inventory
│  ├─ DEMO_SCRIPT.md
│  └─ ARCHITECTURE.md
├─ prisma/
│  ├─ schema.prisma
│  └─ seed.ts
├─ src/
│  ├─ app/
│  │  ├─ (app)/dashboard/page.tsx
│  │  ├─ (app)/graph/page.tsx
│  │  ├─ (app)/incidents/[id]/page.tsx
│  │  ├─ (app)/scenarios/page.tsx
│  │  ├─ (app)/sources/page.tsx
│  │  ├─ api/{dashboard,graph,incidents,scenarios,actions,imports}/...
│  │  └─ layout.tsx
│  ├─ components/{layout,ui,graph,risks,evidence,simulator}/...
│  ├─ lib/
│  │  ├─ db.ts
│  │  ├─ schema/          # Zod external/internal schemas
│  │  ├─ providers/       # DemoProvider; RampReadOnlyProvider
│  │  ├─ graph/           # lineage, traversal, blast radius
│  │  ├─ forecast/        # projected charges and shortfalls
│  │  ├─ risk/            # priority rules and explanations
│  │  ├─ simulations/     # counterfactual evaluation
│  │  ├─ provenance/      # evidence contracts
│  │  ├─ actions/         # proposals and audit events
│  │  └─ time.ts          # injectable demo clock
│  └─ fixtures/
│     ├─ northstar-demo.json
│     ├─ sample-repo/
│     └─ optional-imports/
├─ tests/{unit,integration,e2e}/...
├─ scripts/{reset-demo,check-provenance}.ts
├─ .env.example
└─ README.md
```

### Core domain model

Implement database tables/models with UUID IDs and stable typed status enums. Put all monetary values in integer **minor units** (`amountCents` for USD-only demo); format to dollars **only at rendering boundaries**. Times are timezone-aware ISO timestamps; use `getNow()` to inject the demo clock. Never add two periods of spend without checking period semantics.

| Model | Essential fields | Meaning |
| --- | --- | --- |
| `Workspace` | id, name, mode (`DEMO`, `RAMP_SANDBOX`, `RAMP_LIVE_READONLY`) | One tenant for the prototype |
| `FundingSource` | id, provider, externalFundId?, name, interval, limitCents?, availableCents?, observedAt, evidenceId | A Ramp fund or demonstrative budget; availability may be unknown |
| `PaymentInstrument` | id, kind, externalCardId?, fundingSourceId?, status, evidenceId | Card metadata only. No PAN/CVV |
| `Vendor` | id, name, normalizedKey, billingMethod, evidenceId | Vendor can be card-billed, invoiced, or unknown |
| `VendorCharge` | id, vendorId, fundingSourceId?, expectedAt, expectedCents?, status, sourceClass, evidenceId | Scheduled/forecast charge. Only card-billed charges enter card-limit calculations |
| `Transaction` | id, providerEventId?, vendorId, fundingSourceId?, occurredAt, amountCents, state, reason?, evidenceId | Cleared or declined; idempotent ingest |
| `Node` | id, kind, label, criticality, owner?, evidenceId | Fund/card/vendor/service/workflow/outcome |
| `Edge` | id, fromNodeId, toNodeId, relation, confidenceTier, reviewStatus, evidenceId | Directed, source-backed relationship |
| `EvidenceRecord` | id, kind, sourceSystem, sourceId, capturedAt, observedAt?, excerpt?, path?, contentHash?, classification, verificationStatus | Explains why a record/edge/risk exists |
| `Incident` | id, scenarioKey?, status, severity, title, firstSeenAt, updatedAt, primaryVendorId?, detectionRule, snapshotJson, evidenceId | Materialized issue with explanation |
| `Simulation` | id, incidentId, patchJson, beforeJson, afterJson, createdAt, createdBy, isDemo | Counterfactual, never a real payment action |
| `ActionProposal` | id, incidentId, kind, payloadJson, state, approver?, simulated, createdAt | Proposed response, requires approval |
| `AuditEvent` | id, actor, action, subjectId, detailsJson, at | Immutable operational log |

Foreign keys and uniqueness matter. Add unique constraints for source IDs and ingestion event keys; do not use display names as canonical IDs. Define enums in the actual code rather than trusting prose.

### Graph semantics

Edges go in the **impact direction** (upstream financial condition to downstream operation):

`FundingSource → PaymentInstrument → Vendor → Service → Workflow → CustomerOutcome`

Use relation labels such as `BACKS`, `PAYS`, `POWERS`, `REQUIRES`, `AFFECTS`. A workflow may depend on multiple services; not every edge means hard failure. Add `dependencyStrength` (`HARD`, `DEGRADED`, `OPTIONAL`) and `reviewStatus` (`CONFIRMED`, `SUGGESTED`, `REJECTED`). Reachability must ignore `REJECTED`; show `SUGGESTED` links as dashed and **do not count them as confirmed blast radius**. Deduplicate cycles and never traverse indefinitely. Record path IDs so users can click exact causal chains.

### API contract (internal)

| Method / route | Purpose | Contract notes |
| --- | --- | --- |
| `GET /api/dashboard` | Summary metrics and top risks | Source status + last evaluated time |
| `GET /api/graph` | Nodes and edges | Includes evidence references |
| `GET /api/incidents` | Sort/filter incidents | Severity, status, provenance |
| `GET /api/incidents/:id` | Full incident and impact paths | Missing evidence shown as unknown |
| `POST /api/scenarios/run` | Evaluate hypothetical patch | Validated input, no mutation of real budgets |
| `POST /api/actions/propose` | Create mitigation request | Requires incident, typed payload |
| `POST /api/actions/:id/approve` | Record simulated approval | Cannot silently change live funds |
| `POST /api/demo/reset` | Restore seeded demo | Allowed only if `DEMO_MODE=true` and authorized locally |
| `POST /api/imports/manifest` | Parse sample manifest text/file | Never execute uploaded content |
| `POST /api/integrations/ramp/sync` | Read-only sync | Returns explicit error if not configured |

Return typed `{ data, meta }` or `{ error: { code, message, details? } }`. Use 400 for bad inputs, 404 for nonexistent IDs, 409 for invalid workflow transitions, and 500 for true errors. Never leak raw tokens or stack traces to the browser.

---

# 3. Seeded scenario, reproducibility, and design

## Demo dataset (ALL FICTIONAL)

**Demo clock:** `2026-11-17T16:00:00Z`. Use this on both server and UI when DEMO_MODE is true. The seed must be idempotent.

### Scenario A — Projected shortage (hero demo)

- Workspace: `Northstar Labs`.
- FundingSource `fund-auth`: total limit `400000` cents, observed/assumed available `200000` cents ($2,000). Source: `DEMO_FIXTURE`.
- Instrument `card-auth`: virtual-card **metadata only**, funded by `fund-auth`.
- Vendor `CloudComms`: fictional SMS vendor. Charge `245000` cents ($2,450) expected `2026-11-19T16:00:00Z`, explicitly marked as sample billing configuration.
- Flow: `fund-auth → card-auth → CloudComms → OTP gateway → Account login → Customer checkout`.
- Relationship to checkout is **DEGRADED** (not all checkouts necessarily depend on login). All scenario dependencies are explicitly `CONFIRMED` **within the synthetic demo**, not as facts about a real company.
- Calculation: `245000 - 200000 = 45000` cents, $450 projected shortfall.
- Mitigation: a **simulated** +$600 allocation increase makes projected available `260000` cents and removes the modeled $450 shortfall, leaving a $150 modeled margin.

### Scenario B — Observed decline

- `WebhookWorks`: fictional API status-monitoring vendor.
- One sample transaction has `state=DECLINED`, source `DEMO_FIXTURE`, and `reason='SPEND_LIMIT'` as local demo terminology (do not present this local reason as a verified Ramp enum).
- Graph path leads to `Incident monitoring → On-call escalation`; impact is **potential** pending vendor service status confirmation.

### Scenario C — Healthy service

- `ComputeHarbor`: fictional cloud host, sufficient funding, confirmed application dependency. Show as **healthy** in the graph and dashboard so not everything is alarming.

### Scenario D — Unknown data

- `MetricsRelay`: billing method not verified and funding source unavailable. Render **Unknown / Needs mapping**, not a fabricated high or low risk.

## Design direction

Use a dark navy/charcoal command-center UI with restrained lime/cyan accents. Do not copy Ramp's UI or use Ramp marks without permission. The visual hero should be the interactive **risk graph**, not a generic SaaS KPI grid.

Required UX:

- Slim left sidebar: **Overview, Dependency Graph, Incidents, Response Studio, Sources**.
- Top bar with `DEMO DATA` / `RAMP SANDBOX` / `READ-ONLY` chip; source freshness timestamp.
- Main overview: three small trustworthy metrics: **At-risk workflows**, **Unresolved payment exposures**, **Potential shortfall**. Metrics must match dataset counts and carry definitions.
- Graph: horizontal layers, highlighted risk paths, zoom/pan, fit-to-view, crisp labels, hover, and click-to-inspect provenance.
- Incident drawer: reason, values used, source label, operational paths, recommended response, owner, uncertainty.
- Response Studio: before/after, approval step, audit timeline, explicit `SIMULATION ONLY` label.
- Must be mobile-tolerant, keyboard accessible, legible without excessive animation, with polished empty/loading/error states.

### Golden live-demo sequence

1. Open dashboard and say: “Finance sees a $450 funding shortfall; engineering sees a login dependency. They usually don't see each other's data.”
2. Click the alert → graph animates a highlighted financial-to-operational path.
3. Click the financial and infrastructure edges → show where each comes from, including synthetic and verified labels.
4. Switch to Response Studio → propose +$600 as a **simulated change**.
5. Approve in the demo → run before/after simulation → projected shortfall disappears, audit trail persists.
6. Trigger the observed-decline sample and contrast **actual transaction evidence** with **uncertain downstream service impact**.
7. End with: “Ramp provides the spend controls. FailSafe gives those controls operational context.”

---

# 4. Full feature provenance and traceability

**Interpretation of 'feature provenance':** Every feature below records (a) the problem claim, (b) what supports it, (c) any assumption, (d) the implementation unit, and (e) the test that proves it exists. Runtime *data provenance* is tracked separately in `EvidenceRecord`.

### Provenance status vocabulary

- `RAMP_DOCUMENTED`: Capability explicitly described in public official docs; implementation still needs testing.
- `PRODUCT_HYPOTHESIS`: A proposed feature or problem mechanism, not claimed to already exist at Ramp.
- `DEMO_FIXTURE`: Created solely for this demonstration, not live business evidence.
- `USER_VERIFIED`: Human has reviewed an imported relationship or owner mapping.
- `EXTERNAL_OBSERVED`: Third-party data with identifiable origin and capture timestamp.
- `MODEL_SUGGESTED`: LLM-generated hypothesis, not a fact until verified.
- `DERIVED`: Calculated from cited inputs and a versioned deterministic rule.

### Feature inventory

| ID | Feature | Why it exists / provenance | Implementation task | Proof of completion |
| --- | --- | --- | --- | --- |
| FP-01 | Distinct demo/read-only source modes | Product trust requirement; `PRODUCT_HYPOTHESIS` | FS-01, FS-02 | UI labels mode; cannot silently mix |
| FP-02 | Normalized Ramp fund/card/transaction model | Ramp Cards and Spend Controls docs; `RAMP_DOCUMENTED` | FS-03, FS-18 | fixture mapper tests; no card secrets |
| FP-03 | Deterministic Northstar workspace | Synthetic example; `DEMO_FIXTURE` | FS-04 | reset produces same IDs/counts |
| FP-04 | Interactive financial dependency graph | Core product innovation; `PRODUCT_HYPOTHESIS` | FS-06, FS-07 | click path + screenshot + unit test |
| FP-05 | Provenance drawer for nodes/edges | Needed to justify graph inferences; `PRODUCT_HYPOTHESIS` | FS-05, FS-08 | each displayed edge has evidence |
| FP-06 | CSV/sample manifest discovery | Repo integration hypothesis; content can be `EXTERNAL_OBSERVED` | FS-09 | sample import creates suggestions, not facts |
| FP-07 | Charge forecast | Vendor schedules may be manually configured; `DEMO_FIXTURE` / `DERIVED` | FS-10 | $2,450 and date traced to inputs |
| FP-08 | Funding shortage detection | Ramp fund concepts; formula is `DERIVED` | FS-11 | $450 shortfall exact in cents |
| FP-09 | Observed decline classification | Ramp Transactions API `state=ALL`; `RAMP_DOCUMENTED` | FS-11, FS-18 | mock declined event recognized |
| FP-10 | Blast-radius ranking | Proposed graph traversal; `DERIVED` | FS-06, FS-11 | impact paths ranked, not overclaimed |
| FP-11 | Executive overview | Product UX hypothesis | FS-12 | totals derive from DB, no hardcoding |
| FP-12 | Incident evidence & uncertainty | Safety/usability hypothesis | FS-13 | status explains *forecast* vs *observed* |
| FP-13 | Mitigation what-if simulation | Product innovation; `DERIVED` | FS-14 | +$600 makes shortage zero in preview only |
| FP-14 | Human approval and audit timeline | Safety and trust requirement | FS-15 | proposal → approve; real funds untouched |
| FP-15 | Actionable runbook | Operator workflow hypothesis | FS-16 | owner/steps rendered, copyable |
| FP-16 | End-to-end reproducible demo | Hackathon product requirement | FS-17, FS-21 | full Playwright hero path passes |
| FP-17 | Ramp read-only sandbox sync | Official API docs; `RAMP_DOCUMENTED` | FS-18 | sandbox sync only if credentials exist |
| FP-18 | AI mapping proposal | Optional product hypothesis; `MODEL_SUGGESTED` | FS-19 | cannot enter confirmed graph unreviewed |
| FP-19 | Explicit alerts and event timeline | Proposed internal alerting behavior | FS-20 | alerts arise on transitions, no fake sends |
| FP-20 | Deployment, instrumentation, pitch | Shipping and demo requirements | FS-21–FS-23 | accessible live link / clear video |

### Runtime provenance contract

Every UI assertion must have an inspectable chain:

```json
{
  "assertionId": "risk-auth-20261117",
  "claim": "Projected $450 funding shortfall for CloudComms",
  "status": "DERIVED",
  "ruleId": "projected-shortfall-v1",
  "inputs": ["evidence:fund-auth-availability", "evidence:charge-cloudcomms-20261119"],
  "evaluatedAt": "2026-11-17T16:00:00Z",
  "amountCents": 45000,
  "limitations": ["Synthetic payment assumptions", "Actual vendor suspension is unknown"]
}
```

- Each imported document/event has `sourceSystem`, original ID/path, hash where practical, source timestamp, ingest timestamp, and verification status.
- Each graph edge retains its own evidence record. Do not infer causation from matching text alone.
- Each risk names a versioned rule, cites immutable input IDs, and records evaluation time.
- Synthetic example evidence must be tagged `DEMO_FIXTURE` **even when marked confirmed in the fictional workspace**.
- Derived assertions must never upgrade an unverified dependency to verified.
- Store user actions as `AuditEvent`; record the difference between **proposed**, **approved in demo**, and **executed externally**. This MVP never executes externally.
- Include source freshness and `UNKNOWN` fields rather than replacing missing values with zeros.

### Official Ramp documentation consulted (not endorsements)

1. Developer quickstart and sandbox credentials: https://docs.ramp.com/developer-api/v1/guides/getting-started
2. Cards model and funds relationship: https://docs.ramp.com/developer-api/v1/cards-and-funds
3. Spend Controls and funds: https://docs.ramp.com/developer-api/v1/spend-controls
4. Transactions API, including `state=ALL` for declined transactions: https://docs.ramp.com/developer-api/v1/api/transactions
5. Authorization and scopes: https://docs.ramp.com/developer-api/v1/scopes
6. Developer docs index and webhooks conventions: https://docs.ramp.com/

**Important integration reality:** A documented `transactions.cleared` webhook is not evidence that a real-time decline webhook exists. Do not build a critical demo dependency on an unverified decline event. For the optional Ramp connector, fetch declined transactions through an explicit `state=ALL` read as documented, obey pagination, and label detection freshness. Ramp does not supply the *business dependency graph* for you. Future charges, card billing methods, vendor suspension rules, and remaining available allocation need independent evidence/confirmation; **the API adapter must represent unverified or unavailable fields as unknown**. No API scope in this document authorizes live fund writes.

---

# 5. Deterministic risk, graph, and response logic

## Charge projection

Only score a payment exposure as a *fund shortfall* when all of these are known: the vendor uses the relevant card/fund, the forecast charge amount, the charge date, available allocation within the same relevant period, and any known funding restrictions that make comparison valid. Otherwise return `UNKNOWN_DATA` with requested mappings.

For the hero demo, data comes from the synthetic scheduled charge, not AI prediction. For optional historical recurrence:

1. Group prior cleared charges by stable vendor ID **and funding source**; reject refunds/reversals, outliers only with an explicit recorded rule.
2. Require >=3 verified recurring historical charges before creating a model-suggested recurring schedule; do not silently infer payment method.
3. Use median positive minor-unit charge as a simple point estimate. Represent uncertainty and source dates, do not claim statistical calibration.
4. If cadence is irregular or the next date cannot be inferred reliably, return `UNKNOWN` and allow a user to configure a reviewed scheduled charge.
5. Avoid pretending a whole billing cycle's available amount is always current card balance; available allocation is an input with provenance.

`shortfallCents = max(0, expectedChargeCents - knownAvailableCents)` only after these validation gates. Comparisons involving `null` return **unknown**, never zero.

## Risk classifier v1

- `CRITICAL`: confirmed observed decline **or** verified projected shortfall in <=3 days, and the **confirmed** dependency graph reaches a `CRITICAL` workflow. This is *potential interruption risk*, not vendor suspension proof.
- `HIGH`: verified projected shortfall in <=7 days with a confirmed `HIGH`/`CRITICAL` workflow, unless already critical.
- `MEDIUM`: verified shortfall in <=14 days with at least one confirmed operational path.
- `LOW`: known valid inputs with no projected shortfall and no observed decline in the scoring window.
- `UNKNOWN`: missing funding/payment/dependency/forecast evidence; cannot be categorized accurately.

All risk events must have a reason array (`riskRuleId`, threshold, amount, days until, confirmed impacted paths). Distinguish **severity** from **confidence**: a high-impact path inferred by AI can be `UNKNOWN` pending review rather than high-confidence `CRITICAL`.

## Graph blast-radius algorithm

Given a financial starting node, BFS/DFS over directed `CONFIRMED` edges only, with visited set and cycle guard. Collect all paths ending in `Workflow` and `CustomerOutcome` nodes. Each path includes its edge IDs and source evidence IDs. Sort by workflow criticality then path length, deterministically. Use suggestion edges for a separate **Possible impacts** panel only. No claim that all reachable services will fail.

## Simulation semantics

- `SimulationPatch` has allowed kinds: `INCREASE_AVAILABLE_ALLOCATION`, `ASSIGN_ALTERNATE_FUND`, `MARK_CHARGE_RESCHEDULED`, `MARK_DEPENDENCY_VERIFIED`.
- Validate target IDs, positive amounts, no negative balances, and feasibility constraints; do not allow an arbitrary client-provided risk score.
- The simulator clones a normalized snapshot in memory, applies the patch, recomputes the **same** risk engine, and emits `before`, `after`, `changedInputs`, `assumptions`, `ruleVersion`.
- Save the resulting simulation record; **do not mutate the original funds or transactions**.
- In the MVP, approval transitions only a *simulated plan* to `APPROVED_FOR_DEMO`. The UI must not say money moved or a card limit was raised in Ramp.

---

# 6. Task queue: execute in exact order

## Phase A — Foundation and truthful data

### [x] FS-00 — Initialize the runnable repository
**Depends on:** nothing.  
**Build:** Create Next.js TypeScript App Router app with Tailwind, ESLint, pnpm. Add `typecheck`, `test`, `test:e2e`, `db:seed`, `demo:reset`, `check:provenance` script slots. Install shadcn/ui, Lucide, Prisma SQLite, Zod, React Flow, Recharts, Vitest, Playwright. Add `.env.example` (`DATABASE_URL=file:./dev.db`, `DEMO_MODE=true`, `DEMO_NOW=2026-11-17T16:00:00Z`, optional Ramp vars, optional `LLM_API_KEY`). Add README setup and `docs/PROGRESS.md` starter.  
**Files:** `package.json`, config files, `.env.example`, `README.md`, `docs/PROGRESS.md`.  
**Done when:** App launches with a visible `FailSafe / Demo` starter screen; standard scripts exist and no keys are required.  
**Verify:** `pnpm install && pnpm lint && pnpm typecheck && pnpm build`.

### [x] FS-01 — Establish design system and navigation
**Depends on:** FS-00.  
**Build:** Responsive app shell, navigation, mode chip, theme, generic page headers, skeletons, notification/toast, consistent spacing and typography. Ensure keyboard focus and color contrast. Make routes load for Overview, Graph, Incidents, Response Studio, Sources. No placeholder pretend charts.  
**Files:** `src/app/(app)/**`, `src/components/layout/**`, `src/app/globals.css`.  
**Done when:** Every route loads and visually belongs to the same premium product; empty states explicitly say there is no data.  
**Verify:** `pnpm build`; manually test keyboard tab navigation and narrow viewport.

### [x] FS-02 — Implement provenance and data-contract types
**Depends on:** FS-00.  
**Build:** Typed Zod schemas for source types, evidence records, financial objects, graph nodes/edges, risk outputs and simulation patches. Centralize display of `DEMO_FIXTURE`, `RAMP_SANDBOX`, `EXTERNAL_OBSERVED`, `MODEL_SUGGESTED`, `DERIVED`, `UNKNOWN`. Add strict null handling for missing values.  
**Files:** `src/lib/schema/**`, `src/lib/provenance/**`, `tests/unit/provenance.test.ts`.  
**Done when:** An imported edge without an evidence reference fails validation; unknown money is not coerced to zero; simulated data gets explicit badges.  
**Verify:** `pnpm test -- provenance`.

### [x] FS-03 — Create persistent normalized database
**Depends on:** FS-02.  
**Build:** Implement the domain models from Section 2 with Prisma; migrations, DB singleton, uniqueness constraints, and typed repository helpers. Protect write routes behind server-side demo mode or minimal admin gate, not a hidden frontend control.  
**Files:** `prisma/schema.prisma`, `src/lib/db.ts`, `src/lib/repositories/**`, migration files.  
**Done when:** CRUD round trips work and immutable evidence/audit records cannot be casually overwritten by generic update helper paths.  
**Verify:** `pnpm prisma validate` (or `pnpm exec prisma validate`), `pnpm exec prisma migrate dev`, repository tests.

### [x] FS-04 — Seed Northstar Labs with exact golden-path values
**Depends on:** FS-03.  
**Build:** Implement scenarios A–D, graph nodes, source/evidence records, and deterministic fixed demo clock. Seed/reset operations must be idempotent and transactional; reset must clear simulated proposals/incidents and regenerate them through actual logic, not precompute false results. Write fixture consistency tests.  
**Files:** `src/fixtures/northstar-demo.json`, `prisma/seed.ts`, `scripts/reset-demo.ts`, `src/lib/time.ts`, tests.  
**Done when:** Two resets yield the same logical IDs, amounts, edge counts and provenance; hero charge is 245000 cents and available is 200000 cents.  
**Verify:** `pnpm db:seed && pnpm demo:reset && pnpm test -- fixtures`.

### [x] FS-05 — Build evidence ledger and source inspector
**Depends on:** FS-04.  
**Build:** Backend functions that resolve any node/edge/charge/incident to its evidence; Sources page listing evidence class, source ID, original excerpt/path, timestamp, review status, and rule lineage. Add user-readable definitions for synthetic versus observed versus derived.  
**Files:** `src/lib/provenance/**`, `src/app/(app)/sources/page.tsx`, `src/components/evidence/**`.  
**Done when:** Click a source to see exactly what assertion it supports and whether it is demo/mock or verified. Never display a source as `RAMP_DOCUMENTED` when it is just an internal assumption.  
**Verify:** unit test asserting every seeded edge resolves to evidence; manually inspect Sources page.

## Phase B — The novel graph and deterministic intelligence

### [x] FS-06 — Implement graph algorithms as pure functions
**Depends on:** FS-05.  
**Build:** Directed traversal, cycle protection, confirmed-only reachability, graph path reconstruction, sorted impacted workflows, and separate suggested-path output. Handle nodes with no outgoing edges and multi-path dependencies.  
**Files:** `src/lib/graph/traverse.ts`, `src/lib/graph/impact.ts`, `tests/unit/graph.test.ts`.  
**Done when:** `fund-auth` reaches login and checkout using precise path IDs; rejected and suggested edges are excluded from confirmed blast radius.  
**Verify:** unit tests for linear graph, branching graph, cycle, orphan, suggested edge, rejected edge.

### [x] FS-07 — Build the visually compelling dependency graph
**Depends on:** FS-06, FS-01.  
**Build:** React Flow canvas with card/fund/vendor/service/workflow node styles; horizontal layers, labels, icons, overview minimap/fit controls, search, zoom, filters, node click and highlighted end-to-end paths. Display solid confirmed edges, dashed suggested edges and muted healthy branches.  
**Files:** `src/app/(app)/graph/page.tsx`, `src/components/graph/**`, `src/app/api/graph/**`.  
**Done when:** Hero risk path is legible at 1440x900; clicking a vendor highlights every confirmed downstream workflow; healthy and unknown paths are visually distinct.  
**Verify:** manually exercise graph; add a Playwright screenshot/assertion for a selected path.

### [x] FS-08 — Graph provenance inspector and reviewer controls
**Depends on:** FS-07.  
**Build:** Node/edge details drawer showing evidence snippet, method (`MANUAL`, `MANIFEST`, `MODEL`), timestamps, and reviewer status. Allow a simulated/admin review action to confirm or reject *suggested* edges and audit it. Never invent evidence on confirmation; require a human justification.  
**Files:** `src/components/graph/inspector.tsx`, review API, tests.  
**Done when:** Clicking `CloudComms → OTP gateway` explains why the edge exists; review changes graph style and impact calculation.  
**Verify:** unit and UI test for confirm/reject transitions with audit events.

### [x] FS-09 — Add safe repository-manifest discovery
**Depends on:** FS-08.  
**Build:** Import static example `package.json` and optional `docker-compose.yml` / Terraform `.tf` text (do NOT execute); use safe parsers / bounded text extraction to suggest provider-service dependencies. Example: `twilio` npm dependency suggests a possible SMS integration, **not** proof it is production-critical or card-funded. Deduplicate, cap upload size, reject unsupported formats, prohibit arbitrary file-system paths/remote fetch.  
**Files:** `src/lib/providers/manifest-import.ts`, import API, `src/fixtures/sample-repo/**`, tests.  
**Done when:** Importing the included sample suggests an edge with `MODEL_SUGGESTED` or `MANIFEST_DETECTED` evidence; it doesn't affect confirmed risk until reviewed.  
**Verify:** parser fixture tests for known dependency, no dependency, malformed input, oversize input, duplication.

### [x] FS-10 — Build charge and available-fund projection logic
**Depends on:** FS-04.  
**Build:** Read normalized VendorCharge, FundingSource and Transaction objects; implement funding-method guardrails, date comparison against injected clock, known-available check, minor-unit arithmetic, and recurring-charge suggestions only where sufficiently evidenced. Render forecast sparkline for historical sample charges if desired.  
**Files:** `src/lib/forecast/**`, `tests/unit/forecast.test.ts`.  
**Done when:** Hero returns `expected=245000`, `available=200000`, `shortfall=45000`, `dueInDays=2` with source IDs. Scenario D returns `UNKNOWN` (not $0).  
**Verify:** unit tests for exact hero, missing available, unknown billing, negative/refund, wrong billing period, timezone edge.

### [x] FS-11 — Implement explainable risk engine and incident builder
**Depends on:** FS-06, FS-10.  
**Build:** Classify projected shortfalls and observed declines, compute reachable confirmed workflows, provide severity + confidence + reason codes, dedupe alerts by stable `incidentKey`, materialize incidents and evidence snapshots. Do not conflate observed decline with confirmed service outage.  
**Files:** `src/lib/risk/**`, `src/lib/incidents/**`, `tests/unit/risk.test.ts`.  
**Done when:** Hero returns $450 risk and relevant impact path, observed decline creates separate incident, healthy is low, missing-data case unknown. Reruns do not duplicate incidents.  
**Verify:** test each severity, no-duplicate rule, status classification, unsupported-edge exclusion.

## Phase C — Complete usable product

### [x] FS-12 — Ship executive Overview dashboard
**Depends on:** FS-11, FS-01.  
**Build:** Overview KPIs from DB, clear definitions, ranked upcoming payment exposures, tiny forecast visualization, top impacted workflows, source freshness, click-through to incident/graph. Source-mode chip must always be visible.  
**Files:** `src/app/(app)/dashboard/page.tsx`, `src/app/api/dashboard/**`, components/tests.  
**Done when:** Every number comes from engine results, not hardcoded JSX; changing a fixture and re-seeding changes the right totals.  
**Verify:** dashboard API tests and screenshot at desktop/mobile breakpoints.

### [x] FS-13 — Deliver investigator-grade incident detail
**Depends on:** FS-12, FS-08.  
**Build:** Incident list/search/filter; detail screen with timeline, exposure, precise calculation, dependency chain, possible impacts separately, evidence panel, confidence caveats, owner, and “Open Response Studio.” Include `FORECAST` vs `OBSERVED DECLINE` pill.  
**Files:** `src/app/(app)/incidents/**`, `src/components/risks/**`, incident API.  
**Done when:** A judge can independently reconstruct where $450 came from, and understand that no service has been shown to be suspended.  
**Verify:** UI test opening incident and reading source path, calculation, and caveat.

### [x] FS-14 — Build the counterfactual simulation engine + UI
**Depends on:** FS-11, FS-13.  
**Build:** `POST /api/scenarios/run` with Zod validation; use immutable cloned state; support `INCREASE_AVAILABLE_ALLOCATION` and `ASSIGN_ALTERNATE_FUND` at minimum. Add side-by-side before/after results and graph path highlighting. Log simulation, never mutate base funding values.  
**Files:** `src/lib/simulations/**`, `src/app/(app)/scenarios/page.tsx`, API, tests.  
**Done when:** +$600 adjustment changes available from $2,000 to modeled $2,600, shortfall from $450 to $0, and leaves base FundingSource unchanged. An invalid change returns 400.  
**Verify:** simulation unit tests, API integration test, click-through on UI.

### [x] FS-15 — Add approval-gated response actions and immutable audit trail
**Depends on:** FS-14.  
**Build:** Propose change, present rationale, require reviewer confirmation, transition `DRAFT → PENDING_APPROVAL → APPROVED_FOR_DEMO` or `REJECTED`, record every transition. Server enforces allowed transitions; duplicate approvals are idempotent. Show a bold `SIMULATION ONLY: No Ramp funds changed` message.  
**Files:** `src/lib/actions/**`, `src/app/api/actions/**`, audit timeline component/tests.  
**Done when:** No proposed action is shown as executed; after approval only the simulated plan changes; action history survives navigation.  
**Verify:** tests for invalid transition, missing approver, duplicate approval, audit coverage, unchanged funds.

### [x] FS-16 — Add practical response runbooks and ownership
**Depends on:** FS-15.  
**Build:** Rules-based runbook per risk type: confirm billing method, contact finance fund owner, request limit review, verify alternate payment route, contact service owner, monitor vendor billing/service state. Make runbook steps copyable. Do not claim that contacting a vendor or raising a budget is automatic.  
**Files:** `src/lib/actions/runbooks.ts`, incident and studio components, tests.  
**Done when:** Each hero incident has a specific checklist and next owner, with dependencies/unknowns shown.  
**Verify:** runbook mapping tests; manual happy-path copy.

### [x] FS-17 — Lock the complete no-credentials MVP demo
**Depends on:** FS-12–FS-16.  
**Build:** One-click reset on demo workspace, seed determinism, toast/error behavior, loading states, coherent dashboard-to-graph-to-studio navigation. Add Playwright full golden-path test. Ensure no blank/loading screen after first page.  
**Files:** `tests/e2e/hero.spec.ts`, reset API, README/demo docs.  
**Done when:** Fresh clone + setup runs the seeded product; automated browser reproduces shortfall → graph → evidence → response → simulated approval → $0 after-state → reset; all routes work with zero keys.  
**Verify:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`.

**STOP HERE IF ANY CORE DEMO BEHAVIOR IS BROKEN.** Optional integrations are worthless if the golden path isn't reliable.

## Phase D — Optional differentiation, integration, and polish

### [ ] FS-18 — Implement a read-only Ramp developer API adapter
**Depends on:** FS-17. **Optional: requires sandbox credentials and appropriate scopes.**  
**Build:** `RampReadOnlyProvider` using official sandbox base `https://demo-api.ramp.com`. Obtain access token server-side via client credentials. Read `/developer/v1/transactions?state=ALL` (explicitly including declines), and relevant fund/card metadata from currently documented endpoints with `transactions:read`, `funds:read`, `cards:read` when authorized. Handle cursor pagination, rate limiting, 401, partial failures, token caching/refresh, idempotent upsert. Normalize into the existing model and preserve original Ramp IDs and source timestamps. **Never request card PAN/CVV or perform writes.**  
**Files:** `src/lib/providers/ramp-readonly.ts`, `src/app/api/integrations/ramp/sync/**`, `tests/integration/ramp-adapter.test.ts`, `.env.example`.  
**Done when:** Mocked API tests pass; actual sandbox read succeeds only if credentials are present. The UI says `READ-ONLY RAMP SANDBOX` and tells the truth if a field is missing. If access is unavailable, mark this task BLOCKED/NOT IMPLEMENTED and keep demo mode fully functional.  
**Verify:** fake provider tests and, only with permission, manual sandbox read. **Never invent external success.**

### [ ] FS-19 — AI-assisted dependency discovery, explicitly reviewable
**Depends on:** FS-09, FS-17. **Optional: requires LLM API key.**  
**Build:** LLM takes curated, non-secret manifest snippets plus approved service taxonomy and returns strict JSON suggested edges with source references, an explanation and uncertainty. Validate Zod output; reject hallucinated symbols/paths; bound costs and prompt size; never send secrets or whole private repos. Every returned edge stays `SUGGESTED` until a human review. Provide deterministic rules-based fallback.  
**Files:** `src/lib/providers/llm-suggestions.ts`, tests with mocked model outputs.  
**Done when:** A genuine provider hint is explained with a verifiable file pointer and cannot silently become a confirmed edge. Missing key is clearly labeled `AI OFF`, not fake AI.  
**Verify:** valid/invalid/hallucinated JSON tests, no-key mode, reviewed transition.

### [ ] FS-20 — Intelligent alert center and event transition timeline
**Depends on:** FS-17.  
**Build:** On material change of risk classification, create one in-app alert with severity, source, owner, and deep link. Add notification drawer, ack/snooze in demo, and history. Do not send real Slack/email unless user explicitly configures a provider; never label internal notifications “sent” externally.  
**Files:** `src/lib/alerts/**`, components/tests.  
**Done when:** Same input evaluated twice produces one alert; a changed risk generates a new timeline entry; ack works.  
**Verify:** duplicate/reclassification tests and UI.

### [ ] FS-21 — Production-grade hardening and automated regression suite
**Depends on:** FS-17; include FS-18–FS-20 only if implemented.  
**Build:** Review auth of server writes, route protections, input limits, client/server secret separation, DB errors, HTTP error rendering, provenance completeness, logging redaction, sanitization, path/cycle bounds and accessibility. Add smoke tests and the provenance checker.  
**Files:** tests, middleware/auth utility, `scripts/check-provenance.ts`, docs.  
**Done when:** `pnpm check:provenance` finds zero dangling displayed assertions, and `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e` pass.  
**Verify:** run all commands; manually check a disconnected/unknown state and simulated error.

### [ ] FS-22 — Deploy a stable demo and prepare reproducible fallback
**Depends on:** FS-21.  
**Build:** Deploy a single-instance Node application with a persistent SQLite volume (for example, Railway) or migrate deliberately to hosted PostgreSQL with migration tests. Use required environment variables and startup DB migration/seed procedure. Ensure resetting demo does not reset other users' real data. Put a **local video fallback** and screenshots in the final presentation folder, not secrets.  
**Files:** deployment config, `README.md`, `docs/DEPLOYMENT.md`.  
**Done when:** A fresh browser on a different machine can load the demo, navigate to the graph, run the scenario, and see reset working. If persistent DB cannot be guaranteed, use an isolated read-only public demo and local recorded/live fallback; document this tradeoff.  
**Verify:** external-browser smoke test, refresh/persistence test, health route check.

### [ ] FS-23 — Judge-oriented pitch, provenance appendix, and final QA
**Depends on:** FS-17 at minimum; FS-22 if deployed.  
**Build:** Create two-minute recorded pitch, app walkthrough, sample data disclaimer, architecture one-pager, honest source list, and screenshot examples. Write a concise impact hypothesis rather than inventing downtime/cost savings. Ensure on-screen calculations match story.  
**Files:** `docs/DEMO_SCRIPT.md`, `docs/FEATURE_PROVENANCE.md`, final README/screenshots.  
**Done when:** Someone unfamiliar with the project understands what triggered the risk, why the affected workflow matters, how evidence is proven, how intervention was simulated, and what Ramp integration would require.  
**Verify:** rehearse the exact golden path from reset; watch the full recording; cross-check numbers with app output.

---

# 7. Test matrix and explicit correctness requirements

Tests below are **requirements**, not claims that tests are already implemented.

| ID | Scenario | Required expectation |
| --- | --- | --- |
| T-01 | Hero charge $2,450, availability $2,000 | $450 projected shortfall; exact `45000` cents |
| T-02 | Simulated +$600 allocation | Projected shortfall $0; remaining modeled margin $150 |
| T-03 | Simulation runs | Original fund records and transaction history unchanged |
| T-04 | Unknown availability | `UNKNOWN`, not `LOW` or $0 |
| T-05 | Unknown payment method | Cannot assert card limit causes exposure |
| T-06 | Declined synthetic transaction | Incident labeled observed *transaction decline*, not outage |
| T-07 | Suggested edge only | Absent from confirmed blast radius until review |
| T-08 | Rejected edge | Never in confirmed path |
| T-09 | Cyclic dependencies | Traversal terminates and returns stable deduplicated paths |
| T-10 | Multiple paths to same workflow | One workflow count, optional separate path count |
| T-11 | Negative transaction / refund | Excluded from positive recurring charge forecast |
| T-12 | Wrong interval or no due date | Unknown/unscored rather than confident bad math |
| T-13 | Repeated event import | Does not duplicate transactions/incidents |
| T-14 | No LLM key | No-key demo works; AI clearly disabled |
| T-15 | No Ramp credentials | No-key demo works; connector says not connected |
| T-16 | Attempt unauthorized server write | Rejected; no DB changes |
| T-17 | Invalid source pointer | Provenance check fails instead of faking evidence |
| T-18 | Approve twice | Idempotent/no duplicate audit actions |
| T-19 | Forbidden action transition | Returns HTTP 409 with useful error |
| T-20 | Reset demo twice | Same logical dataset and primary calculated outcomes |
| T-21 | Full browser demo | Shortfall → evidence → graph → proposal → simulated approval → before/after |
| T-22 | Live Ramp sync returns partial data | Missing fields remain null/unknown; no fabricated forecast |

**Quality bar:** no `any` in core financial logic, no floating-point currency arithmetic, no secret-bearing browser code, no claimed integrations that do not function, no untraceable data in hero UX, no red error overlays during demo.

---

# 8. Exact workflow for new coding-agent sessions

For each agent loop, execute this checklist:

```text
[ ] Read this entire spec's task queue and docs/PROGRESS.md
[ ] Inspect the specific files needed for the earliest eligible unchecked task
[ ] State the selected task ID and one-sentence goal in your own log
[ ] Implement that task without touching unrelated features
[ ] Add tests for new business logic and failure cases
[ ] Run task-specific verification
[ ] Run pnpm lint, pnpm typecheck, pnpm test; run pnpm build if UI/API changed
[ ] Fix failures or document the exact blocker
[ ] Record source/provenance changes and assumptions
[ ] Append observed evidence to docs/PROGRESS.md
[ ] Mark the task [x] only if its definition of done is true
[ ] Make a git commit, output exact completion summary, stop
```

### Handling blocked tasks

A missing API key must not stop core development. Record the optional task as `BLOCKED — credentials unavailable` in `docs/PROGRESS.md`; do not check its box, do not fabricate data, and move to tasks that don't depend on it. A broken core task, however, is a **stop sign** until repaired.

### Safe parallelization for a team of up to three

- **Engineer A (backend/core):** FS-02–FS-06, FS-10, FS-11, FS-14, FS-15.
- **Engineer B (frontend/UX):** FS-01, FS-07, FS-08, FS-12, FS-13, FS-16.
- **Engineer C (integrations/QA/story):** FS-04 fixtures, FS-05 provenance inspector support, FS-09, FS-17–FS-23.

Use feature branches and explicit API schema agreements. Never have two agents independently modify `schema.prisma` and a dependent API contract without coordination. A single-agent loop should follow the exact linear order above rather than trying to parallelize everything.

---

# 9. Pitch positioning and evaluation criteria

## 30-second pitch

> “An engineering team knows which vendors power production. Finance knows which cards and spend limits pay those vendors. But when a payment fails, those two maps don't connect. FailSafe builds that missing financial dependency graph. It uses Ramp spend and funding data alongside verified service relationships to spot payment exposure, show which customer workflows *could* be impacted, and let teams simulate a fix before making a real change. Here's a $450 risk to customer login that a finance dashboard alone wouldn't explain.”

## Why judges might care

- **Real organizational pain:** Different teams own payments and service reliability; even a small operational dependency can be important.
- **Direct Ramp relevance:** The core uses the concepts of cards, funds, spend controls, declined transactions, and API integration.
- **Technical depth:** Multi-source normalization, typed evidence lineage, dependency graph traversal, deterministic risk scoring, scenario replay, and human approvals.
- **Visible payoff:** A clickable before/after graph is considerably more convincing than an LLM chat window.
- **Trustworthiness:** You can demonstrate exactly what the product knows, suspects, and cannot infer.

## Questions judges will ask, with grounded answers

**“Does a declined card actually take down a service?”**  
Not necessarily. We model exposure, not guaranteed downtime; the app separates the observed payment event from the unverified vendor enforcement consequence.

**“Why is this a Ramp product?”**  
Ramp supplies spend, card, and fund context. FailSafe links that financial view to critical operational services and predicts consequences. It is a proposed extension, not a feature Ramp already offers.

**“Why not just set a bigger card limit?”**  
Because the issue is *which* limit needs attention, how urgent it is, and how the correct fix affects operations and controls. Raising every limit indiscriminately defeats the purpose of spend management.

**“Where does AI help?”**  
Optional AI turns infrastructure manifests and vendor descriptions into candidate mappings; humans verify those mappings. The core calculations and risk paths remain deterministic and explainable.

**“Can this actually change Ramp funds?”**  
Not in this MVP. The prototype prepares and simulates a human-approved action. The external write path would need explicit authorization, guardrails, and additional integration work.

## Scoring rubric before submission (each 0–5)

| Criterion | 5/5 means |
| --- | --- |
| Differentiation | A finance-to-operational impact graph, not a rebranded expense tracker |
| Reality | Explains exact financial condition, affected workflow, and limitations |
| Technical rigor | Tested graph traversal, source lineage, typed risk rules, clear unknowns |
| Visual wow | Demo path draws/highlights graph and visibly changes simulated risk |
| Reliability | Runs first try after reset; no credentials or network required |
| Ramp fit | Accurate funds/transactions model, honest API integration story |
| Finish | Short video, clear UI, zero broken buttons, docs and source appendix |

**Final hackathon rule:** One flawlessly demonstrated financial-to-operational failure chain is more persuasive than ten half-built AI features.

---

# 10. Definition of done for the entire project

The project is complete when:

- [ ] A clean clone can run with `DEMO_MODE=true` and no external credentials.
- [ ] Northstar fixture is reproducible and all four scenarios render correctly.
- [ ] All material facts and edges have source labels and inspectable evidence.
- [ ] Core graph traversal and exact money arithmetic pass tests.
- [ ] The $450 shortfall is traced to `$2,450 - $2,000`, both in cents internally.
- [ ] A +$600 simulated mitigation shows a $0 shortfall and $150 modeled margin.
- [ ] The product NEVER describes that simulation as a live fund or card update.
- [ ] Observed declines and projected shortages are visually distinct.
- [ ] Suggested inferred graph edges are not represented as confirmed truth.
- [ ] Risk screen always communicates “potential impact,” not guaranteed vendor shutdown.
- [ ] A visible demo-mode indicator remains on every screen.
- [ ] Dashboard, graph, incident, studio, sources, and reset all work.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` pass.
- [ ] README includes setup, architecture, data-source disclaimers, and actual limitations.
- [ ] Demo video shows a complete action, not just a rendered mockup.

---

## Current project state

**Specification authored; implementation has not yet been started.** All task boxes intentionally remain unchecked. The task list is an implementation contract, not a claim that code or integrations already exist.
