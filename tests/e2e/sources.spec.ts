import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Requires a seeded database (the fictional Northstar demo). Expected values
// are read from the API at test time rather than hardcoded, except for the
// specific seeded edge used as the golden inspector example.

type Supported = { subjectType: string; label: string; edge: { reviewStatus: string } | null };
type Entry = { id: string; sourceId: string; classification: string; verificationStatus: string; supports: Supported[] };
type ListData = {
  entries: Entry[];
  totals: { total: number; byClassification: Record<string, number>; byVerificationStatus: Record<string, number> };
  unresolved: unknown[];
};

const EDGE_EVIDENCE_ID = "ev-edge-vendor-cloudcomms--service-otp-gateway";

async function fetchLedger(request: APIRequestContext, qs = ""): Promise<ListData> {
  const res = await request.get(`/api/sources${qs}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data as ListData;
}

const items = (page: Page) => page.getByTestId("evidence-item");
const inspector = (page: Page) => page.getByTestId("source-inspector");

test.describe("Sources / evidence ledger", () => {
  test("lists every ledger entry with totals taken from the API", async ({ page, request }) => {
    const ledger = await fetchLedger(request);
    expect(ledger.totals.total).toBeGreaterThan(0);

    await page.goto("/sources");
    await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
    await expect(page.getByTestId("ledger-total")).toHaveText(String(ledger.totals.total));
    await expect(items(page)).toHaveCount(ledger.entries.length);

    // Each row shows class, review status and source ID.
    const first = items(page).first();
    await expect(first).toContainText(ledger.entries[0].sourceId);
    await expect(first.getByTestId("classification-badge")).toBeVisible();
    await expect(first.getByTestId("verification-badge")).toBeVisible();

    // Definitions for synthetic vs observed vs derived.
    const defs = page.getByTestId("evidence-definitions");
    for (const term of ["Synthetic", "Observed", "Derived"]) {
      await expect(defs.getByRole("term").filter({ hasText: term })).toBeVisible();
    }

    // Never labelled as Ramp-documented.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/RAMP_DOCUMENTED|Ramp[- ]documented/i);

    // Unresolved warning mirrors the API.
    if (ledger.unresolved.length === 0) {
      await expect(page.getByTestId("unresolved-warning")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("unresolved-warning")).toBeVisible();
    }
  });

  test("clicking a source shows exactly the assertions it supports and its trust status", async ({
    page,
    request,
  }) => {
    const res = await request.get(`/api/sources/${EDGE_EVIDENCE_ID}`);
    expect(res.ok()).toBeTruthy();
    const entry = (await res.json()).data as Entry;

    await page.goto("/sources");
    await page.locator(`[data-evidence-id="${EDGE_EVIDENCE_ID}"]`).click();
    await expect(page).toHaveURL(new RegExp(`source=${EDGE_EVIDENCE_ID}`));

    const panel = inspector(page);
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText(entry.sourceId);
    await expect(panel).toBeFocused();

    const assertions = panel.getByTestId("supported-assertion");
    await expect(assertions).toHaveCount(entry.supports.length);
    for (const s of entry.supports) {
      await expect(assertions.filter({ hasText: s.label })).toHaveCount(1);
    }
    await expect(assertions.first()).toContainText("CloudComms POWERS OTP gateway");
    await expect(assertions.first()).toContainText("Confirmed");

    const trust = panel.getByTestId("trust-summary");
    await expect(trust).toContainText("Demo / mock data");
    await expect(trust).toContainText("Unverified");
    await expect(panel.getByTestId("simulation-badge")).toHaveText("DEMO DATA");
    await expect(panel.getByTestId("rule-lineage")).toContainText("No rule lineage yet");
    await expect(panel).toContainText("Original excerpt");

    // aria-current marks the selected row.
    await expect(page.locator(`[data-evidence-id="${EDGE_EVIDENCE_ID}"]`)).toHaveAttribute(
      "aria-current",
      "true",
    );

    await panel.getByRole("link", { name: "Close source inspector" }).click();
    await expect(page).toHaveURL(/\/sources$/);
    await expect(panel).toContainText("Select a source to inspect it");
  });

  test("classification and review-status filters query the ledger", async ({ page, request }) => {
    const demo = await fetchLedger(request, "?classification=DEMO_FIXTURE");
    const verified = await fetchLedger(request, "?verificationStatus=USER_VERIFIED");

    await page.goto("/sources");
    await page.getByLabel("Evidence class").selectOption("DEMO_FIXTURE");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/classification=DEMO_FIXTURE/);
    await expect(page.getByTestId("ledger-total")).toHaveText(String(demo.totals.total));
    await expect(items(page)).toHaveCount(demo.entries.length);
    await expect(page.getByLabel("Evidence class")).toHaveValue("DEMO_FIXTURE");

    await page.getByLabel("Evidence class").selectOption("");
    await page.getByLabel("Review status").selectOption("USER_VERIFIED");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/verificationStatus=USER_VERIFIED/);
    await expect(page.getByTestId("ledger-total")).toHaveText(String(verified.totals.total));
    await expect(items(page)).toHaveCount(verified.entries.length);
    if (verified.entries.length === 0) {
      await expect(page.getByText("No sources match these filters")).toBeVisible();
    }

    await page.getByRole("link", { name: "Clear", exact: true }).click();
    await expect(page).toHaveURL(/\/sources$/);
  });

  test("derived evidence shows its rule lineage, the incident it supports, and that its inputs are demo data", async ({
    page,
    request,
  }) => {
    const derived = await fetchLedger(request, "?classification=DERIVED");
    type Derived = Entry & {
      ruleLineage: { ruleId: string }[];
      lineageStatus: string;
      derivedFromSimulatedInputs: boolean;
      display: { badge: { label: string } | null };
    };
    const current = (derived.entries as Derived[]).find((e) => e.lineageStatus === "CURRENT");
    test.skip(!current, "no current DERIVED evidence in this dataset");
    const entry = current!;
    expect(entry.ruleLineage.length).toBeGreaterThan(0);

    await page.goto(`/sources?classification=DERIVED&source=${encodeURIComponent(entry.id)}`);
    const panel = inspector(page);
    await expect(panel.getByTestId("classification-badge")).toHaveText("Derived");
    // Badge mirrors the API: DERIVED from demo inputs carries DEMO DATA.
    if (entry.display.badge) {
      await expect(panel.getByTestId("simulation-badge")).toHaveText(entry.display.badge.label);
    } else {
      await expect(panel.getByTestId("simulation-badge")).toHaveCount(0);
    }
    const trust = panel.getByTestId("trust-summary");
    await expect(trust).toContainText("Derived by a deterministic rule");
    await expect(trust).not.toContainText("Not simulated");
    if (entry.derivedFromSimulatedInputs) await expect(trust).toContainText("Inputs are demo data");

    const rules = panel.getByTestId("rule-lineage");
    await expect(rules).not.toContainText("No rule lineage yet");
    await expect(rules).toContainText(entry.ruleLineage[0]!.ruleId);
    await expect(panel.getByTestId("lineage-superseded")).toHaveCount(0);
    await expect(panel.getByTestId("supported-assertion").first()).toContainText("Incident");
  });

  test("invalid filter values are ignored with a visible notice", async ({ page }) => {
    await page.goto("/sources?classification=RAMP_DOCUMENTED");
    await expect(page.getByTestId("invalid-filter")).toContainText("classification=RAMP_DOCUMENTED");
    await expect(items(page).first()).toBeVisible();
  });

  test("unknown source id shows an explicit not-found state", async ({ page }) => {
    await page.goto("/sources?source=ev-does-not-exist");
    await expect(page.getByTestId("inspector-not-found")).toContainText("Source not found");
  });

  test("keyboard: open a source with Enter and focus moves to the inspector", async ({ page }) => {
    await page.goto("/sources");
    // Wait for streaming + hydration to settle before moving focus manually.
    await page.waitForLoadState("networkidle");
    const firstItem = items(page).first();
    await firstItem.focus();
    await expect(firstItem).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/source=/);
    await expect(inspector(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      inspector(page).getByRole("link", { name: "Close source inspector" }),
    ).toBeFocused();
  });

  test.describe("narrow viewport (390px)", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("inspector stacks above the list without horizontal overflow", async ({ page }) => {
      await page.goto(`/sources?source=${EDGE_EVIDENCE_ID}`);
      const panel = inspector(page);
      await expect(panel.getByTestId("trust-summary")).toBeVisible();

      const panelBox = (await panel.boundingBox())!;
      const listBox = (await page.getByTestId("evidence-list").boundingBox())!;
      expect(panelBox.y).toBeLessThan(listBox.y);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("selecting a source scrolls the inspector into view", async ({ page }) => {
      await page.goto("/sources");
      await expect(inspector(page)).toBeHidden();
      await items(page).nth(5).click();
      await expect(inspector(page)).toBeFocused();
      await expect(inspector(page)).toBeInViewport();
    });
  });
});
