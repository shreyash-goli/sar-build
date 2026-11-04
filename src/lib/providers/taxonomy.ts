/**
 * Small curated provider taxonomy (FS-09). A match means "this repository
 * references a provider of this kind": a possible integration, NOT proof that
 * it is production-critical or card-funded.
 *
 * `vendorKey` links a provider to a Vendor.normalizedKey in the workspace.
 * Real-world providers without a vendor record (vendorKey null, or no matching
 * record) are reported as unmatched; no vendor or node is ever invented.
 * The CloudComms / WebhookWorks / ComputeHarbor / MetricsRelay entries are the
 * FICTIONAL demo vendors and their fictional package names.
 */
export type ProviderEntry = {
  id: string;
  name: string;
  category: string;
  vendorKey: string | null;
  fictional: boolean;
  /** Exact npm package names. */
  npm: readonly string[];
  /** Container image repository prefixes (registry and tag stripped), e.g. "webhookworks/". */
  imagePrefixes: readonly string[];
  /** Terraform provider local names or "namespace/name" sources. */
  terraform: readonly string[];
};

export const PROVIDER_TAXONOMY: readonly ProviderEntry[] = [
  { id: "cloudcomms", name: "CloudComms", category: "SMS provider", vendorKey: "cloudcomms", fictional: true, npm: ["@cloudcomms/sdk", "cloudcomms"], imagePrefixes: ["cloudcomms/"], terraform: ["cloudcomms", "cloudcomms/cloudcomms"] },
  { id: "webhookworks", name: "WebhookWorks", category: "API status monitoring", vendorKey: "webhookworks", fictional: true, npm: ["@webhookworks/client"], imagePrefixes: ["webhookworks/"], terraform: ["webhookworks", "webhookworks/webhookworks"] },
  { id: "computeharbor", name: "ComputeHarbor", category: "Cloud host", vendorKey: "computeharbor", fictional: true, npm: ["@computeharbor/sdk"], imagePrefixes: ["computeharbor/"], terraform: ["computeharbor", "computeharbor/computeharbor"] },
  { id: "metricsrelay", name: "MetricsRelay", category: "Metrics pipeline", vendorKey: "metricsrelay", fictional: true, npm: ["metricsrelay", "@metricsrelay/node"], imagePrefixes: ["metricsrelay/"], terraform: ["metricsrelay", "metricsrelay/metricsrelay"] },
  { id: "twilio", name: "Twilio", category: "SMS provider", vendorKey: null, fictional: false, npm: ["twilio"], imagePrefixes: [], terraform: ["twilio", "twilio/twilio"] },
  { id: "stripe", name: "Stripe", category: "Payments API", vendorKey: null, fictional: false, npm: ["stripe"], imagePrefixes: [], terraform: ["stripe"] },
  { id: "sendgrid", name: "SendGrid", category: "Email provider", vendorKey: null, fictional: false, npm: ["@sendgrid/mail"], imagePrefixes: [], terraform: [] },
  { id: "datadog", name: "Datadog", category: "Observability", vendorKey: null, fictional: false, npm: ["dd-trace"], imagePrefixes: ["datadog/"], terraform: ["datadog", "datadog/datadog"] },
];

export function matchNpm(name: string): ProviderEntry | null {
  return PROVIDER_TAXONOMY.find((p) => p.npm.includes(name)) ?? null;
}

/** `image` like "registry.example.com:5000/webhookworks/agent:2.1@sha256:..." -> repository "webhookworks/agent". */
export function imageRepository(image: string): string {
  let ref = image.split("@")[0]!;
  const parts = ref.split("/");
  if (parts.length > 1 && /[.:]/.test(parts[0]!) ) parts.shift(); // registry host[:port]
  ref = parts.join("/");
  const lastColon = ref.lastIndexOf(":");
  if (lastColon > ref.lastIndexOf("/")) ref = ref.slice(0, lastColon); // tag
  return ref.toLowerCase();
}

export function matchImage(image: string): ProviderEntry | null {
  const repo = imageRepository(image);
  return PROVIDER_TAXONOMY.find((p) => p.imagePrefixes.some((pre) => repo.startsWith(pre))) ?? null;
}

export function matchTerraform(provider: string): ProviderEntry | null {
  const key = provider.toLowerCase();
  return PROVIDER_TAXONOMY.find((p) => p.terraform.includes(key)) ?? null;
}
