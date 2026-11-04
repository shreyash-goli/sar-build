/**
 * Pure mappers from Ramp list items to FailSafe's FS-02 records (FS-18).
 *
 * Field names are from the Ramp API reference (https://docs.ramp.com/llms-api.txt):
 * - Transaction: id, entity_amount { value, currency } | null, state ('ALL' | 'CLEARED' | 'COMPLETION' |
 *   'DECLINED' | 'ERROR' | 'PENDING' | 'PENDING_INITIATION'), user_transaction_time, merchant_id,
 *   merchant_name, card_id, fund_id, limit_id, decline_details { reason }. The deprecated `amount`
 *   field is NOT used (https://docs.ramp.com/llms-guides/webhooks.txt).
 * - Fund (GET /developer/v1/funds): id, display_name, state, spending_restrictions { interval, limit
 *   { amount, currency_code } }, balance { cleared, pending, total }.
 * - Physical card (GET /developer/v1/cards/physical): id, display_name, state, fund_id.
 * Units: "Most Ramp API monetary values use integers in the smallest denomination of the relevant
 * currency" (https://docs.ramp.com/llms-guides/monetary-values.txt). Only integer USD amounts are
 * accepted; anything else is skipped and reported, never coerced.
 *
 * Honesty rules: fund availability is NOT derived from balance (its semantics are unconfirmed), so
 * availableCents is null (unknown). Vendor billing method is never inferred (UNKNOWN). Unknown
 * values stay null; nothing becomes 0.
 */
import * as z from "zod";
import type { FundingInterval, PaymentInstrument, PaymentInstrumentStatus, TransactionState } from "@/lib/schema";

const Str = z.string().min(1);
const AmountObj = z.looseObject({ amount: z.number().optional(), currency_code: z.string().optional() });

export const RampTransaction = z.looseObject({
  id: Str,
  entity_amount: z.looseObject({ value: z.number(), currency: z.string() }).nullable().optional(),
  state: z.string().optional(),
  user_transaction_time: z.string().optional(),
  merchant_id: z.string().nullable().optional(),
  merchant_name: z.string().nullable().optional(),
  card_id: z.string().nullable().optional(),
  fund_id: z.string().nullable().optional(),
  limit_id: z.string().nullable().optional(),
  decline_details: z.looseObject({ reason: z.string().optional() }).nullable().optional(),
});
export type RampTransaction = z.infer<typeof RampTransaction>;

export const RampFund = z.looseObject({
  id: Str,
  display_name: z.string().optional(),
  state: z.string().optional(),
  spending_restrictions: z.looseObject({ interval: z.string().optional(), limit: AmountObj.nullable().optional() }).nullable().optional(),
});
export type RampFund = z.infer<typeof RampFund>;

export const RampCard = z.looseObject({
  id: Str,
  display_name: z.string().optional(),
  state: z.string().optional(),
  fund_id: z.string().nullable().optional(),
});
export type RampCard = z.infer<typeof RampCard>;

export const fundId = (rampId: string) => `ramp-fund-${rampId}`;
export const cardId = (rampId: string) => `ramp-card-${rampId}`;
export const txId = (rampId: string) => `ramp-tx-${rampId}`;

export function vendorKeyOf(t: Pick<RampTransaction, "merchant_id" | "merchant_name">): string | null {
  const raw = t.merchant_id?.trim() || t.merchant_name?.trim() || "";
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug ? `ramp-${slug}` : null;
}

const INTERVAL: Readonly<Record<string, FundingInterval>> = {
  DAILY: "DAILY",
  WEEKLY: "WEEKLY",
  MONTHLY: "MONTHLY",
  QUARTERLY: "QUARTERLY",
  ANNUAL: "YEARLY",
  YEARLY: "YEARLY",
  TOTAL: "TOTAL",
};
export const mapInterval = (i: string | undefined): FundingInterval => (i ? (INTERVAL[i] ?? "UNKNOWN") : "UNKNOWN");

/** Integer USD minor units, else null (unknown). */
export function usdCents(amount: unknown, currency: unknown): number | null {
  return typeof amount === "number" && Number.isSafeInteger(amount) && currency === "USD" ? amount : null;
}

const CARD_STATUS: Readonly<Record<string, PaymentInstrumentStatus>> = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  CHIP_LOCKED: "SUSPENDED",
  TERMINATED: "TERMINATED",
};
export const mapCardStatus = (s: string | undefined): PaymentInstrumentStatus => (s ? (CARD_STATUS[s] ?? "UNKNOWN") : "UNKNOWN");
export const cardKind = (source: "physical" | "virtual"): PaymentInstrument["kind"] => (source === "physical" ? "PHYSICAL_CARD" : "VIRTUAL_CARD");

const TX_STATE: Readonly<Record<string, TransactionState>> = {
  CLEARED: "CLEARED",
  COMPLETION: "CLEARED",
  DECLINED: "DECLINED",
  PENDING: "PENDING",
  PENDING_INITIATION: "PENDING",
};

export type TxMapping =
  | { ok: true; state: TransactionState; amountCents: number; occurredAt: string; vendorKey: string; vendorName: string; reason: string | null }
  | { ok: false; reason: string };

export function mapTransaction(t: RampTransaction): TxMapping {
  const state = t.state ? TX_STATE[t.state] : undefined;
  if (!state) return { ok: false, reason: `unsupported state ${t.state ?? "(missing)"}` };
  if (!t.entity_amount) return { ok: false, reason: "amount unknown (entity_amount is null)" };
  const cents = usdCents(t.entity_amount.value, t.entity_amount.currency);
  if (cents === null) return { ok: false, reason: `amount not integer USD minor units (${t.entity_amount.currency})` };
  if (!t.user_transaction_time || Number.isNaN(Date.parse(t.user_transaction_time))) return { ok: false, reason: "missing user_transaction_time" };
  const key = vendorKeyOf(t);
  if (!key) return { ok: false, reason: "no merchant id or name" };
  return {
    ok: true,
    state,
    amountCents: cents,
    occurredAt: new Date(t.user_transaction_time).toISOString().replace(".000Z", "Z"),
    vendorKey: key,
    vendorName: t.merchant_name?.trim() || t.merchant_id!.trim(),
    reason: t.decline_details?.reason ?? null,
  };
}
