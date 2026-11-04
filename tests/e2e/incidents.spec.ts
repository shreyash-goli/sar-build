import { expect, test, type APIRequestContext } from "@playwright/test";

// FS-13: a judge can reconstruct where $450 came from and see that no service
// has been shown to be suspended. Expected values come from the API, except
// the golden-path hero which is the point of the test.

const HERO = "inc-charge-cloudcomms-20261119";

type ListItem = { id: string; signal: string; amountCents: number | null };
async function fetchList(request: APIRequestContext, qs = ""): Promise<{ incidents: ListItem[]; total: number }> {
  const res = await request.get(`/api/incidents${qs}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

test.describe("Incidents", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("list matches the API order with FORECAST / OBSERVED DECLINE pills", async ({ page, request }) => {
    const data = await fetchList(request);
    await page.goto("/incidents");
    const items = page.getByTestId("incident-item");
    await expect(items).toHaveCount(data.incidents.length);
    for (const [i, inc] of data.incidents.entries()) {
      await expect(items.nth(i)).toHaveAttribute("data-incident-id", inc.id);
      await expect(items.nth(i).getByTestId("signal-pill")).toHaveAttribute("data-signal", inc.signal);
      await expect(items.nth(i).getByTestId("incident-amount")).not.toHaveText("$0.00");
    }
    await expect(page.getByTestId("signal-pill").filter({ hasText: "Observed decline" })).toHaveCount(
      data.incidents.filter((i) => i.signal === "OBSERVED_DECLINE").length,
    );
  });

  test("LOW / no-risk results are listed separately as healthy, not as alerts", async ({ page, request }) => {
    const data = await fetchList(request);
    type Sev = ListItem & { severity: string; category: string };
    const healthy = (data.incidents as Sev[]).filter((i) => i.severity === "LOW" || i.category === "NO_RISK");
    await page.goto("/incidents");
    const section = page.getByTestId("healthy-incidents");
    if (healthy.length === 0) {
      await expect(section).toHaveCount(0);
      return;
    }
    await expect(section).toContainText("Healthy, monitoring only");
    await expect(section.getByTestId("incident-item")).toHaveCount(healthy.length);
    for (const h of healthy) {
      await expect(page.getByTestId("incident-list").locator(`[data-incident-id="${h.id}"]`)).toHaveCount(0);
      await expect(section.locator(`[data-incident-id="${h.id}"]`)).toHaveAttribute("data-healthy", "true");
    }
    // Seed: ComputeHarbor is covered and must not read as an alert, nor as "Unknown".
    await expect(section).toContainText("ComputeHarbor");
    const ch = section.locator('[data-incident-id="inc-charge-computeharbor-20261121"]');
    await expect(ch.getByTestId("incident-amount")).toHaveText("No shortfall · $10,200.00 headroom");
    await expect(ch.getByTestId("incident-amount")).toHaveAttribute("data-tone", "healthy");

    await page.goto("/incidents/inc-charge-computeharbor-20261121");
    await expect(page.getByTestId("incident-amount")).toHaveText("No shortfall · $10,200.00 headroom");
    // The amount is never "Unknown" for a covered charge. (The runbook may still list "Still unknown"
    // caveats, e.g. vendor-side retries, which are legitimate and unrelated to the amount.)
    await expect(page.getByTestId("incident-amount")).not.toHaveText(/Unknown/);
  });

  test("filters and search query the engine output", async ({ page, request }) => {
    const declines = await fetchList(request, "?signal=OBSERVED_DECLINE");
    await page.goto("/incidents");
    await page.getByLabel("Signal").selectOption("OBSERVED_DECLINE");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/signal=OBSERVED_DECLINE/);
    await expect(page.getByTestId("incident-item")).toHaveCount(declines.incidents.length);

    await page.goto("/incidents?q=cloudcomms");
    await expect(page.getByTestId("incident-item").first()).toHaveAttribute("data-incident-id", HERO);

    await page.goto("/incidents?severity=BOGUS");
    await expect(page.getByTestId("invalid-incident-filter")).toContainText("severity");
  });

  test("hero detail: source path, exact calculation and the no-outage caveat", async ({ page }) => {
    await page.goto("/incidents");
    await page.locator(`[data-incident-id="${HERO}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/incidents/${HERO}$`));

    const detail = page.getByTestId("incident-detail");
    await expect(detail.getByTestId("signal-pill")).toHaveText("Forecast");
    await expect(detail.getByTestId("incident-amount")).toHaveText("$450.00");

    // Where $450 came from: expected charge minus available allocation.
    const steps = page.getByTestId("calculation-steps");
    await expect(steps).toContainText("Expected charge: $2,450.00");
    await expect(steps).toContainText("Available allocation: $2,000.00");
    await expect(steps).toContainText("$450.00");
    await expect(page.getByTestId("calculation-result")).toHaveText("$450.00");

    // Source path: fund -> card -> CloudComms -> OTP gateway -> Account login.
    const chains = page.getByTestId("confirmed-chains");
    for (const label of ["Auth Infrastructure fund", "CloudComms", "OTP gateway", "Account login"]) {
      await expect(chains.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByTestId("owners")).toContainText("Identity Platform");

    // Honesty: potential interruption only; vendor suspension unknown.
    await expect(page.getByTestId("caveats")).toContainText("whether the vendor would suspend service is unknown");

    // Evidence links to the source inspector; demo data is labelled.
    const evidence = page.getByTestId("evidence-panel");
    await expect(evidence).toContainText("DEMO DATA");
    await evidence.getByRole("link", { name: "Inspect source" }).first().click();
    await expect(page).toHaveURL(/\/sources\?source=/);
    await expect(page.getByTestId("source-inspector")).toBeVisible();
  });

  test("exact path link opens the graph with that chain isolated", async ({ page }) => {
    await page.goto(`/incidents/${HERO}`);
    await page.getByRole("link", { name: "Show this exact path on the graph" }).first().click();
    await expect(page).toHaveURL(/\/graph\?node=node-fund-auth&path=path%3A|\/graph\?node=node-fund-auth&path=path:/);
    await expect(page.getByTestId("canvas-summary")).toContainText("showing one exact path");
  });

  test("decline detail says it is not a confirmed outage", async ({ page }) => {
    await page.goto("/incidents/inc-tx-webhookworks-20261116");
    await expect(page.getByTestId("signal-pill")).toHaveText("Observed decline");
    await expect(page.getByTestId("calculation-decline")).toContainText("$299.00");
    await expect(page.getByTestId("caveats")).toContainText("This is not a confirmed outage");
  });

  test("unknown-data detail shows Unknown, never $0, and requested mappings", async ({ page }) => {
    await page.goto("/incidents/inc-charge-metricsrelay-20261124");
    await expect(page.getByTestId("incident-amount")).toHaveText("Unknown");
    await expect(page.getByTestId("calculation-unknown")).toContainText("Unknown");
    await expect(page.getByTestId("requested-mappings").locator("li")).toHaveCount(2);
    await expect(page.getByTestId("incident-detail")).not.toContainText("$0.00 shortfall");
  });

  test("Open Response Studio is a real link; unknown ids 404 honestly", async ({ page }) => {
    await page.goto(`/incidents/${HERO}`);
    await page.getByTestId("open-response-studio").click();
    await expect(page).toHaveURL(new RegExp(`/scenarios\\?incident=${HERO}`));

    await page.goto("/incidents/inc-does-not-exist");
    await expect(page.getByText("Incident not found")).toBeVisible();
    await expect(page).toHaveTitle("Incident not found · FailSafe");
  });
});

test.describe("Incidents (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("detail has no horizontal overflow", async ({ page }) => {
    await page.goto(`/incidents/${HERO}`);
    await expect(page.getByTestId("incident-detail")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
