import { describe, expect, it } from "vitest";
import { loadNorthstarFixture } from "@/fixtures/northstar";
import {
  PROJECTED_SHORTFALL_RULE_ID,
  comparePeriods,
  daysUntil,
  projectCharge,
  projectCharges,
  suggestRecurringCharges,
  AVAILABILITY_STALE_AFTER_DAYS,
  PLAUSIBLE_UTC_OFFSETS_MINUTES,
  RECURRING_SUGGESTION_DISPLAY_LABEL,
  type ChargeProjection,
  type PriorCharge,
  type ProjectableCharge,
  type ScoredProjection,
  type UnknownProjection,
} from "@/lib/forecast";
import type { EvidenceRecord, FundingSource, Transaction, Vendor } from "@/lib/schema";
import { DEFAULT_DEMO_NOW, getNow } from "@/lib/time";

const fx = loadNorthstarFixture();
const NOW = getNow({ env: { DEMO_MODE: "true" } });
const fund = (id: string) => fx.fundingSources.find((f) => f.id === id)!;
const vendor = (id: string) => fx.vendors.find((v) => v.id === id)!;
const charge = (id: string) => fx.vendorCharges.find((c) => c.id === id)!;

const heroCharge = charge("charge-cloudcomms-20261119");
const heroFund = fund("fund-auth");
const heroVendor = vendor("vendor-cloudcomms");

const project = (overrides: {
  charge?: Partial<ProjectableCharge>;
  fund?: Partial<FundingSource> | null;
  vendor?: Partial<Vendor> | null;
  now?: Date;
  priorCharges?: PriorCharge[];
} = {}) =>
  projectCharge({
    charge: { ...heroCharge, ...overrides.charge },
    fund: overrides.fund === null ? null : { ...heroFund, ...overrides.fund },
    vendor: overrides.vendor === null ? null : { ...heroVendor, ...overrides.vendor },
    now: overrides.now ?? NOW,
    priorCharges: overrides.priorCharges,
  });

function scored(p: ChargeProjection): ScoredProjection {
  expect(p.status).toBe("SCORED");
  return p as ScoredProjection;
}
function unknown(p: ChargeProjection): UnknownProjection {
  expect(p.status).toBe("UNKNOWN_DATA");
  const u = p as UnknownProjection;
  expect(u.shortfallCents).toBeNull();
  return u;
}
const codes = (u: UnknownProjection) => u.requestedMappings.map((m) => m.code).sort();

const allProjections = () =>
  projectCharges({ charges: fx.vendorCharges, vendors: fx.vendors, fundingSources: fx.fundingSources, now: NOW });

describe("hero scenario A (T-01)", () => {
  it("expected 245000, available 200000, shortfall 45000, dueInDays 2, with source IDs", () => {
    expect(NOW.toISOString()).toBe("2026-11-17T16:00:00.000Z");
    const p = scored(allProjections().find((x) => x.chargeId === "charge-cloudcomms-20261119")!);
    expect(p).toMatchObject({
      ruleId: PROJECTED_SHORTFALL_RULE_ID,
      expectedCents: 245000,
      availableCents: 200000,
      committedBeforeCents: 0,
      effectiveAvailableCents: 200000,
      shortfallCents: 45000,
      marginCents: 0,
      hasShortfall: true,
      dueInDays: 2,
      expectedAt: "2026-11-19T16:00:00Z",
      evaluatedAt: DEFAULT_DEMO_NOW,
      fundingSourceId: "fund-auth",
      periodKeyUtc: "2026-11",
    });
    expect(p.ruleId).toBe("projected-shortfall-v1");
    expect(p.evidenceIds).toEqual(["ev-charge-cloudcomms-20261119", "ev-vendor-cloudcomms", "ev-fund-auth"]);
    expect(p.inputs).toEqual([
      "evidence:ev-charge-cloudcomms-20261119",
      "evidence:ev-vendor-cloudcomms",
      "evidence:ev-fund-auth",
    ]);
    expect(p.assumptions.length).toBeGreaterThan(0);
  });

  it("a +$600 allocation removes the shortfall and leaves a $150 margin (T-02 arithmetic)", () => {
    const p = scored(project({ fund: { availableCents: 260000 } }));
    expect(p).toMatchObject({ shortfallCents: 0, marginCents: 15000, hasShortfall: false });
  });

  it("does not mutate inputs and is deterministic", () => {
    const frozen = structuredClone(fx);
    const a = allProjections();
    const b = allProjections();
    expect(a).toEqual(b);
    expect(fx).toEqual(frozen);
  });
});

describe("scenarios C and D", () => {
  it("C: ComputeHarbor is scored with no shortfall (LOW-ready)", () => {
    const p = scored(allProjections().find((x) => x.chargeId === "charge-computeharbor-20261121")!);
    expect(p).toMatchObject({ expectedCents: 1180000, availableCents: 2200000, shortfallCents: 0, marginCents: 1020000, hasShortfall: false, dueInDays: 4 });
  });

  it("D: MetricsRelay is UNKNOWN_DATA (not $0) and asks for billing method and funding source", () => {
    const u = unknown(allProjections().find((x) => x.chargeId === "charge-metricsrelay-20261124")!);
    expect(codes(u)).toEqual(["BILLING_METHOD", "FUNDING_SOURCE"]);
    expect(u.expectedCents).toBe(36000);
    expect(u.availableCents).toBeNull();
    expect(u.dueInDays).toBe(7);
  });

  it("no unknown projection ever reports a numeric shortfall", () => {
    for (const p of allProjections()) if (p.status !== "SCORED") expect("shortfallCents" in p ? p.shortfallCents : null).toBeNull();
  });
});

describe("validation gates", () => {
  it("T-04: unknown availability -> UNKNOWN, not LOW or $0", () => {
    const u = unknown(project({ fund: { availableCents: null } }));
    expect(codes(u)).toEqual(["AVAILABLE_ALLOCATION"]);
    expect(u.expectedCents).toBe(245000);
    expect(u.availableCents).toBeNull();
  });

  it("T-05: unknown payment method cannot assert card-limit exposure", () => {
    expect(codes(unknown(project({ vendor: { billingMethod: "UNKNOWN" } })))).toEqual(["BILLING_METHOD"]);
  });

  it("invoice-billed vendors are not card exposure", () => {
    const p = project({ vendor: { billingMethod: "INVOICE" } });
    expect(p).toMatchObject({ status: "NOT_APPLICABLE", reason: "INVOICE_BILLED" });
  });

  it("missing vendor, funding source, or fund record", () => {
    expect(codes(unknown(project({ vendor: null })))).toEqual(["VENDOR"]);
    expect(codes(unknown(project({ charge: { fundingSourceId: null }, fund: null })))).toEqual(["FUNDING_SOURCE"]);
    expect(codes(unknown(project({ fund: null })))).toEqual(["FUNDING_SOURCE"]);
    expect(codes(unknown(project({ fund: { id: "fund-other" } })))).toEqual(["FUNDING_SOURCE"]);
  });

  it("unknown expected amount", () => {
    const u = unknown(project({ charge: { expectedCents: null } }));
    expect(codes(u)).toEqual(["EXPECTED_AMOUNT"]);
    expect(u.expectedCents).toBeNull();
  });

  it("T-12: no due date -> unscored", () => {
    const u = unknown(project({ charge: { expectedAt: null } }));
    expect(codes(u)).toEqual(["EXPECTED_DATE"]);
    expect(u.dueInDays).toBeNull();
    expect(codes(unknown(project({ charge: { expectedAt: "not-a-date" } })))).toEqual(["EXPECTED_DATE"]);
  });

  it("T-12: wrong billing period (charge in the next monthly period) -> unscored", () => {
    const u = unknown(project({ charge: { expectedAt: "2026-12-19T16:00:00Z" } }));
    expect(codes(u)).toEqual(["BILLING_PERIOD"]);
    expect(u.requestedMappings[0]!.message).toMatch(/2026-11.*2026-12/);
  });

  it("T-12: unknown interval -> unscored; interval semantics respected", () => {
    expect(codes(unknown(project({ fund: { interval: "UNKNOWN" } })))).toEqual(["BILLING_PERIOD"]);
    expect(codes(unknown(project({ fund: { interval: "DAILY" } })))).toEqual(["BILLING_PERIOD"]);
    expect(scored(project({ fund: { interval: "TOTAL" }, charge: { expectedAt: "2027-03-01T00:00:00Z" } })).shortfallCents).toBe(45000);
    expect(scored(project({ fund: { interval: "QUARTERLY" }, charge: { expectedAt: "2026-12-15T00:00:00Z" } })).periodKeyUtc).toBe("2026-Q4");
  });

  it("charge due dates in the past are not scored", () => {
    const u = unknown(project({ charge: { expectedAt: "2026-11-16T16:00:00Z" } }));
    expect(codes(u)).toEqual(["CHARGE_PAST_DUE"]);
    expect(u.dueInDays).toBe(-1);
  });

  it("settled charges are not projected", () => {
    for (const status of ["CLEARED", "DECLINED", "CANCELLED"] as const) {
      expect(project({ charge: { status } })).toMatchObject({ status: "NOT_APPLICABLE", reason: "CHARGE_SETTLED" });
    }
  });

  it("reports every missing input at once", () => {
    const u = unknown(project({ vendor: { billingMethod: "UNKNOWN" }, fund: { availableCents: null }, charge: { expectedCents: null } }));
    expect(codes(u)).toEqual(["AVAILABLE_ALLOCATION", "BILLING_METHOD", "EXPECTED_AMOUNT"]);
  });
});

describe("availability freshness", () => {
  it("availability dated after now -> UNKNOWN (AVAILABILITY_FROM_FUTURE)", () => {
    const u = unknown(project({ fund: { observedAt: "2026-11-17T16:00:01Z" } }));
    expect(codes(u)).toEqual(["AVAILABILITY_FROM_FUTURE"]);
  });

  it(`availability older than ${AVAILABILITY_STALE_AFTER_DAYS} days is scored but flagged stale`, () => {
    expect(AVAILABILITY_STALE_AFTER_DAYS).toBe(7);
    const fresh = scored(project());
    expect(fresh).toMatchObject({ availabilityAgeDays: 0, availabilityStale: false });
    expect(fresh.assumptions.some((a) => /freshness threshold/.test(a))).toBe(false);

    const sevenDays = scored(project({ fund: { observedAt: "2026-11-10T16:00:00Z" } }));
    expect(sevenDays).toMatchObject({ availabilityAgeDays: 7, availabilityStale: false });

    const stale = scored(project({ fund: { observedAt: "2026-11-09T15:00:00Z" } }));
    expect(stale).toMatchObject({ availabilityAgeDays: 8, availabilityStale: true, shortfallCents: 45000 });
    expect(stale.assumptions.some((a) => /8 days old \(freshness threshold 7 days\)/.test(a))).toBe(true);
  });
});

describe("timezone and day counting", () => {
  it("samples every 15-minute offset from -12:00 to +14:00", () => {
    expect(PLAUSIBLE_UTC_OFFSETS_MINUTES[0]).toBe(-720);
    expect(PLAUSIBLE_UTC_OFFSETS_MINUTES[PLAUSIBLE_UTC_OFFSETS_MINUTES.length - 1]).toBe(840);
    expect(PLAUSIBLE_UTC_OFFSETS_MINUTES).toContain(330); // +05:30
    expect(PLAUSIBLE_UTC_OFFSETS_MINUTES).toContain(345); // +05:45
    expect(PLAUSIBLE_UTC_OFFSETS_MINUTES).toHaveLength(105);
  });

  it("a half-hour-zone boundary is detected as ambiguous", () => {
    // 2026-11-30T18:45Z is Dec 1 00:15 at +05:30 but Nov 30 at whole-hour +05:00.
    expect(comparePeriods(new Date(heroFund.observedAt), new Date("2026-11-30T18:45:00Z"), "MONTHLY").status).toBe("AMBIGUOUS");
  });

  it("a charge at 23:59-05:00 on the last day of the month is ambiguous -> UNKNOWN", () => {
    // 2026-11-30T23:59-05:00 is 2026-12-01T04:59Z: November locally, December in UTC.
    const u = unknown(project({ charge: { expectedAt: "2026-11-30T23:59:00-05:00" } }));
    expect(codes(u)).toEqual(["BILLING_PERIOD"]);
    expect(u.requestedMappings[0]!.message).toMatch(/timezone/);
    expect(comparePeriods(new Date(heroFund.observedAt), new Date("2026-11-30T23:59:00-05:00"), "MONTHLY").status).toBe("AMBIGUOUS");
  });

  it("a charge at 23:59-05:00 safely inside the month is scored", () => {
    const p = scored(project({ charge: { expectedAt: "2026-11-29T23:59:00-05:00" } }));
    expect(p.expectedAt).toBe("2026-11-30T04:59:00Z");
    expect(p.dueInDays).toBe(12);
  });

  it("dueInDays counts whole 24h periods from the injected clock", () => {
    const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
    expect(daysUntil(NOW, at(0))).toBe(0);
    expect(daysUntil(NOW, at(23))).toBe(0);
    expect(daysUntil(NOW, at(47))).toBe(1);
    expect(daysUntil(NOW, at(48))).toBe(2);
    expect(daysUntil(NOW, at(-1))).toBe(-1);
    expect(scored(project({ now: new Date("2026-11-18T16:00:00+00:00") })).dueInDays).toBe(1);
  });

  it("a charge exactly at now is due today, not past due", () => {
    expect(scored(project({ charge: { expectedAt: DEFAULT_DEMO_NOW } })).dueInDays).toBe(0);
  });
});

describe("multiple charges on one fund", () => {
  const earlier: ProjectableCharge = { ...heroCharge, id: "charge-earlier", expectedAt: "2026-11-18T16:00:00Z", expectedCents: 150000, evidenceId: "ev-earlier" };

  it("earlier charges in the same period reduce availability first", () => {
    const [first, second] = projectCharges({ charges: [heroCharge, earlier], vendors: fx.vendors, fundingSources: fx.fundingSources, now: NOW });
    expect(scored(first!)).toMatchObject({ chargeId: "charge-earlier", shortfallCents: 0, marginCents: 50000 });
    const s = scored(second!);
    expect(s).toMatchObject({ chargeId: "charge-cloudcomms-20261119", committedBeforeCents: 150000, effectiveAvailableCents: 50000, shortfallCents: 195000, priorChargeIds: ["charge-earlier"] });
    expect(s.evidenceIds).toContain("ev-earlier");
  });

  it("an earlier charge with unknown amount makes the later one UNKNOWN", () => {
    const res = projectCharges({ charges: [heroCharge, { ...earlier, expectedCents: null }], vendors: fx.vendors, fundingSources: fx.fundingSources, now: NOW });
    expect(codes(unknown(res.find((r) => r.chargeId === heroCharge.id)!))).toEqual(["PRIOR_CHARGE_AMOUNT"]);
  });

  it("an earlier UNKNOWN-billed or vendor-less charge makes the later one UNKNOWN (no confident inflation)", () => {
    // QA repro: a 100000-cent MetricsRelay (UNKNOWN billing) charge on fund-auth on 11-18.
    const metrics: ProjectableCharge = { ...earlier, id: "c-metrics", vendorId: "vendor-metricsrelay", expectedCents: 100000 };
    const res = projectCharges({ charges: [heroCharge, metrics], vendors: fx.vendors, fundingSources: fx.fundingSources, now: NOW });
    const hero = unknown(res.find((r) => r.chargeId === heroCharge.id)!);
    expect(codes(hero)).toEqual(["PRIOR_CHARGE_BILLING"]);
    expect(hero.requestedMappings[0]!.message).toMatch(/c-metrics/);
    expect(hero.evidenceIds).toContain("ev-earlier");

    const ghost: ProjectableCharge = { ...earlier, id: "c-ghost", vendorId: "vendor-missing" };
    const res2 = projectCharges({ charges: [heroCharge, ghost], vendors: fx.vendors, fundingSources: fx.fundingSources, now: NOW });
    expect(codes(unknown(res2.find((r) => r.chargeId === heroCharge.id)!))).toEqual(["PRIOR_CHARGE_BILLING"]);

    // Direct projectCharge: INVOICE priors ignored, CARD deducted, null billing flagged.
    expect(scored(project({ priorCharges: [{ charge: earlier, billingMethod: "INVOICE" }] })).shortfallCents).toBe(45000);
    expect(scored(project({ priorCharges: [{ charge: earlier, billingMethod: "CARD" }] })).shortfallCents).toBe(195000);
    expect(codes(unknown(project({ priorCharges: [{ charge: earlier, billingMethod: null }] })))).toEqual(["PRIOR_CHARGE_BILLING"]);
  });

  it("an earlier INVOICE-billed charge on the fund is not deducted", () => {
    const vendors = [...fx.vendors, { ...heroVendor, id: "vendor-inv", normalizedKey: "inv", billingMethod: "INVOICE" as const }];
    const inv: ProjectableCharge = { ...earlier, id: "c-inv", vendorId: "vendor-inv" };
    const res = projectCharges({ charges: [heroCharge, inv], vendors, fundingSources: fx.fundingSources, now: NOW });
    expect(scored(res.find((r) => r.chargeId === heroCharge.id)!)).toMatchObject({ shortfallCents: 45000, priorChargeIds: [] });
  });

  it("charges in another period, past-due, settled or on other funds are not deducted", () => {
    const others: ProjectableCharge[] = [
      { ...earlier, id: "c-dec", expectedAt: "2026-12-02T16:00:00Z" },
      { ...earlier, id: "c-past", expectedAt: "2026-11-10T16:00:00Z" },
      { ...earlier, id: "c-cleared", status: "CLEARED" },
      { ...earlier, id: "c-other-fund", fundingSourceId: "fund-infra" },
    ];
    const res = projectCharges({ charges: [heroCharge, ...others], vendors: fx.vendors, fundingSources: fx.fundingSources, now: NOW });
    expect(scored(res.find((r) => r.chargeId === heroCharge.id)!)).toMatchObject({ committedBeforeCents: 0, shortfallCents: 45000, priorChargeIds: [] });
  });
});

describe("recurring-charge suggestions", () => {
  const tx = (id: string, occurredAt: string, amountCents: number, extra: Partial<Transaction> = {}): Transaction => ({
    id,
    providerEventId: `evt-${id}`,
    vendorId: "vendor-cloudcomms",
    fundingSourceId: "fund-auth",
    occurredAt,
    amountCents,
    state: "CLEARED",
    reason: null,
    evidenceId: `ev-${id}`,
    ...extra,
  });
  const evidenceFor = (txs: readonly Transaction[], overrides: Record<string, Partial<EvidenceRecord>> = {}) =>
    txs.map((t) => ({
      id: t.evidenceId,
      classification: "EXTERNAL_OBSERVED" as const,
      verificationStatus: "UNVERIFIED" as const,
      ...overrides[t.evidenceId],
    }));
  const monthly = [
    tx("t1", "2026-08-19T16:00:00Z", 231500),
    tx("t2", "2026-09-19T16:00:00Z", 245000),
    tx("t3", "2026-10-19T16:00:00Z", 240000),
  ];

  it("the seeded history is insufficient everywhere (no suggestion from 1 charge)", () => {
    const res = suggestRecurringCharges({ transactions: fx.transactions, evidence: fx.evidence, now: NOW });
    expect(res.every((r) => r.status === "UNKNOWN")).toBe(true);
    expect(res.find((r) => r.vendorId === "vendor-cloudcomms")).toMatchObject({ reason: "INSUFFICIENT_HISTORY", sampleSize: 1 });
    expect(res.find((r) => r.vendorId === "vendor-webhookworks")).toMatchObject({ reason: "INSUFFICIENT_HISTORY", sampleSize: 0 });
  });

  it(">= 3 regular cleared charges -> MODEL_SUGGESTED median with uncertainty", () => {
    const [r] = suggestRecurringCharges({ transactions: monthly, evidence: evidenceFor(monthly), now: NOW });
    expect(r).toMatchObject({
      status: "SUGGESTED",
      sourceClass: "MODEL_SUGGESTED",
      reviewStatus: "SUGGESTED",
      ruleId: "recurring-charge-suggestion-v1",
      cadence: "MONTHLY",
      sampleSize: 3,
      medianCents: 240000,
      uncertainty: { amountRangeCents: { min: 231500, max: 245000 } },
      lastOccurredAt: "2026-10-19T16:00:00Z",
      nextExpectedAt: "2026-11-19T16:00:00Z",
      evidenceIds: ["ev-t1", "ev-t2", "ev-t3"],
      displayLabel: RECURRING_SUGGESTION_DISPLAY_LABEL,
    });
    expect(RECURRING_SUGGESTION_DISPLAY_LABEL).toBe("Suggested from history (rule recurring-charge-suggestion-v1)");
  });

  it("only verified charges count: missing, REJECTED or MODEL_SUGGESTED evidence is excluded", () => {
    const four = [...monthly, tx("t4", "2026-07-19T16:00:00Z", 230000)];
    const cases: [Record<string, Partial<EvidenceRecord>>, string][] = [
      [{ "ev-t2": { verificationStatus: "REJECTED" } }, "evidence REJECTED"],
      [{ "ev-t2": { classification: "MODEL_SUGGESTED" } }, "evidence is MODEL_SUGGESTED (not an observed charge)"],
    ];
    for (const [overrides, reason] of cases) {
      const [r] = suggestRecurringCharges({ transactions: monthly, evidence: evidenceFor(monthly, overrides), now: NOW });
      expect(r).toMatchObject({ status: "UNKNOWN", reason: "INSUFFICIENT_HISTORY", sampleSize: 2 });
      expect(r!.excluded).toEqual([{ transactionId: "t2", reason }]);
    }
    const missing = suggestRecurringCharges({ transactions: monthly, evidence: evidenceFor(monthly).filter((e) => e.id !== "ev-t3"), now: NOW })[0]!;
    expect(missing.excluded).toEqual([{ transactionId: "t3", reason: "evidence ev-t3 not found" }]);
    // With a 4th verified charge the rejected one is simply dropped.
    const [ok] = suggestRecurringCharges({ transactions: four, evidence: evidenceFor(four, { "ev-t4": { verificationStatus: "REJECTED" } }), now: NOW });
    expect(ok).toMatchObject({ status: "SUGGESTED", sampleSize: 3, transactionIds: ["t1", "t2", "t3"] });
    expect(ok!.excluded).toEqual([{ transactionId: "t4", reason: "evidence REJECTED" }]);
  });

  it("stale history (next date already past) -> UNKNOWN, not rolled forward", () => {
    const old = [tx("o1", "2026-01-10T00:00:00Z", 1000), tx("o2", "2026-02-10T00:00:00Z", 1000), tx("o3", "2026-03-10T00:00:00Z", 1000)];
    const [r] = suggestRecurringCharges({ transactions: old, evidence: evidenceFor(old), now: NOW });
    expect(r).toMatchObject({ status: "UNKNOWN", reason: "STALE_HISTORY", sampleSize: 3 });
    expect(r!.status === "UNKNOWN" && r!.detail).toMatch(/2026-04-10T00:00:00Z/);
  });

  it("2 charges are not enough", () => {
    expect(suggestRecurringCharges({ transactions: monthly.slice(0, 2), evidence: evidenceFor(monthly.slice(0, 2)), now: NOW })[0]).toMatchObject({ status: "UNKNOWN", reason: "INSUFFICIENT_HISTORY" });
  });

  it("T-11: refunds, reversals, declines, pending and negatives are excluded", () => {
    const noisy = [
      ...monthly,
      tx("refund", "2026-10-20T16:00:00Z", -240000),
      tx("reversal", "2026-10-21T16:00:00Z", 240000, { state: "REVERSED" }),
      tx("declined", "2026-10-22T16:00:00Z", 999999, { state: "DECLINED" }),
      tx("pending", "2026-10-23T16:00:00Z", 999999, { state: "PENDING" }),
      tx("zero", "2026-10-24T16:00:00Z", 0),
    ];
    const [r] = suggestRecurringCharges({ transactions: noisy, evidence: evidenceFor(noisy), now: NOW });
    expect(r).toMatchObject({ status: "SUGGESTED", sampleSize: 3, medianCents: 240000, transactionIds: ["t1", "t2", "t3"] });
    expect(r!.excluded.map((e) => e.transactionId)).toEqual(["refund", "reversal", "declined", "pending", "zero"]);

    const twoPlusRefund = [...monthly.slice(0, 2), tx("r", "2026-10-19T16:00:00Z", -1000)];
    const [onlyTwo] = suggestRecurringCharges({ transactions: twoPlusRefund, evidence: evidenceFor(twoPlusRefund), now: NOW });
    expect(onlyTwo).toMatchObject({ status: "UNKNOWN", reason: "INSUFFICIENT_HISTORY", sampleSize: 2 });
  });

  it("irregular cadence -> UNKNOWN", () => {
    const irregular = [tx("a", "2026-08-01T00:00:00Z", 100), tx("b", "2026-08-11T00:00:00Z", 100), tx("c", "2026-09-25T00:00:00Z", 100)];
    expect(suggestRecurringCharges({ transactions: irregular, evidence: evidenceFor(irregular), now: NOW })[0]).toMatchObject({ status: "UNKNOWN", reason: "IRREGULAR_CADENCE" });
  });

  it("groups by vendor AND funding source; never infers a missing funding source", () => {
    const split = [
      ...monthly.slice(0, 2),
      tx("t3b", "2026-10-19T16:00:00Z", 240000, { fundingSourceId: "fund-infra" }),
      tx("u1", "2026-10-01T00:00:00Z", 5000, { fundingSourceId: null }),
    ];
    const res = suggestRecurringCharges({ transactions: split, evidence: evidenceFor(split), now: NOW });
    expect(res.map((r) => [r.fundingSourceId, r.status, r.status === "UNKNOWN" ? r.reason : null])).toEqual([
      [null, "UNKNOWN", "UNATTRIBUTED_FUNDING_SOURCE"],
      ["fund-auth", "UNKNOWN", "INSUFFICIENT_HISTORY"],
      ["fund-infra", "UNKNOWN", "INSUFFICIENT_HISTORY"],
    ]);
  });

  it("even-count median is integer (floor of the two middle values); month-end next date clamps", () => {
    const four = [
      tx("m1", "2026-10-31T00:00:00Z", 100),
      tx("m2", "2026-11-30T00:00:00Z", 101),
      tx("m3", "2026-12-31T00:00:00Z", 104),
      tx("m4", "2027-01-31T00:00:00Z", 105),
    ];
    const [r] = suggestRecurringCharges({ transactions: four, evidence: evidenceFor(four), now: new Date("2027-02-01T00:00:00Z") });
    expect(r).toMatchObject({ status: "SUGGESTED", medianCents: 102, nextExpectedAt: "2027-02-28T00:00:00Z" });
    expect(Number.isInteger(r!.status === "SUGGESTED" ? r!.medianCents : 0.5)).toBe(true);
  });

  it("ignores transactions after now", () => {
    const withFuture = [...monthly.slice(0, 2), tx("future", "2026-12-19T16:00:00Z", 240000)];
    const [r] = suggestRecurringCharges({ transactions: withFuture, evidence: evidenceFor(withFuture), now: NOW });
    expect(r).toMatchObject({ status: "UNKNOWN", reason: "INSUFFICIENT_HISTORY", sampleSize: 2 });
  });
});
