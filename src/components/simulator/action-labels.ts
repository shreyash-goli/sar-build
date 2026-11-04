import type { ActionHistoryEntry } from "@/lib/actions/schema";
import type { BadgeProps } from "@/components/ui/badge";
import type { ActionProposalState } from "@/lib/schema/enums";

type Variant = NonNullable<BadgeProps["variant"]>;

/** Never "executed": approval only changes the simulated plan. */
export const ACTION_STATE_LABEL: Readonly<Record<ActionProposalState, string>> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED_FOR_DEMO: "Approved for demo",
  REJECTED: "Rejected",
};

export const ACTION_STATE_VARIANT: Readonly<Record<ActionProposalState, Variant>> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "info",
  APPROVED_FOR_DEMO: "success",
  REJECTED: "danger",
};

export const HISTORY_ACTION_LABEL: Readonly<Record<ActionHistoryEntry["action"], string>> = {
  "action.proposed": "Proposed",
  "action.submitted": "Submitted for approval",
  "action.approved_for_demo": "Approved for demo",
  "action.rejected": "Rejected",
};
