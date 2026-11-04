import { expect, test, type Page } from "@playwright/test";

// FS-17 / T-21 golden path, end to end in one test:
// shortfall -> incident -> exact graph path -> evidence -> Response Studio (+$600) ->
// propose / submit / approve (two demo identities) -> base unchanged -> reset -> seeded state.
// Robust to prior runs: it starts with a same-origin API reset (the DB accumulates within a run);
// the final reset goes through the shell "Reset demo" button (confirm dialog + toast).

const HERO = "inc-charge-cloudcomms-20261119";
const LOGIN_PATH_NODES = [
  "node-card-auth",
  "node-vendor-cloudcomms",
  "node-service-otp-gateway",
  "node-workflow-account-login",
];

/** Click a control and wait for the API call it triggers (avoids clicks lost during a re-render). */
async function clickAndWait(page: Page, click: () => Promise<void>, path: RegExp, status = 200) {
  await page.waitForLoadState("networkidle");
  const [res] = await Promise.all([
    page.waitForResponse((r) => path.test(new URL(r.url()).pathname) && r.request().method() === "POST"),
    click(),
  ]);
  expect(res.status(), await res.text()).toBe(status);
  await page.waitForLoadState("networkidle");
  return res;
}

async function resetDemo(page: Page) {
  // Same-origin POST through the page's request context (the endpoint refuses cross-site/non-local calls).
  const origin = new URL(page.url() === "about:blank" ? test.info().project.use.baseURL! : page.url()).origin;
  const res = await page.request.post("/api/demo/reset", { headers: { origin } });
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  expect(body.data.incidents.regenerated).toBe(4);
  expect(body.data.recreated).toMatchObject({ evidence: 49, edges: 15, nodes: 18 });
}

test.describe("Golden path (hero)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("shortfall → graph → evidence → simulation → approval → base unchanged → reset", async ({ page }) => {
    test.setTimeout(120_000);
    await resetDemo(page);

    // 1. Overview: $450.00 potential shortfall, CloudComms ranked first.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByTestId("kpi-potential-shortfall-value")).toHaveText("$450.00");
    const top = page.getByTestId("exposure-list").locator("li[data-incident-id]").first();
    await expect(top).toHaveAttribute("data-incident-id", HERO);
    await expect(top).toContainText("CloudComms");
    await expect(top.getByTestId("exposure-amount")).toHaveText("$450.00");

    // 2. Click through to the hero incident: exact calculation and the honesty caveat.
    await top.getByTestId("exposure-link").click();
    await expect(page).toHaveURL(new RegExp(`/incidents/${HERO}$`));
    await expect(page.getByTestId("incident-amount")).toHaveText("$450.00");
    const steps = page.getByTestId("calculation-steps");
    await expect(steps).toContainText("Expected charge: $2,450.00");
    await expect(steps).toContainText("Available allocation: $2,000.00");
    await expect(page.getByTestId("calculation-result")).toHaveText("$450.00");
    await expect(page.getByTestId("caveats")).toContainText("suspend service is unknown");

    // 3. Exact path link: the hero chain is isolated and highlighted on the graph.
    await page.getByRole("link", { name: "Show this exact path on the graph" }).first().click();
    await expect(page).toHaveURL(/\/graph\?node=node-fund-auth&path=/);
    await expect(page.getByTestId("canvas-summary")).toContainText("showing one exact path");
    await expect(page.getByTestId("graph-node-node-fund-auth")).toHaveAttribute("data-emphasis", "selected");
    for (const id of LOGIN_PATH_NODES) {
      await expect(page.getByTestId(`graph-node-${id}`), id).toHaveAttribute("data-emphasis", "confirmed");
    }
    await expect(page.getByTestId("graph-node-node-vendor-computeharbor")).toHaveAttribute("data-emphasis", "muted");

    // 4. Evidence: "Inspect source" opens Sources with the DEMO DATA label.
    await page.goto(`/incidents/${HERO}`);
    const evidence = page.getByTestId("evidence-panel");
    await expect(evidence).toContainText("DEMO DATA");
    await evidence.getByRole("link", { name: "Inspect source" }).first().click();
    await expect(page).toHaveURL(/\/sources\?source=/);
    const inspector = page.getByTestId("source-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector.getByTestId("simulation-badge")).toHaveText("DEMO DATA");

    // 5. Response Studio: +$600 models $0.00 shortfall and $150.00 margin, SIMULATION ONLY.
    await page.goto(`/incidents/${HERO}`);
    await page.getByTestId("open-response-studio").click();
    await expect(page).toHaveURL(new RegExp(`/scenarios\\?incident=${HERO}`));
    await expect(page.getByTestId("studio-incident")).toHaveAttribute("data-incident-id", HERO);
    await expect(page.getByTestId("simulation-banner")).toContainText("SIMULATION ONLY");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Fund", { exact: true }).selectOption("fund-auth");
    await page.getByLabel("Add to available allocation (USD)").fill("600");
    await clickAndWait(page, () => page.getByRole("button", { name: "Run simulation" }).click(), /^\/api\/scenarios\/run$/, 201);
    const result = page.getByTestId("sim-result");
    await expect(result.getByTestId("sim-patch")).toContainText("+$600.00 available on fund-auth");
    await expect(result.getByTestId("sim-only-badge")).toHaveText("SIMULATION ONLY");
    await expect(result.getByTestId("before-shortfall")).toHaveText("$450.00");
    await expect(result.getByTestId("after-shortfall")).toHaveText("$0.00");
    await expect(result.getByTestId("after-margin")).toHaveText("$150.00");
    await expect(result.getByTestId("after-severity")).toHaveText("Low");

    // 6. Propose -> submit -> approve with two distinct demo identities.
    await page.getByLabel("Rationale").fill("Cover the modeled $450 CloudComms shortfall before the 19 Nov charge.");
    await page.getByLabel("Proposed by").fill("demo-analyst");
    const proposed = await clickAndWait(
      page,
      () => page.getByRole("button", { name: "Create draft proposal" }).click(),
      /^\/api\/actions\/propose$/,
      201,
    );
    const actionId = (await proposed.json()).data.action.id as string;
    const card = page.locator(`[data-testid="action-card"][data-action-id="${actionId}"]`);
    await expect(card).toHaveAttribute("data-state", "DRAFT");
    await expect(card.getByTestId("action-notice")).toHaveText("SIMULATION ONLY: No Ramp funds changed");
    await clickAndWait(page, () => card.getByRole("button", { name: "Submit for approval" }).click(), /\/submit$/);
    await expect(card).toHaveAttribute("data-state", "PENDING_APPROVAL");
    await card.getByLabel("Approver (must differ from proposer)").fill("demo-finance-approver");
    await clickAndWait(page, () => card.getByRole("button", { name: "Approve for demo" }).click(), /\/approve$/);
    await expect(card).toHaveAttribute("data-state", "APPROVED_FOR_DEMO");
    await expect(card.getByTestId("action-state")).toHaveText("Approved for demo");
    await expect(card.getByTestId("executed-externally")).toContainText("Never");
    await expect(card.getByTestId("audit-timeline").locator("li")).toHaveCount(3);

    // 7. Base data unchanged: the incident still shows the real $450.00 shortfall on $2,000.00 available.
    await page.goto(`/incidents/${HERO}`);
    await expect(page.getByTestId("incident-amount")).toHaveText("$450.00");
    await expect(page.getByTestId("calculation-steps")).toContainText("Available allocation: $2,000.00");

    // 8. Reset through the shell "Reset demo" button: confirm, toast, then the seeded state.
    await page.goto("/dashboard");
    await page.getByTestId("reset-demo-open").filter({ visible: true }).first().click();
    const dialog = page.getByTestId("reset-demo-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Reset the demo data?");
    const [resetRes] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === "/api/demo/reset" && r.request().method() === "POST"),
      dialog.getByTestId("reset-demo-confirm").click(),
    ]);
    expect(resetRes.status(), await resetRes.text()).toBe(200);
    expect((await resetRes.json()).data.incidents.regenerated).toBe(4);
    const toast = page.locator('[data-slot="toast"]').filter({ hasText: "Demo reset" });
    await expect(toast).toBeVisible();
    await expect(dialog).toBeHidden();
    await page.waitForLoadState("networkidle");

    await page.goto("/dashboard");
    await expect(page.getByTestId("kpi-potential-shortfall-value")).toHaveText("$450.00");
    await expect(page.getByTestId("exposure-list").locator("li[data-incident-id]").first()).toHaveAttribute("data-incident-id", HERO);
    await page.goto(`/scenarios?incident=${HERO}`);
    await expect(page.getByTestId("studio-incident")).toHaveAttribute("data-incident-id", HERO);
    await expect(page.getByText("No simulations have been run for this incident.")).toBeVisible();
    await expect(page.getByTestId("sim-history")).toHaveCount(0);
    await expect(page.locator(`[data-testid="action-card"][data-action-id="${actionId}"]`)).toHaveCount(0);

    // Seeded in-app alerts (FS-20): one CREATED alert per risky incident, nothing sent externally.
    const alerts = await page.request.get("/api/alerts");
    expect(alerts.status()).toBe(200);
    const a = (await alerts.json()).data;
    expect(a.counts).toEqual({ active: 3, snoozed: 0, acknowledged: 0, total: 3 });
    expect(a.alerts.map((x: { kind: string }) => x.kind)).toEqual(["CREATED", "CREATED", "CREATED"]);
    expect(a.alerts.map((x: { incidentId: string }) => x.incidentId)).toContain(HERO);
    expect(a.notice).toBe("In-app only: no external notification sent");
  });
});
