import { expect, test, type Page } from "@playwright/test";

// Requires the seeded fictional Northstar demo (reset by the webServer command in playwright.config.ts).
// Hero path: Auth fund -> Auth card -> CloudComms -> OTP gateway -> Account login -> Customer checkout.

const node = (page: Page, id: string) => page.getByTestId(`graph-node-${id}`);
const rfNode = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);

async function openGraph(page: Page, qs = "") {
  await page.goto(`/graph${qs}`);
  await expect(page.getByRole("heading", { level: 1, name: "Dependency Graph" })).toBeVisible();
  await expect(node(page, "node-vendor-cloudcomms")).toBeVisible();
}

test.describe("Dependency graph", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("hero path is on screen and legible at 1440x900", async ({ page }) => {
    await openGraph(page);
    const hero = [
      "node-fund-auth",
      "node-card-auth",
      "node-vendor-cloudcomms",
      "node-service-otp-gateway",
      "node-workflow-account-login",
      "node-outcome-customer-checkout",
    ];
    for (const id of hero) await expect(node(page, id)).toBeInViewport();

    // Fit-to-view must not shrink labels below a legible zoom.
    const scale = await page
      .locator(".react-flow__viewport")
      .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
    expect(scale).toBeGreaterThanOrEqual(0.7);

    await expect(page.locator("body")).not.toContainText(/at risk/i);
  });

  test("selecting a vendor highlights every confirmed downstream workflow", async ({ page }, testInfo) => {
    await openGraph(page);
    await node(page, "node-vendor-cloudcomms").click();

    await expect(page).toHaveURL(/node=node-vendor-cloudcomms/);
    const panel = page.getByTestId("selection-panel");
    await expect(panel).toHaveAttribute("data-node-id", "node-vendor-cloudcomms");
    await expect(panel.getByTestId("confirmed-count")).toHaveText("2");
    const impacts = panel.getByTestId("confirmed-impacts");
    await expect(impacts.locator("[data-node-id]")).toHaveCount(2);
    await expect(impacts.locator('[data-node-id="node-workflow-account-login"]')).toBeVisible();
    await expect(impacts.locator('[data-node-id="node-outcome-customer-checkout"]')).toBeVisible();

    // Canvas emphasis: selected, downstream confirmed, upstream funding chain, everything else muted.
    await expect(node(page, "node-vendor-cloudcomms")).toHaveAttribute("data-emphasis", "selected");
    for (const id of ["node-service-otp-gateway", "node-workflow-account-login", "node-outcome-customer-checkout"]) {
      await expect(node(page, id)).toHaveAttribute("data-emphasis", "confirmed");
    }
    for (const id of ["node-fund-auth", "node-card-auth"]) {
      await expect(node(page, id)).toHaveAttribute("data-emphasis", "upstream");
    }
    for (const id of ["node-vendor-computeharbor", "node-workflow-oncall-escalation", "node-vendor-metricsrelay"]) {
      await expect(node(page, id)).toHaveAttribute("data-emphasis", "muted");
    }
    for (const edgeId of [
      "edge-vendor-cloudcomms--service-otp-gateway",
      "edge-service-otp-gateway--workflow-account-login",
      "edge-workflow-account-login--outcome-customer-checkout",
    ]) {
      await expect(page.getByTestId(`graph-edge-label-${edgeId}`)).toBeVisible();
    }
    await expect(page.getByTestId("canvas-summary")).toContainText("2 confirmed downstream");

    // Evidence for the selected node comes from GraphData.evidence and links to Sources.
    const evidence = panel.getByTestId("node-evidence");
    await expect(evidence).toContainText("DEMO DATA");
    await expect(evidence).toContainText("Unverified");
    await expect(evidence.getByRole("link", { name: "View source" })).toHaveAttribute(
      "href",
      "/sources?source=ev-node-vendor-cloudcomms",
    );
    await expect(panel.getByTestId("needs-mapping")).toHaveCount(0);

    await testInfo.attach("cloudcomms-selected", {
      body: await page.getByTestId("graph-canvas").screenshot(),
      contentType: "image/png",
    });

    // Clicking the empty pane clears the selection.
    await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
    await expect(page.getByTestId("selection-empty")).toBeVisible();
    await expect(page).not.toHaveURL(/node=/);
  });

  test("an exact path can be isolated", async ({ page }) => {
    await openGraph(page, "?node=node-vendor-cloudcomms");
    const pathButtons = page.getByTestId("selection-panel").locator("button[data-path-id]");
    await expect(pathButtons).toHaveCount(2);
    const loginOnly = pathButtons.filter({ hasNotText: "Customer checkout" });
    await loginOnly.click();
    await expect(loginOnly).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/path=/);
    await expect(node(page, "node-workflow-account-login")).toHaveAttribute("data-emphasis", "confirmed");
    await expect(node(page, "node-outcome-customer-checkout")).toHaveAttribute("data-emphasis", "muted");
  });

  test("needs-mapping vendor (MetricsRelay) is distinct and never counted as confirmed", async ({ page }) => {
    await openGraph(page);
    const metrics = node(page, "node-vendor-metricsrelay");
    await expect(metrics).toHaveAttribute("data-unknown", "true");
    await expect(metrics).toContainText("Needs mapping");
    await expect(node(page, "node-vendor-cloudcomms")).not.toHaveAttribute("data-unknown", "true");

    await metrics.click();
    const panel = page.getByTestId("selection-panel");
    await expect(panel.getByTestId("confirmed-count")).toHaveText("0");
    const mapping = panel.getByTestId("needs-mapping");
    await expect(mapping).toContainText("Billing method is unknown");
    await expect(mapping).toContainText("An upcoming charge has no funding source");
    await expect(mapping).toContainText("No confirmed card or fund pays this vendor");
    await expect(panel.getByTestId("possible-impacts")).toContainText("Weekly growth reporting");
    await expect(node(page, "node-workflow-growth-reporting")).toHaveAttribute("data-emphasis", "possible");
  });

  test("keyboard: Tab to a node and press Enter to select it", async ({ page }) => {
    await openGraph(page);
    await page.waitForLoadState("networkidle");
    const target = rfNode(page, "node-vendor-cloudcomms");
    await target.focus();
    await expect(target).toBeFocused();
    await expect(target).toHaveAttribute("aria-label", /Vendor: CloudComms/);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("selection-panel")).toHaveAttribute("data-node-id", "node-vendor-cloudcomms");
    await expect(page.getByTestId("graph-announcer")).toContainText("2 confirmed downstream");
  });

  test("text path list is a working alternative to the canvas", async ({ page }) => {
    await openGraph(page);
    const list = page.getByTestId("path-list");
    await expect(list.locator("li")).toHaveCount(4);
    const metricsPath = list.locator("li").filter({ hasText: "MetricsRelay" });
    await expect(metricsPath).toContainText("Needs mapping");
    await expect(metricsPath).toContainText("Includes suggested link");
    await metricsPath.getByRole("button", { name: /Show path on graph/ }).click();
    await expect(page.getByTestId("selection-panel")).toHaveAttribute("data-node-id", "node-vendor-metricsrelay");
  });

  test("search selects a single match and filters hide kinds without changing impact", async ({ page }) => {
    await openGraph(page);
    await page.getByLabel("Search nodes").fill("otp");
    await expect(page.locator("#graph-search-status")).toContainText("1 matching node");
    await page.getByLabel("Search nodes").press("Enter");
    await expect(page.getByTestId("selection-panel")).toHaveAttribute("data-node-id", "node-service-otp-gateway");

    await node(page, "node-vendor-cloudcomms").click();
    await page.getByText("Filters", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Services" }).uncheck({ force: true });
    await expect(node(page, "node-service-otp-gateway")).toHaveCount(0);
    await expect(page.getByTestId("filters-modified")).toBeVisible();
    // Blast radius is computed on the full graph, not the filtered drawing.
    await expect(page.getByTestId("confirmed-count")).toHaveText("2");

    await page.getByRole("button", { name: "Reset view" }).click();
    await expect(node(page, "node-service-otp-gateway")).toBeVisible();
    await expect(page.getByTestId("selection-empty")).toBeVisible();
  });
});

test.describe("Dependency graph (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("loads without horizontal overflow", async ({ page }) => {
    await openGraph(page, "?node=node-vendor-cloudcomms");
    await expect(page.getByTestId("canvas-summary")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
