import { expect, test, type Page } from "@playwright/test";

// FS-14 Response Studio. Each run appends a Simulation row (no dedupe), so
// every test is order-independent: it identifies its own run by the id the
// UI shows, never by position or by a total count.

const HERO = "inc-charge-cloudcomms-20261119";

async function openHero(page: Page) {
  await page.goto(`/scenarios?incident=${HERO}`);
  await expect(page.getByRole("heading", { level: 1, name: "Response Studio" })).toBeVisible();
  await expect(page.getByTestId("studio-incident")).toHaveAttribute("data-incident-id", HERO);
  await page.waitForLoadState("networkidle");
}

test.describe("Response Studio", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("SIMULATION ONLY is always visible, even before any run", async ({ page }) => {
    await page.goto("/scenarios");
    await expect(page.getByTestId("simulation-banner")).toHaveText(
      "SIMULATION ONLY: No Ramp funds or card limits were changed.",
    );
    await expect(page.getByText("Choose an incident to model a response")).toBeVisible();
    await page.getByTestId("incident-picker").locator(`[data-incident-id="${HERO}"]`).click();
    await expect(page).toHaveURL(new RegExp(`incident=${HERO}`));
    await expect(page.getByTestId("simulation-banner")).toBeVisible();
  });

  test("hero: +$600 turns a $450 CRITICAL shortfall into $0 / LOW with $150 margin", async ({ page }) => {
    await openHero(page);
    await page.getByLabel("Fund", { exact: true }).selectOption("fund-auth");
    await page.getByLabel("Add to available allocation (USD)").fill("600");
    await page.getByRole("button", { name: "Run simulation" }).click();

    const result = page.getByTestId("sim-result");
    await expect(result.getByTestId("sim-patch")).toContainText("+$600.00 available on fund-auth");
    await expect(result.getByTestId("sim-only-badge")).toHaveText("SIMULATION ONLY");

    await expect(result.getByTestId("before-shortfall")).toHaveText("$450.00");
    await expect(result.getByTestId("after-shortfall")).toHaveText("$0.00");
    await expect(result.getByTestId("after-margin")).toHaveText("$150.00");
    await expect(result.getByTestId("before-available")).toHaveText("$2,000.00");
    await expect(result.getByTestId("after-available")).toHaveText("$2,600.00");
    await expect(result.getByTestId("before-severity")).toHaveText("Critical");
    await expect(result.getByTestId("after-severity")).toHaveText("Low");
    await expect(result.locator('tr[data-field="shortfallCents"]')).toHaveAttribute("data-changed", "true");

    await expect(result.getByTestId("changed-inputs")).toContainText("fund-auth.availableCents");
    await expect(result.getByTestId("assumptions")).toContainText(
      "Modeled change; no Ramp funds or card limits were changed",
    );

    // First real toast caller: success toast, dismissible.
    const toast = page.locator('[data-slot="toast"]').filter({ hasText: "Simulation complete" });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("SIMULATION ONLY");
    await toast.getByRole("button", { name: /Dismiss notification/ }).click();
    await expect(toast).toHaveCount(0);

    // The run appears in the persisted history (order-independent: find it by id).
    const simId = await result.getAttribute("data-simulation-id");
    expect(simId).toMatch(/^sim-/);
    await page.reload();
    const entry = page.getByTestId("sim-history").locator(`[data-simulation-id="${simId}"]`);
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(page.getByTestId("sim-result")).toHaveAttribute("data-simulation-id", simId!);
    await expect(page.getByTestId("after-shortfall")).toHaveText("$0.00");

    // Base data untouched: the incident itself still shows the real shortfall.
    await page.goto(`/incidents/${HERO}`);
    await expect(page.getByTestId("incident-amount")).toHaveText("$450.00");
  });

  test("invalid amounts are rejected with a readable error and nothing runs", async ({ page }) => {
    await openHero(page);
    const shown = page.getByTestId("sim-result");
    const before = (await shown.count()) ? await shown.getAttribute("data-simulation-id") : null;
    for (const bad of ["-5", "abc", "1.234", "0"]) {
      await page.getByLabel("Add to available allocation (USD)").fill(bad);
      await page.getByRole("button", { name: "Run simulation" }).click();
      await expect(page.getByTestId("sim-error")).toBeVisible();
    }
    await expect(page.getByLabel("Add to available allocation (USD)")).toHaveAttribute("aria-invalid", "true");
    // No new result replaced the shown one.
    const after = (await shown.count()) ? await shown.getAttribute("data-simulation-id") : null;
    expect(after).toBe(before);
  });

  test("server rejections surface as readable errors and a danger toast", async ({ page }) => {
    await openHero(page);
    // Deterministic server-side 400: rescheduling a charge into the past is infeasible.
    await page.getByLabel("Reschedule the charge").check();
    await page.getByLabel("New charge date (UTC)").fill("2020-01-01");
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByTestId("sim-error")).toContainText("This change cannot be modeled");
    await expect(page.locator('[data-slot="toast"][data-variant="danger"]')).toContainText("Simulation not run");
  });

  test("View affected path opens the graph with the chain isolated", async ({ page }) => {
    await openHero(page);
    await page.getByLabel("Add to available allocation (USD)").fill("100");
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByTestId("sim-patch")).toContainText("+$100.00");
    await page.getByTestId("view-affected-path").click();
    await expect(page).toHaveURL(/\/graph\?node=node-fund-auth&path=/);
    await expect(page.getByTestId("canvas-summary")).toContainText("showing one exact path");
  });
});

test.describe("Response Studio (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("no horizontal overflow and the banner is visible", async ({ page }) => {
    await openHero(page);
    await expect(page.getByTestId("simulation-banner")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
