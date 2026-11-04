import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// FS-20 in-app alert center. Ack/snooze mutate state, so this spec belongs to the
// "state-mutations" project. Each test reads current state from /api/alerts and
// asserts the same end state whether or not an earlier run already acted.

const HERO_INCIDENT = "inc-charge-cloudcomms-20261119";
const DECLINE_INCIDENT = "inc-tx-webhookworks-20261116";
const NOTICE = "In-app only: no external notification sent";

type Alert = { id: string; incidentId: string; displayState: string; kind: string; severity: string; link: string };
type List = {
  alerts: Alert[];
  counts: { active: number; snoozed: number; acknowledged: number; total: number };
  snoozeHint: string | null;
};

async function list(request: APIRequestContext, view: "active" | "all"): Promise<List> {
  const res = await request.get(`/api/alerts?view=${view}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data as List;
}

async function openCenter(page: Page) {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("alert-bell").click();
  const center = page.getByTestId("alert-center");
  await expect(center).toBeVisible();
  await expect(center.getByTestId("alert-list").or(center.getByTestId("alerts-empty"))).toBeVisible();
  return center;
}

test.describe("Alert center", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("bell count, alert details, in-app wording and deep link", async ({ page, request }) => {
    const active = await list(request, "active");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    const bell = page.getByTestId("alert-bell");
    await expect(bell).toHaveAttribute("aria-label", `Alerts: ${active.counts.active} active`);

    const center = await openCenter(page);
    await expect(center.getByTestId("alert-center-notice")).toContainText(NOTICE);
    await expect(center.getByTestId("alert-identity-note")).toHaveText("Demo identity, not authenticated.");
    const cards = center.getByTestId("alert-card");
    await expect(cards).toHaveCount(active.alerts.length);
    for (const [i, a] of active.alerts.entries()) {
      const card = cards.nth(i);
      await expect(card).toHaveAttribute("data-alert-id", a.id);
      await expect(card.getByTestId("alert-notice")).toHaveText(NOTICE);
      await expect(card.getByTestId("alert-link")).toHaveAttribute("href", a.link);
      await expect(card).toContainText("Source");
      await expect(card).toContainText("Owner");
    }

    // Never claim anything was sent externally (the mandated notice aside).
    const text = (await center.innerText()).replaceAll(NOTICE, "");
    expect(text).not.toMatch(/\b(sent|notified|emailed)\b/i);

    // Deep link opens the incident and closes the drawer.
    if (active.alerts.length) {
      const first = active.alerts[0]!;
      await cards.first().getByTestId("alert-link").click();
      await expect(page).toHaveURL(new RegExp(`${first.link}$`));
      await expect(center).toBeHidden();
    }
  });

  test("acknowledge moves an alert to history and lowers the bell count", async ({ page, request }) => {
    const all = await list(request, "all");
    const hero = all.alerts.find((a) => a.incidentId === HERO_INCIDENT);
    test.skip(!hero, "no alert for the hero incident in this dataset");

    const center = await openCenter(page);
    if (hero!.displayState !== "ACKNOWLEDGED") {
      const before = await list(request, "active");
      const card = center.locator(`[data-testid="alert-card"][data-alert-id="${hero!.id}"]`);
      await center.getByLabel("Acting as").fill("ops-lead");
      await card.getByRole("button", { name: "Acknowledge" }).click();
      await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Acknowledgement recorded" })).toBeVisible();
      await expect(card).toHaveCount(0); // gone from the Active view
      const after = await list(request, "active");
      expect(after.counts.active).toBe(before.counts.active - (hero!.displayState === "ACTIVE" ? 1 : 0));
    }

    await center.getByTestId("alert-tab-all").click();
    const hist = center.locator(`[data-testid="alert-card"][data-alert-id="${hero!.id}"]`);
    await expect(hist).toHaveAttribute("data-display-state", "ACKNOWLEDGED");
    await expect(hist.getByTestId("alert-status")).toContainText("Acknowledged by");
    await expect(hist.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);

    // Snoozing an acknowledged alert is refused (409) rather than silently applied.
    const res = await request.post(`/api/alerts/${hero!.id}/snooze`, {
      data: { actor: "ops-lead", until: "2026-11-18T16:00:00Z" },
    });
    expect(res.status()).toBe(409);
  });

  test("snooze hides an alert and shows the frozen-clock hint", async ({ page, request }) => {
    const all = await list(request, "all");
    const decline = all.alerts.find((a) => a.incidentId === DECLINE_INCIDENT);
    test.skip(!decline || decline.displayState === "ACKNOWLEDGED", "decline alert missing or already acknowledged");

    const center = await openCenter(page);
    if (decline!.displayState === "ACTIVE") {
      const card = center.locator(`[data-testid="alert-card"][data-alert-id="${decline!.id}"]`);
      await card.getByLabel("Snooze for").selectOption("1");
      await card.getByRole("button", { name: "Snooze" }).click();
      await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Snooze recorded" })).toBeVisible();
      await expect(card).toHaveCount(0);
    }

    const after = await list(request, "all");
    expect(after.alerts.find((a) => a.id === decline!.id)!.displayState).toBe("SNOOZED");
    expect(after.counts.snoozed).toBeGreaterThan(0);
    if (after.snoozeHint) await expect(center.getByTestId("snooze-hint")).toHaveText(after.snoozeHint);

    await center.getByTestId("alert-tab-all").click();
    await expect(
      center.locator(`[data-testid="alert-card"][data-alert-id="${decline!.id}"]`).getByTestId("alert-status"),
    ).toContainText("Snoozed until");
  });

  test("Escape closes the drawer and returns focus to the bell", async ({ page }) => {
    const center = await openCenter(page);
    await page.keyboard.press("Escape");
    await expect(center).toBeHidden();
    await expect(page.getByTestId("alert-bell")).toBeFocused();
  });
});
