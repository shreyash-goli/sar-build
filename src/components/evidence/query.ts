import {
  parseSourcesQuery,
  type SourcesListQuery,
} from "@/lib/provenance";

export type SourcesSearchParams = Record<string, string | string[] | undefined>;

const FILTER_PARAMS = ["classification", "verificationStatus"] as const;

export type ParsedSourcesParams = {
  filters: SourcesListQuery;
  selectedId: string | null;
  /** Filter params rejected by the shared parser (ignored, never guessed). */
  invalid: { name: (typeof FILTER_PARAMS)[number]; value: string }[];
};

function display(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v.join(", ") : (v ?? "");
}

/**
 * Parse /sources search params with the shared `parseSourcesQuery` (same rules
 * as GET /api/sources). Each filter is parsed on its own so one bad value does
 * not discard a valid one; `source` is the page's own inspector param.
 */
export function parseSourcesParams(sp: SourcesSearchParams): ParsedSourcesParams {
  const filters: SourcesListQuery = {};
  const invalid: ParsedSourcesParams["invalid"] = [];

  for (const name of FILTER_PARAMS) {
    const result = parseSourcesQuery({ [name]: sp[name] });
    if (result.ok) Object.assign(filters, result.query);
    else invalid.push({ name, value: display(sp[name]) });
  }

  const rawSource = Array.isArray(sp.source) ? sp.source[0] : sp.source;
  const selectedId = rawSource?.trim() ? rawSource.trim() : null;

  return { filters, selectedId, invalid };
}

/** Build a /sources href preserving active filters. */
export function sourcesHref(
  filters: SourcesListQuery,
  selectedId?: string | null,
): string {
  const params = new URLSearchParams();
  if (filters.classification) params.set("classification", filters.classification);
  if (filters.verificationStatus)
    params.set("verificationStatus", filters.verificationStatus);
  if (selectedId) params.set("source", selectedId);
  const qs = params.toString();
  return qs ? `/sources?${qs}` : "/sources";
}
