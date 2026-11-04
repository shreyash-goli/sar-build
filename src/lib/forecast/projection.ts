/**
 * Charge projection (blueprint Section 5, FS-10). Pure and deterministic:
 * the clock is passed in (use getNow() at the call site).
 *
 * A charge is scored as a fund shortfall ONLY when every gate passes:
 *   1. charge is upcoming (SCHEDULED / FORECAST / RESCHEDULED) and not past due
 *   2. vendor is card-billed (billingMethod CARD); INVOICE is not card exposure
 *   3. charge names a funding source, and that fund is known
 *   4. expected amount is known
 *   5. expected date is known and parseable
 *   6. fund availability is known
 *   7. the charge falls in the SAME funding period as the availability reading,
 *      under every plausible workspace timezone
 *   8. the availability reading is not from the future (observedAt <= now)
 *   9. earlier upcoming charges on the same fund and period have known amounts
 *      and are known to be CARD-billed (an UNKNOWN-billed or vendor-less prior
 *      charge might consume the allocation, so the later charge is UNKNOWN)
 * Otherwise the result is UNKNOWN_DATA with requestedMappings. Never $0.
 * Availability older than AVAILABILITY_STALE_AFTER_DAYS is still scored, but
 * flagged (`availabilityStale`) and called out in `assumptions`.
 *
 * shortfallCents = max(0, expected - max(0, available - earlierCommitted)).
 */
import {
  compareCents,
  fromNullableCents,
  knownCents,
  shortfallCents as shortfallOf,
  subtractCents,
  addCents,
  formatCents,
  type FundingSource,
  type Money,
  type Vendor,
  type VendorCharge,
} from "@/lib/schema";
import { comparePeriods, daysUntil, type PeriodComparison } from "./period";

export const PROJECTED_SHORTFALL_RULE_ID = "projected-shortfall-v1";

/** Availability readings older than this are flagged as stale (scored, with a caveat). */
export const AVAILABILITY_STALE_AFTER_DAYS = 7;

/** VendorCharge as it may arrive from partial sources: the due date can be missing. */
export type ProjectableCharge = Omit<VendorCharge, "expectedAt"> & { expectedAt: string | null };

export type RequestedMappingCode =
  | "BILLING_METHOD"
  | "VENDOR"
  | "FUNDING_SOURCE"
  | "EXPECTED_AMOUNT"
  | "EXPECTED_DATE"
  | "AVAILABLE_ALLOCATION"
  | "BILLING_PERIOD"
  | "PRIOR_CHARGE_AMOUNT"
  | "PRIOR_CHARGE_BILLING"
  | "AVAILABILITY_FROM_FUTURE"
  | "CHARGE_PAST_DUE";

export type RequestedMapping = { code: RequestedMappingCode; message: string };

type Common = {
  ruleId: typeof PROJECTED_SHORTFALL_RULE_ID;
  chargeId: string;
  vendorId: string;
  fundingSourceId: string | null;
  evaluatedAt: string;
  /** Evidence IDs of every input actually consulted (charge, vendor, fund, earlier charges). */
  evidenceIds: string[];
  /** Same, as typed references for RiskAssertion.inputs ("evidence:<id>"). */
  inputs: string[];
  /** fund.observedAt of the availability reading used (null when no matching fund). */
  availabilityObservedAt: string | null;
};

export type ScoredProjection = Common & {
  status: "SCORED";
  expectedCents: number;
  /** Fund availability as read (before earlier commitments). */
  availableCents: number;
  /** Sum of earlier upcoming charges on the same fund and period. */
  committedBeforeCents: number;
  /** max(0, available - committedBefore). */
  effectiveAvailableCents: number;
  shortfallCents: number;
  /** max(0, effectiveAvailable - expected): modeled margin after the charge. */
  marginCents: number;
  hasShortfall: boolean;
  expectedAt: string;
  dueInDays: number;
  periodKeyUtc: string;
  priorChargeIds: string[];
  /** Whole days between the availability reading and now. */
  availabilityAgeDays: number;
  /** True when availabilityAgeDays > AVAILABILITY_STALE_AFTER_DAYS. */
  availabilityStale: boolean;
  assumptions: string[];
};

export type UnknownProjection = Common & {
  status: "UNKNOWN_DATA";
  /** Known inputs are still reported; unknowns stay null (never 0). */
  expectedCents: number | null;
  availableCents: number | null;
  shortfallCents: null;
  expectedAt: string | null;
  dueInDays: number | null;
  requestedMappings: RequestedMapping[];
};

export type NotApplicableProjection = Common & {
  status: "NOT_APPLICABLE";
  reason: "INVOICE_BILLED" | "CHARGE_SETTLED";
  detail: string;
};

export type ChargeProjection = ScoredProjection | UnknownProjection | NotApplicableProjection;

/** An earlier upcoming charge on the same fund, with its vendor's billing method (null: vendor missing). */
export type PriorCharge = { charge: ProjectableCharge; billingMethod: Vendor["billingMethod"] | null };

export type ProjectChargeInput = {
  charge: ProjectableCharge;
  vendor: Vendor | null;
  /** The fund named by charge.fundingSourceId (null if unknown/missing). */
  fund: FundingSource | null;
  now: Date;
  /**
   * Earlier upcoming charges on the same fund and period (projectCharges computes this).
   * INVOICE-billed priors are ignored; CARD priors are deducted; UNKNOWN-billed or
   * vendor-less priors make the result UNKNOWN_DATA (PRIOR_CHARGE_BILLING).
   */
  priorCharges?: readonly PriorCharge[];
};

const UPCOMING = new Set<VendorCharge["status"]>(["SCHEDULED", "FORECAST", "RESCHEDULED"]);

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");

function parseDate(value: string | null): Date | null {
  if (value === null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function uniq(xs: readonly string[]): string[] {
  return [...new Set(xs)];
}

export function projectCharge({ charge, vendor, fund, now, priorCharges = [] }: ProjectChargeInput): ChargeProjection {
  const evidenceIds = uniq([
    charge.evidenceId,
    ...(vendor ? [vendor.evidenceId] : []),
    ...(fund ? [fund.evidenceId] : []),
  ]);
  const common = (extra: string[] = []): Common => {
    const ids = uniq([...evidenceIds, ...extra]);
    return {
      ruleId: PROJECTED_SHORTFALL_RULE_ID,
      chargeId: charge.id,
      vendorId: charge.vendorId,
      fundingSourceId: charge.fundingSourceId,
      evaluatedAt: iso(now),
      evidenceIds: ids,
      inputs: ids.map((id) => `evidence:${id}`),
      availabilityObservedAt:
        fund && fund.id === charge.fundingSourceId ? new Date(fund.observedAt).toISOString().replace(".000Z", "Z") : null,
    };
  };

  if (!UPCOMING.has(charge.status)) {
    return {
      ...common(),
      status: "NOT_APPLICABLE",
      reason: "CHARGE_SETTLED",
      detail: `Charge status is ${charge.status}; only upcoming charges are projected.`,
    };
  }
  if (vendor && vendor.id === charge.vendorId && vendor.billingMethod === "INVOICE") {
    return {
      ...common(),
      status: "NOT_APPLICABLE",
      reason: "INVOICE_BILLED",
      detail: `${vendor.name} is invoice-billed; invoiced charges do not enter card-limit calculations.`,
    };
  }

  const mappings: RequestedMapping[] = [];
  const vendorName = vendor?.name ?? charge.vendorId;

  if (!vendor || vendor.id !== charge.vendorId) {
    mappings.push({ code: "VENDOR", message: `Vendor record ${charge.vendorId} is missing for charge ${charge.id}.` });
  } else if (vendor.billingMethod !== "CARD") {
    mappings.push({
      code: "BILLING_METHOD",
      message: `Confirm how ${vendorName} is billed (card or invoice). Card-limit exposure cannot be asserted for an unknown payment method.`,
    });
  }

  if (charge.fundingSourceId === null) {
    mappings.push({ code: "FUNDING_SOURCE", message: `Map ${vendorName}'s charge ${charge.id} to the card/fund that pays it.` });
  } else if (!fund || fund.id !== charge.fundingSourceId) {
    mappings.push({
      code: "FUNDING_SOURCE",
      message: `Funding source ${charge.fundingSourceId} for charge ${charge.id} was not found.`,
    });
  }

  const expected: Money = fromNullableCents(charge.expectedCents);
  if (!expected.known) {
    mappings.push({ code: "EXPECTED_AMOUNT", message: `Provide the expected amount of ${vendorName}'s charge ${charge.id}.` });
  }

  const expectedAt = parseDate(charge.expectedAt);
  if (!expectedAt) {
    mappings.push({ code: "EXPECTED_DATE", message: `Provide the expected date of ${vendorName}'s charge ${charge.id}.` });
  }

  const fundOk = fund !== null && fund.id === charge.fundingSourceId;
  const available: Money = fundOk ? fromNullableCents(fund.availableCents) : fromNullableCents(null);
  if (fundOk && !available.known) {
    mappings.push({ code: "AVAILABLE_ALLOCATION", message: `Provide the current available allocation of fund "${fund.name}".` });
  }

  let period: PeriodComparison | null = null;
  if (fundOk && expectedAt) {
    period = comparePeriods(new Date(fund.observedAt), expectedAt, fund.interval);
    if (period.status === "UNKNOWN_INTERVAL") {
      mappings.push({ code: "BILLING_PERIOD", message: `Confirm the reset interval of fund "${fund.name}".` });
    } else if (period.status === "DIFFERENT") {
      mappings.push({
        code: "BILLING_PERIOD",
        message: `Availability of "${fund.name}" was read for period ${period.observedPeriodUtc}, but the charge falls in ${period.chargePeriodUtc}; provide availability for that period.`,
      });
    } else if (period.status === "AMBIGUOUS") {
      mappings.push({ code: "BILLING_PERIOD", message: `Confirm the workspace timezone: ${period.reason}.` });
    }
  }

  const dueInDays = expectedAt ? daysUntil(now, expectedAt) : null;
  if (expectedAt && expectedAt.getTime() < now.getTime()) {
    mappings.push({
      code: "CHARGE_PAST_DUE",
      message: `Charge ${charge.id} was expected ${iso(expectedAt)}, before now; confirm whether it cleared, declined or was rescheduled.`,
    });
  }

  if (fundOk && new Date(fund.observedAt).getTime() > now.getTime()) {
    mappings.push({
      code: "AVAILABILITY_FROM_FUTURE",
      message: `Availability of "${fund.name}" is dated ${fund.observedAt}, after the evaluation time ${iso(now)}; provide a current reading.`,
    });
  }

  // Earlier upcoming charges on the same fund within the same period reduce availability first.
  const relevantPriors = priorCharges.filter((p) => p.billingMethod !== "INVOICE");
  const cardPriors = relevantPriors.filter((p) => p.billingMethod === "CARD").map((p) => p.charge);
  const uncertainPriors = relevantPriors.filter((p) => p.billingMethod !== "CARD").map((p) => p.charge);
  const priorEvidence = relevantPriors.map((p) => p.charge.evidenceId);
  if (uncertainPriors.length > 0) {
    mappings.push({
      code: "PRIOR_CHARGE_BILLING",
      message: `Earlier charge(s) on the same fund and period have an unknown billing method or vendor (${uncertainPriors
        .map((p) => p.id)
        .join(", ")}); confirm whether they are card-billed, since they may consume this allocation first.`,
    });
  }
  let committed: Money = knownCents(0);
  for (const p of cardPriors) committed = addCents(committed, fromNullableCents(p.expectedCents));
  if (!committed.known) {
    mappings.push({
      code: "PRIOR_CHARGE_AMOUNT",
      message: `An earlier charge on the same fund and period has an unknown amount (${cardPriors
        .filter((p) => p.expectedCents === null)
        .map((p) => p.id)
        .join(", ")}).`,
    });
  }

  if (mappings.length > 0 || fund === null || !expected.known || !available.known || !committed.known || !expectedAt || period?.status !== "SAME") {
    return {
      ...common(priorEvidence),
      status: "UNKNOWN_DATA",
      expectedCents: expected.known ? expected.cents : null,
      availableCents: available.known ? available.cents : null,
      shortfallCents: null,
      expectedAt: expectedAt ? iso(expectedAt) : null,
      dueInDays,
      requestedMappings: mappings,
    };
  }

  const remaining = subtractCents(available, committed);
  const effective = remaining.known && compareCents(remaining, knownCents(0)) === "LT" ? knownCents(0) : remaining;
  const shortfall = shortfallOf(expected, effective);
  const margin = shortfallOf(effective, expected);
  // Every operand is known past the gates; an unknown here is a bug, never a silent 0.
  const n = (m: Money): number => {
    if (!m.known) throw new Error(`invariant: unknown money after projection gates (${charge.id})`);
    return m.cents;
  };

  const assumptions = [
    `Availability ${formatCents(available)} read at ${fund.observedAt} applies to the ${fund.interval.toLowerCase()} period containing the charge.`,
    "Period boundaries were checked under every plausible workspace timezone (UTC-12 to UTC+14).",
    "Only this fund's upcoming card-billed charges in the same period are deducted; pending authorizations are not modeled.",
  ];
  if (fund.limitCents === null) assumptions.push(`Fund "${fund.name}" limit is unknown; only available allocation was used.`);
  const availabilityAgeDays = daysUntil(new Date(fund.observedAt), now);
  const availabilityStale = availabilityAgeDays > AVAILABILITY_STALE_AFTER_DAYS;
  if (availabilityStale) {
    assumptions.push(
      `Availability reading is ${availabilityAgeDays} days old (freshness threshold ${AVAILABILITY_STALE_AFTER_DAYS} days); the current allocation may differ.`,
    );
  }

  return {
    ...common(priorEvidence),
    status: "SCORED",
    expectedCents: n(expected),
    availableCents: n(available),
    committedBeforeCents: n(committed),
    effectiveAvailableCents: n(effective),
    shortfallCents: n(shortfall),
    marginCents: n(margin),
    hasShortfall: n(shortfall) > 0,
    expectedAt: iso(expectedAt),
    dueInDays: dueInDays!,
    periodKeyUtc: period.periodKeyUtc,
    priorChargeIds: cardPriors.map((p) => p.id),
    availabilityAgeDays,
    availabilityStale,
    assumptions,
  };
}

export type ProjectChargesInput = {
  charges: readonly ProjectableCharge[];
  vendors: readonly Vendor[];
  fundingSources: readonly FundingSource[];
  now: Date;
};

/**
 * Project every charge. For each charge, earlier upcoming (not past-due) charges
 * on the same fund whose dates fall in the same funding period are deducted first.
 * Results are ordered by expectedAt then id (unknown dates last).
 */
export function projectCharges({ charges, vendors, fundingSources, now }: ProjectChargesInput): ChargeProjection[] {
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const fundById = new Map(fundingSources.map((f) => [f.id, f]));
  const time = (c: ProjectableCharge) => parseDate(c.expectedAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  const ordered = [...charges].sort((a, b) => time(a) - time(b) || a.id.localeCompare(b.id));

  return ordered.map((charge) => {
    const fund = charge.fundingSourceId ? fundById.get(charge.fundingSourceId) ?? null : null;
    const at = parseDate(charge.expectedAt);
    const priorCharges =
      fund && at
        ? ordered.filter((p) => {
            if (p.id === charge.id || p.fundingSourceId !== fund.id || !UPCOMING.has(p.status)) return false;
            const pAt = parseDate(p.expectedAt);
            if (!pAt || pAt.getTime() < now.getTime()) return false;
            const before = pAt.getTime() < at.getTime() || (pAt.getTime() === at.getTime() && p.id < charge.id);
            if (!before) return false;
            if (vendorById.get(p.vendorId)?.billingMethod === "INVOICE") return false;
            return comparePeriods(pAt, at, fund.interval).status !== "DIFFERENT";
          }).map((p): PriorCharge => ({ charge: p, billingMethod: vendorById.get(p.vendorId)?.billingMethod ?? null }))
        : [];
    return projectCharge({ charge, vendor: vendorById.get(charge.vendorId) ?? null, fund, now, priorCharges });
  });
}
