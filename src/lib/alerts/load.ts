/** Server-only alert read helper for server components (FS-20). */
import { createReadOnlyRepositories } from "@/lib/provenance/ledger";
import { getNow, resolveDemoClock } from "@/lib/time";
import type { AlertListData, AlertListQuery } from "./schema";
import { buildAlertList } from "./service";

/** Alerts as of the (demo) clock. Default view: active only. */
export function loadAlerts(query: AlertListQuery = {}): Promise<AlertListData> {
  return buildAlertList(createReadOnlyRepositories(), query, getNow(), resolveDemoClock() !== null);
}
