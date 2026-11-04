import {
  AppWindow,
  Building2,
  CreditCard,
  Landmark,
  Server,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { NodeKind } from "@/lib/schema";

export const KIND_ICON: Readonly<Record<NodeKind, LucideIcon>> = {
  FUND: Landmark,
  CARD: CreditCard,
  VENDOR: Building2,
  SERVICE: Server,
  WORKFLOW: Workflow,
  OUTCOME: AppWindow,
};
