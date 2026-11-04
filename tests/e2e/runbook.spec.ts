import { expect, test, type Page } from "@playwright/test";

// FS-16: each hero incident has a specific checklist and next owner, with
// dependencies and unknowns shown; steps are copyable and never automatic.
// Values are compared with /api/incidents/[id] (the runbook is derived there).
//
// The incident page streams behind loading.tsx: its content first arrives in a
// hidden Suspense container and is swapped in moments later. Under a busy full
// suite that swap can exceed the default assertion timeout, so each test waits
// for the page to settle and the checklist to be VISIBLE before inspecting it.

const HERO = "inc-charge-cloudcomms-20261119";

type Step = { id: string; title: string; dependsOn: string[]; unknowns: string[]; copyText: string; owner: { name: string | null } };
type Runbook = { title: string; nextOwner: { name: string | null }; steps: Step[]; disclaimer: string };

async function openRunbook(page: Page, incidentId: string) {
  await page.goto(`/incidents/${incidentId}`);
  await page.waitForLoadState("networkidle");
  const rb = page.getByTestId("runbook");
  await expect(rb).toBeVisible({ timeout: 15_000 });
  return rb;
}

test.describe("Response checklist (runbook)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("hero incident: specific checklist, next owner, dependencies, copy, never automatic", async ({ page, context, request }) => {
    const res = await request.get(`/api/incidents/${HERO}`);
    expect(res.ok()).toBeTruthy();
    const runbook = (await res.json()).data.runbook as Runbook;

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const rb = await openRunbook(page, HERO);
    await expect(rb.getByTestId("runbook-title")).toHaveText(runbook.title);
    await expect(rb.getByTestId("runbook-title")).toContainText("$450.00");
    await expect(rb.getByTestId("runbook-next-owner")).toContainText("Finance Ops");
    await expect(rb.getByTestId("runbook-disclaimer")).toHaveText(runbook.disclaimer);

    const steps = rb.getByTestId("runbook-steps").locator("li[data-step-id]");
    await expect(steps).toHaveCount(runbook.steps.length);
    for (const [i, s] of runbook.steps.entries()) {
      await expect(steps.nth(i)).toHaveAttribute("data-step-id", s.id);
      await expect(steps.nth(i)).toContainText(s.title);
      await expect(steps.nth(i)).toContainText("Manual step");
      if (s.dependsOn.length) await expect(steps.nth(i).getByTestId("step-after")).toBeVisible();
      if (s.unknowns.length) await expect(steps.nth(i).getByTestId("step-unknowns")).toBeVisible();
    }
    await expect(rb).toContainText("Request a limit review of at least $450.00");
    await expect(rb).not.toContainText(/\b(done|completed|automatically (contacted|raised|moved))\b/i);

    // Copy a step: clipboard gets exactly the server's copyText.
    await steps.nth(0).getByTestId("copy-step").click();
    await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Copied step 1" })).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(runbook.steps[0]!.copyText);
    expect(clip).toContain("Manual step: FailSafe does not perform this automatically.");
  });

  test("unknown-data incident shows an unassigned owner rather than guessing", async ({ page, request }) => {
    const id = "inc-charge-metricsrelay-20261124";
    const runbook = (await (await request.get(`/api/incidents/${id}`)).json()).data.runbook as Runbook;
    const rb = await openRunbook(page, id);
    await expect(rb.getByTestId("runbook-steps").locator("li[data-step-id]")).toHaveCount(runbook.steps.length);
    if (runbook.steps.some((s) => s.owner.name === null)) {
      await expect(rb.getByTestId("step-owner").filter({ hasText: "Unassigned", visible: true }).first()).toBeVisible();
    }
  });
});
