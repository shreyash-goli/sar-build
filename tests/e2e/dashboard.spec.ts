import { expect, test, type APIRequestContext } from "@playwright/test";

// Every figure on the Overview must equal the engine output served by
// /api/dashboard (no hardcoded values in the UI). Seed values are asserted
// only where the golden path is the point of the test.

type Exposure = {
  incidentId: string;
  vendorId: string | null;
  amountCents: number | null;
  severity: string;
  topWorkflow: { nodeId: string; label: string } | null;
};
type Dashboard = {
  metrics: {
    atRiskWorkflows: { value: number; definition: string };
    unresolvedExposures: { value: number; definition: string };
    potentialShortfall: { knownCents: number; unknownCount: number; definition: string };
  };
  exposures: Exposure[];
  topImpactedWorkflows: { nodeId: string }[];
  forecast: { vendorId: string }[];
};

async function fetchDashboard(request: APIRequestContext): Promise<Dashboard> {
  const res = await request.get("/api/dashboard");
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data as Dashboard;
}

const usd = (cents: number) =>
  `$${Math.trunc(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;

test.describe("Overview dashboard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("KPI tiles equal the engine output and carry their definitions", async ({ page, request }) => {
    const d = await fetchDashboard(request);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

    await expect(page.getByTestId("kpi-at-risk-workflows-value")).toHaveText(String(d.metrics.atRiskWorkflows.value));
    await expect(page.getByTestId("kpi-unresolved-exposures-value")).toHaveText(
      String(d.metrics.unresolvedExposures.value),
    );
    await expect(page.getByTestId("kpi-potential-shortfall-value")).toHaveText(usd(d.metrics.potentialShortfall.knownCents));
    if (d.metrics.potentialShortfall.unknownCount > 0) {
      await expect(page.getByTestId("kpi-potential-shortfall-unknown")).toContainText("not added as $0");
    }

    // Definitions are disclosed on demand, verbatim from the API.
    const tile = page.getByTestId("kpi-potential-shortfall");
    await tile.getByText("How this is counted").click();
    await expect(page.getByTestId("kpi-potential-shortfall-definition")).toHaveText(
      d.metrics.potentialShortfall.definition,
    );

    // Golden path sanity (fictional Northstar seed).
    expect(d.metrics.potentialShortfall.knownCents).toBe(45000);
    await expect(page.getByTestId("kpi-potential-shortfall-value")).toHaveText("$450.00");
  });

  test("exposures keep the engine's ranking and never show unknown as $0", async ({ page, request }) => {
    const d = await fetchDashboard(request);
    await page.goto("/dashboard");
    const rows = page.getByTestId("exposure-list").locator("li[data-incident-id]");
    await expect(rows).toHaveCount(d.exposures.length);
    for (const [i, x] of d.exposures.entries()) {
      const row = rows.nth(i);
      await expect(row).toHaveAttribute("data-incident-id", x.incidentId);
      await expect(row.getByTestId("exposure-amount")).toHaveText(x.amountCents === null ? "Unknown" : usd(x.amountCents));
    }
    await expect(page.getByTestId("exposure-list")).not.toContainText("$0.00");
  });

  test("click-through opens the graph with the workflow selected", async ({ page, request }) => {
    const d = await fetchDashboard(request);
    const hero = d.exposures[0]!;
    test.skip(!hero.topWorkflow, "top exposure has no workflow");
    await page.goto("/dashboard");
    await page
      .getByTestId("exposure-list")
      .locator(`li[data-incident-id="${hero.incidentId}"]`)
      .getByRole("link", { name: hero.topWorkflow!.label })
      .click();
    await expect(page).toHaveURL(new RegExp(`/graph\\?node=${hero.topWorkflow!.nodeId}`));
    await expect(page.getByTestId("selection-panel")).toHaveAttribute("data-node-id", hero.topWorkflow!.nodeId);
  });

  test("forecast renders one panel per vendor with a table view", async ({ page, request }) => {
    const d = await fetchDashboard(request);
    await page.goto("/dashboard");
    const forecast = page.getByTestId("forecast");
    await expect(forecast.locator("figure[data-vendor-id]")).toHaveCount(d.forecast.length);
    await forecast.getByText("View forecast as a table").click();
    await expect(page.getByTestId("forecast-table")).toBeVisible();
  });
});

test.describe("Overview dashboard (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("no horizontal overflow", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("kpi-at-risk-workflows")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
