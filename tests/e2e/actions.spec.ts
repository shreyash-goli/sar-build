import { expect, test, type Page } from "@playwright/test";

// FS-15 approval-gated actions in the Response Studio. Every run appends rows,
// so each test captures its own action id from the propose response and never
// relies on list position or counts.

const HERO = "inc-charge-cloudcomms-20261119";

async function runHeroSimulation(page: Page, dollars: string) {
  await page.goto(`/scenarios?incident=${HERO}`);
  await expect(page.getByTestId("studio-incident")).toHaveAttribute("data-incident-id", HERO);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Fund", { exact: true }).selectOption("fund-auth");
  await page.getByLabel("Add to available allocation (USD)").fill(dollars);
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByTestId("sim-patch")).toContainText(`+$${dollars}.00`);
}

async function propose(page: Page, rationale: string): Promise<string> {
  await page.getByLabel("Rationale").fill(rationale);
  await page.getByLabel("Proposed by").fill("finance-ops");
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/actions/propose") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Create draft proposal" }).click(),
  ]);
  expect(res.status()).toBe(201);
  const id = (await res.json()).data.action.id as string;
  expect(id).toBeTruthy();
  return id;
}

test.describe("Approval-gated actions", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("draft → pending → approved for demo, with audit trail; never executed; survives reload", async ({
    page,
    request,
  }) => {
    await runHeroSimulation(page, "600");
    const id = await propose(page, "Cover the $450 CloudComms shortfall before the 19 Nov charge.");
    const card = page.locator(`[data-testid="action-card"][data-action-id="${id}"]`);

    await expect(card).toHaveAttribute("data-state", "DRAFT");
    await expect(card.getByTestId("action-notice")).toHaveText("SIMULATION ONLY: No Ramp funds changed");
    await expect(page.getByTestId("demo-identities-note")).toContainText("Demo identities, not authenticated");
    await expect(card.getByRole("button", { name: "Approve for demo" })).toHaveCount(0); // not allowed from DRAFT

    await card.getByRole("button", { name: "Submit for approval" }).click();
    await expect(card).toHaveAttribute("data-state", "PENDING_APPROVAL");

    // Self-approval is refused by the server with a readable reason.
    await card.getByLabel("Approver (must differ from proposer)").fill("finance-ops");
    await card.getByRole("button", { name: "Approve for demo" }).click();
    await expect(card.getByTestId("action-error")).toContainText("different person");
    await expect(card).toHaveAttribute("data-state", "PENDING_APPROVAL");

    await card.getByLabel("Approver (must differ from proposer)").fill("ops-lead");
    await card.getByRole("button", { name: "Approve for demo" }).click();
    await expect(card).toHaveAttribute("data-state", "APPROVED_FOR_DEMO");
    await expect(card.getByTestId("action-state")).toHaveText("Approved for demo");
    await expect(card.getByTestId("executed-externally")).toHaveText("Never: simulation only");

    const trail = card.getByTestId("audit-timeline").locator("li");
    await expect(trail).toHaveCount(3);
    await expect(trail.nth(0)).toHaveAttribute("data-audit-action", "action.proposed");
    await expect(trail.nth(1)).toHaveAttribute("data-audit-action", "action.submitted");
    await expect(trail.nth(2)).toHaveAttribute("data-audit-action", "action.approved_for_demo");
    await expect(page.getByTestId("approval-panel")).not.toContainText(/executed(?!\s+externally)|funds moved/i);

    // History survives navigation (server-stored).
    await page.goto("/dashboard");
    await page.goto(`/scenarios?incident=${HERO}`);
    const again = page.locator(`[data-testid="action-card"][data-action-id="${id}"]`);
    await expect(again).toHaveAttribute("data-state", "APPROVED_FOR_DEMO");
    await expect(again.getByTestId("audit-timeline").locator("li")).toHaveCount(3);

    // Duplicate approval is idempotent: no new audit event.
    const dup = await request.post(`/api/actions/${id}/approve`, { data: { approver: "ops-lead" } });
    expect(dup.status()).toBe(200);
    const body = await dup.json();
    expect(body.data.idempotent).toBe(true);
    expect(body.data.auditEventId).toBeNull();
    expect(body.data.action.history).toHaveLength(3);

    // Only the simulated plan changed: fund-auth is still $2,000 and the real shortfall is still $450.
    await page.goto(`/incidents/${HERO}`);
    await expect(page.getByTestId("incident-amount")).toHaveText("$450.00");
    await expect(page.getByTestId("calculation-steps")).toContainText("Available allocation: $2,000.00 (fund-auth");
  });

  test("reject requires a reason and ends the lifecycle", async ({ page }) => {
    await runHeroSimulation(page, "100");
    const id = await propose(page, "Smaller top-up to test whether a partial cover is enough.");
    const card = page.locator(`[data-testid="action-card"][data-action-id="${id}"]`);

    await card.getByText("Reject this proposal").click();
    await card.getByLabel("Reason (at least 10 characters)").fill("too short");
    await card.getByRole("button", { name: "Reject" }).click();
    await expect(card.getByTestId("action-error")).toContainText("at least 10 characters");

    await card.getByLabel("Reason (at least 10 characters)").fill("Does not cover the full shortfall; propose $600 instead.");
    await card.getByRole("button", { name: "Reject" }).click();
    await expect(card).toHaveAttribute("data-state", "REJECTED");
    await expect(card.getByRole("button", { name: /Submit for approval|Approve for demo|Reject/ })).toHaveCount(0);
    await expect(card.getByTestId("audit-timeline").locator("li").last()).toHaveAttribute("data-audit-action", "action.rejected");
  });

  test("an invalid transition shows a readable 409 error (state changed elsewhere)", async ({ page, request }) => {
    await runHeroSimulation(page, "600");
    const id = await propose(page, "Proposal used to exercise a forbidden transition.");
    const card = page.locator(`[data-testid="action-card"][data-action-id="${id}"]`);
    await card.getByRole("button", { name: "Submit for approval" }).click();
    await expect(card).toHaveAttribute("data-state", "PENDING_APPROVAL");

    // Another reviewer rejects it via the API while this page still offers "Approve".
    const rej = await request.post(`/api/actions/${id}/reject`, {
      data: { reviewer: "ops-lead", reason: "Rejected elsewhere to make this page stale." },
    });
    expect(rej.status()).toBe(200);

    await card.getByLabel("Approver (must differ from proposer)").fill("ops-lead");
    await card.getByRole("button", { name: "Approve for demo" }).click();
    await expect(card.getByTestId("action-error")).toContainText("not allowed from the current state");
    await expect(card.getByTestId("action-error")).toContainText("rejected");

    // After refresh the card shows the true state and no approve button.
    await page.reload();
    const fresh = page.locator(`[data-testid="action-card"][data-action-id="${id}"]`);
    await expect(fresh).toHaveAttribute("data-state", "REJECTED");
    await expect(fresh.getByRole("button", { name: "Approve for demo" })).toHaveCount(0);
  });

  test("a proposal needs a rationale", async ({ page }) => {
    await runHeroSimulation(page, "600");
    await page.getByLabel("Rationale").fill("short");
    await page.getByRole("button", { name: "Create draft proposal" }).click();
    await expect(page.getByTestId("propose-error")).toContainText("at least 10 characters");
  });
});
