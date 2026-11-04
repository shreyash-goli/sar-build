# FailSafe — Demo Script (≈2 minutes)

> **Prototype, fictional data.** FailSafe is not an official Ramp product. Northstar Labs and every
> vendor (CloudComms, WebhookWorks, ComputeHarbor, MetricsRelay) are invented. Nothing in the demo
> reads or changes real funds, cards or Ramp data. Simulated actions are labeled `SIMULATION ONLY`.

## Before you present

```bash
pnpm install
cp .env.example .env          # DEMO_MODE=true, fixed demo clock 2026-11-17T16:00:00Z
pnpm demo:setup               # migrate + seed Northstar Labs
pnpm build && pnpm start:local   # http://127.0.0.1:3000 (loopback only)
```

If you rehearsed already, click **Reset demo** in the sidebar footer (or run `pnpm demo:reset`) so
the run starts from the seeded state. Every number below comes from that state; the automated
golden path (`tests/e2e/hero.spec.ts`) asserts the same values.

## Script

| Time | Screen | Do | Say |
| --- | --- | --- | --- |
| 0:00 | Overview `/dashboard` | Point at **Potential shortfall $450.00** and the CloudComms exposure (Critical, due in 2 days). | "Finance sees a $450 funding gap. Engineering sees a login dependency. They usually don't see each other's data." |
| 0:15 | Incident (click the CloudComms exposure) | Scroll through *Where the number comes from*. | "Expected charge $2,450.00 against $2,000.00 available on the Auth Infrastructure fund: max(0, 2,450 − 2,000) = $450, due in two days. Every input cites its source." |
| 0:30 | Same page | Point at the caveat block and the confirmed chain. | "This is *potential* interruption of Account login — we don't claim the vendor will suspend service. The chain is fund → card → CloudComms → OTP gateway → Account login, with checkout degraded." |
| 0:40 | Dependency graph (*Show this exact path on the graph*) | Click the **CloudComms → OTP gateway** edge. | "Click any edge and you see *why it exists*: the evidence, its method, timestamps, and that it's demo data. Dashed edges are suggestions and never count until a human reviews them." |
| 0:55 | Sources (*Open in Sources*) | Show the DEMO DATA badge and a derived rule record's lineage. | "Every assertion is traceable: synthetic, observed, derived or suggested — and the risk rule that produced it." |
| 1:05 | Response Studio (*Open Response Studio*) | Choose **Increase available allocation**, enter **600**, Run. | "Model a fix before touching anything real: +$600 takes available from $2,000 to $2,600, the shortfall to $0.00, with $150.00 margin. Critical becomes Low. Simulation only." |
| 1:20 | Same page, Approval panel | Propose (rationale), Submit, then Approve **as a different demo identity**. | "A second person approves it. The audit trail records every step — and *Executed externally: Never*. No Ramp funds changed." |
| 1:35 | Back to the incident | Show it still reads $450.00. | "The real data is untouched; we changed a simulated plan, not a card limit." |
| 1:40 | Incidents → WebhookWorks | Open the observed decline. | "Here's an *observed* transaction decline — evidence of a declined payment, explicitly not a confirmed outage." |
| 1:50 | Alerts bell | Open it briefly. | "Alerts fire on material risk changes, in-app only — nothing is emailed or sent." |
| 1:55 | — | — | "Ramp provides the spend controls. FailSafe gives those controls operational context." |

## Impact hypothesis (unmeasured)

Northstar's Account login depends on CloudComms SMS one-time passcodes; checkout depends on
login. *If* the $2,450 CloudComms charge were declined *and* the vendor then suspended OTP
delivery, customers could not complete login verification and checkout would degrade. FailSafe
surfaces that exposure about two days before the charge is due, with the exact chain and the
owners to contact. We claim no downtime, revenue or cost figures: there is no outcomes data, and a
declined payment does not prove a vendor will suspend service.

## Grounded answers to likely questions

- **Does a declined card take down a service?** Not necessarily. FailSafe separates the observed
  payment event from the unverified consequence and says so on every incident.
- **Where does AI help?** Optionally, mapping manifest references to known vendors — off by
  default (`AI OFF`), grounded in the built-in provider list, and every suggestion stays
  unconfirmed until a human reviews it. Core math and risk paths are deterministic.
- **Can it change Ramp funds?** No. The MVP never calls a Ramp write endpoint. The optional
  read-only sandbox adapter is implemented but was verified only against a mocked API (no
  sandbox credentials were available).
- **What would real Ramp integration require?**
  1. Ramp sandbox OAuth client credentials (`RAMP_CLIENT_ID` / `RAMP_CLIENT_SECRET`) with only
     the read scopes `transactions:read`, `cards:read`, `funds:read`.
  2. `pnpm ramp:init --confirm`, then a live sandbox sync to verify the field mapping (and the
     PAN/CVV key scan) against real payloads — not yet done.
  3. A source for real available allocation and vendor billing method: Ramp does not provide the
     business dependency graph, so these stay *unknown* until mapped.
  4. Human review of the imported fund → card → vendor links, which arrive as suggestions.
  5. Optionally, the documented `transactions.declined` webhook (a public HTTPS endpoint with
     signature verification); today declines are detected by polling.
  6. Out of scope and requiring Ramp approval: production access, any write endpoint, and
     authenticated user identities (demo identities are typed in today).
- **How do you know the graph is right?** You don't have to trust it: every edge shows its evidence
  and review status, and only confirmed edges count toward blast radius.

## Fallbacks

- If anything looks off, click **Reset demo** and restart from the Overview.
- The automated golden path is the reference run: `pnpm test:e2e` (see README).
