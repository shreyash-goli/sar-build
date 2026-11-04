/**
 * Rules-based response runbooks (FS-16). Pure and client-safe.
 *
 * One checklist per incident, chosen by risk category, with an owner per step,
 * step dependencies, and the unknowns that still apply. Nothing is automatic:
 * FailSafe never contacts vendors, moves money or changes limits; every step
 * is a human task (`automatic: false`) with copyable text.
 */
import * as z from "zod";
import { Criticality, RiskCategory, Severity } from "../schema/enums";
import { formatCents } from "../schema/money";

export const RUNBOOK_RULE_ID = "runbook-v1" as const;
export const RUNBOOK_DISCLAIMER =
  "Checklist only: FailSafe does not contact vendors, move money or change card limits. Every step is performed by a person.";

export const RunbookStepKind = z.enum([
  "CONFIRM_BILLING_METHOD",
  "MAP_FUNDING_SOURCE",
  "CONTACT_FUND_OWNER",
  "REQUEST_LIMIT_REVIEW",
  "VERIFY_ALTERNATE_PAYMENT",
  "CONTACT_SERVICE_OWNER",
  "MAP_DEPENDENCIES",
  "MONITOR_VENDOR",
]);
export type RunbookStepKind = z.infer<typeof RunbookStepKind>;

export const RunbookOwnerSchema = z.strictObject({
  /** Functional role responsible for the step. */
  role: z.enum(["FINANCE", "SERVICE_OWNER", "VENDOR_OWNER"]),
  /** Team from the dependency graph; null when no owner is recorded ("Unassigned"). */
  name: z.string().nullable(),
});

export const RunbookStepSchema = z.strictObject({
  id: z.string(),
  kind: RunbookStepKind,
  title: z.string(),
  detail: z.string(),
  owner: RunbookOwnerSchema,
  /** Step IDs that should be completed first. */
  dependsOn: z.array(z.string()),
  /** What is still not known when doing this step. */
  unknowns: z.array(z.string()),
  /** Always false: nothing in a runbook happens automatically. */
  automatic: z.literal(false),
  /** Plain-text version for copy/paste into a ticket or message. */
  copyText: z.string(),
});
export type RunbookStep = z.infer<typeof RunbookStepSchema>;

export const RunbookSchema = z.strictObject({
  ruleId: z.literal(RUNBOOK_RULE_ID),
  incidentKey: z.string(),
  title: z.string(),
  /** Owner of the first actionable step (no unmet dependencies). */
  nextOwner: RunbookOwnerSchema,
  steps: z.array(RunbookStepSchema).min(1),
  disclaimer: z.literal(RUNBOOK_DISCLAIMER),
});
export type Runbook = z.infer<typeof RunbookSchema>;

export type RunbookInput = {
  incidentKey: string;
  category: z.infer<typeof RiskCategory>;
  severity: z.infer<typeof Severity>;
  vendorName: string;
  /** Owner of the vendor's graph node, if recorded. */
  vendorOwner: string | null;
  fund: { id: string; name: string; owner: string | null } | null;
  /** Confirmed impacted workflows, worst first. */
  workflows: { label: string; owner: string | null; criticality: z.infer<typeof Criticality> }[];
  /** Workflows/outcomes reachable only via SUGGESTED edges. */
  possibleImpactLabels: string[];
  expectedCents: number | null;
  availableCents: number | null;
  shortfallCents: number | null;
  /** Charge due date (forecast) or decline date. */
  at: string | null;
  dueInDays: number | null;
  declinedAmountCents: number | null;
  declineReason: string | null;
  /** Missing-input codes from the projection (e.g. BILLING_METHOD, FUNDING_SOURCE). */
  missingCodes: string[];
  /** False when the fund -> vendor payment link is not confirmed in the graph. */
  paymentLinkConfirmed: boolean;
};

type Draft = Omit<RunbookStep, "id" | "automatic" | "copyText" | "dependsOn"> & { dependsOn?: RunbookStepKind[] };

const finance = (fund: RunbookInput["fund"]) => ({ role: "FINANCE" as const, name: fund?.owner ?? null });
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "an unknown date");

function serviceStep(i: RunbookInput, note: string): Draft {
  const top = i.workflows[0];
  return {
    kind: "CONTACT_SERVICE_OWNER",
    title: top ? `Tell ${top.owner ?? "the service owner"} that ${top.label} may be affected` : `Find who depends on ${i.vendorName}`,
    detail: top
      ? `${top.label} (${top.criticality}) depends on ${i.vendorName} through a confirmed path. ${note}`
      : `No confirmed workflow depends on ${i.vendorName} yet. ${note}`,
    owner: { role: "SERVICE_OWNER", name: top?.owner ?? null },
    unknowns: ["Whether the vendor would suspend or degrade service, and when."],
  };
}

function monitorStep(i: RunbookInput, dependsOn: RunbookStepKind[]): Draft {
  return {
    kind: "MONITOR_VENDOR",
    title: `Monitor ${i.vendorName} billing and service status`,
    detail: `Watch for the ${i.vendorName} charge${i.at ? ` around ${day(i.at)}` : ""}, any decline, and vendor service-status notices. Re-run the evaluation after any change.`,
    owner: { role: "VENDOR_OWNER", name: i.vendorOwner },
    unknowns: ["Vendor-side billing retries and grace periods are not visible to FailSafe."],
    dependsOn,
  };
}

function rules(i: RunbookInput): { title: string; steps: Draft[] } {
  const short = formatCents(i.shortfallCents);
  switch (i.category) {
    case "PROJECTED_SHORTFALL": {
      const steps: Draft[] = [];
      if (!i.paymentLinkConfirmed) {
        steps.push({
          kind: "MAP_FUNDING_SOURCE",
          title: `Confirm which card/fund pays ${i.vendorName}`,
          detail: `The payment link from ${i.fund?.name ?? "the funding source"} to ${i.vendorName} is not confirmed in the dependency graph.`,
          owner: finance(i.fund),
          unknowns: ["Which card the vendor actually charges."],
        });
      }
      steps.push(
        {
          kind: "CONTACT_FUND_OWNER",
          title: `Confirm current availability on ${i.fund?.name ?? "the funding source"}`,
          detail: `Modeled ${formatCents(i.availableCents)} available vs ${formatCents(i.expectedCents)} expected on ${day(i.at)} (projected shortfall ${short}). Check the live figure before acting.`,
          owner: finance(i.fund),
          unknowns: ["Pending authorizations or other spend that may already reduce availability."],
          dependsOn: i.paymentLinkConfirmed ? [] : ["MAP_FUNDING_SOURCE"],
        },
        {
          kind: "REQUEST_LIMIT_REVIEW",
          title: `Request a limit review of at least ${short}`,
          detail: `Ask the fund approver to review the ${i.fund?.name ?? "fund"} allocation before ${day(i.at)}. A simulation in the Response Studio can show the modeled effect; it changes nothing in Ramp.`,
          owner: finance(i.fund),
          unknowns: ["Approval timeline and whether a mid-period increase is allowed."],
          dependsOn: ["CONTACT_FUND_OWNER"],
        },
        {
          kind: "VERIFY_ALTERNATE_PAYMENT",
          title: `Verify an alternate payment route for ${i.vendorName}`,
          detail: `If the limit cannot be raised in time, check whether another funded card can pay ${i.vendorName} before ${day(i.at)}.`,
          owner: finance(i.fund),
          unknowns: [`Whether ${i.vendorName} accepts a card change without interrupting service.`],
          dependsOn: ["CONTACT_FUND_OWNER"],
        },
        serviceStep(i, `If the ${day(i.at)} charge fails, that is a potential interruption risk, not a confirmed outage.`),
      );
      if (i.workflows.length === 0) {
        steps.push({
          kind: "MAP_DEPENDENCIES",
          title: `Map which services depend on ${i.vendorName}`,
          detail: "Severity cannot be scored without a confirmed dependency path.",
          owner: { role: "SERVICE_OWNER", name: null },
          unknowns: ["Which workflows would be affected."],
        });
      }
      steps.push(monitorStep(i, ["REQUEST_LIMIT_REVIEW", "VERIFY_ALTERNATE_PAYMENT"]));
      const title =
        i.severity === "LOW"
          ? `Monitor ${short} projected shortfall for ${i.vendorName} (outside the 14-day window)`
          : `Prevent a ${short} funding shortfall for ${i.vendorName} by ${day(i.at)}`;
      return { title, steps };
    }
    case "OBSERVED_DECLINE":
      return {
        title: `Respond to the declined ${i.vendorName} charge (${formatCents(i.declinedAmountCents)})`,
        steps: [
          {
            kind: "CONTACT_FUND_OWNER",
            title: `Find out why the ${i.vendorName} charge was declined`,
            detail: `A ${formatCents(i.declinedAmountCents)} charge was declined on ${day(i.at)}${i.declineReason ? ` (recorded reason: ${i.declineReason})` : ""}. Confirm the cause with the fund owner.`,
            owner: finance(i.fund),
            unknowns: ["Whether the recorded reason matches the card program's actual decline cause."],
          },
          {
            kind: "VERIFY_ALTERNATE_PAYMENT",
            title: `Arrange a working payment route for ${i.vendorName}`,
            detail: "Fix the funding on the current card, or verify another funded card the vendor can charge.",
            owner: finance(i.fund),
            unknowns: ["When the vendor will retry the charge."],
            dependsOn: ["CONTACT_FUND_OWNER"],
          },
          serviceStep(i, "Vendor service impact is unconfirmed: check the vendor's status before escalating."),
          monitorStep(i, ["VERIFY_ALTERNATE_PAYMENT"]),
        ],
      };
    case "UNKNOWN_DATA": {
      const steps: Draft[] = [];
      if (i.missingCodes.includes("BILLING_METHOD")) {
        steps.push({
          kind: "CONFIRM_BILLING_METHOD",
          title: `Confirm how ${i.vendorName} is billed (card or invoice)`,
          detail: "Card-limit exposure cannot be assessed until the billing method is known.",
          owner: { role: "VENDOR_OWNER", name: i.vendorOwner },
          unknowns: ["Billing method."],
        });
      }
      if (i.missingCodes.includes("FUNDING_SOURCE")) {
        steps.push({
          kind: "MAP_FUNDING_SOURCE",
          title: `Map ${i.vendorName}'s charges to the card/fund that pays them`,
          detail: "No funding source is recorded for the upcoming charge.",
          owner: finance(i.fund),
          unknowns: ["Which fund and card are charged."],
          dependsOn: i.missingCodes.includes("BILLING_METHOD") ? ["CONFIRM_BILLING_METHOD"] : [],
        });
      }
      const other = i.missingCodes.filter((c) => c !== "BILLING_METHOD" && c !== "FUNDING_SOURCE");
      if (other.length > 0 || steps.length === 0) {
        steps.push({
          kind: "CONTACT_FUND_OWNER",
          title: "Supply the missing financial inputs",
          detail: `Missing: ${(other.length > 0 ? other : ["unspecified inputs"]).join(", ")}.`,
          owner: finance(i.fund),
          unknowns: other.length > 0 ? other : ["Which inputs are missing."],
        });
      }
      // Monitoring waits on the data-mapping steps; contacting the service owner runs in parallel.
      const mappingKinds = steps.map((s) => s.kind);
      steps.push(
        serviceStep(
          i,
          i.possibleImpactLabels.length > 0
            ? `Also review the unconfirmed (suggested) impact on ${i.possibleImpactLabels.join(", ")}.`
            : "Confirm whether any workflow depends on this vendor.",
        ),
        monitorStep(i, mappingKinds),
      );
      return { title: `Map the missing data for ${i.vendorName} before risk can be scored`, steps };
    }
    case "NO_RISK":
      return { title: `Keep monitoring ${i.vendorName} (no projected shortfall)`, steps: [monitorStep(i, [])] };
  }
}

const copy = (n: number, s: { title: string; detail: string; unknowns: string[]; dependsOn: string[] }, ownerLabel: string) =>
  [
    `${n}. ${s.title}`,
    `Owner: ${ownerLabel}`,
    s.detail,
    ...(s.dependsOn.length > 0 ? [`After: ${s.dependsOn.join(", ")}`] : []),
    ...(s.unknowns.length > 0 ? [`Unknowns: ${s.unknowns.join(" ")}`] : []),
    "Manual step: FailSafe does not perform this automatically.",
  ].join("\n");

const ownerLabel = (o: RunbookStep["owner"]) =>
  `${o.name ?? "Unassigned"} (${o.role === "FINANCE" ? "finance" : o.role === "SERVICE_OWNER" ? "service owner" : "vendor owner"})`;

export function buildRunbook(i: RunbookInput): Runbook {
  const { title, steps } = rules(i);
  const idOf = (kind: RunbookStepKind) => `${kind.toLowerCase().replace(/_/g, "-")}`;
  const present = new Set(steps.map((s) => s.kind));
  const built: RunbookStep[] = steps.map((s, n) => {
    const dependsOn = (s.dependsOn ?? []).filter((k) => present.has(k)).map(idOf);
    return {
      id: idOf(s.kind),
      kind: s.kind,
      title: s.title,
      detail: s.detail,
      owner: s.owner,
      dependsOn,
      unknowns: s.unknowns,
      automatic: false,
      copyText: copy(n + 1, { title: s.title, detail: s.detail, unknowns: s.unknowns, dependsOn }, ownerLabel(s.owner)),
    };
  });
  const first = built.find((s) => s.dependsOn.length === 0) ?? built[0]!;
  return {
    ruleId: RUNBOOK_RULE_ID,
    incidentKey: i.incidentKey,
    title,
    nextOwner: first.owner,
    steps: built,
    disclaimer: RUNBOOK_DISCLAIMER,
  };
}
