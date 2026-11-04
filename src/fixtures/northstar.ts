/**
 * Typed loader for the fictional Northstar Labs demo fixture.
 * The fixture holds only source records (evidence, financial objects, graph).
 * Incidents, simulations and proposals are never precomputed; the risk engine
 * generates them.
 */
import * as z from "zod";
import {
  EdgeSchema,
  EvidenceRecordSchema,
  FundingSourceSchema,
  IsoDateTimeSchema,
  NodeSchema,
  PaymentInstrumentSchema,
  TransactionSchema,
  VendorChargeSchema,
  VendorSchema,
  WorkspaceSchema,
} from "@/lib/schema";
import raw from "./northstar-demo.json";

export const DemoFixtureSchema = z.strictObject({
  meta: z.strictObject({
    fixtureId: z.string().min(1),
    version: z.int().positive(),
    demoNow: IsoDateTimeSchema,
    sourceClass: z.literal("DEMO_FIXTURE"),
    disclaimer: z.string().min(1),
  }),
  workspace: WorkspaceSchema.extend({ mode: z.literal("DEMO") }),
  evidence: z.array(EvidenceRecordSchema),
  fundingSources: z.array(FundingSourceSchema),
  paymentInstruments: z.array(PaymentInstrumentSchema),
  vendors: z.array(VendorSchema),
  vendorCharges: z.array(VendorChargeSchema),
  transactions: z.array(TransactionSchema),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});
export type DemoFixture = z.infer<typeof DemoFixtureSchema>;

/** Parse (and validate) the bundled fixture. Throws on any contract violation. */
export function loadNorthstarFixture(): DemoFixture {
  return DemoFixtureSchema.parse(raw);
}

/** Graph node ID for a financial entity (fund/card/vendor) ID. */
export function entityNodeId(entityId: string): string {
  return `node-${entityId}`;
}
