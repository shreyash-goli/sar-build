import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { SAMPLE_REPO_FILES, SAMPLE_REPO_SERVICE_NODE_ID } from "@/fixtures/sample-repo";

// FS-08 graph provenance inspector and reviewer controls.
// Reviews mutate data, so each test reads the current edge state from
// /api/graph first and asserts the same end state whether or not an earlier
// run already reviewed the edge. The confirm and reject tests use different
// edges so they never interfere.

const HERO_EDGE = "edge-vendor-cloudcomms--service-otp-gateway";
const SUGGESTED_EDGE = "edge-service-product-analytics--workflow-growth-reporting";
const IMPORTED_EDGE = "edge-vendor-computeharbor--service-incident-monitoring";

type Edge = { id: string; reviewStatus: string; evidenceId: string };
async function edgeStatus(request: APIRequestContext, id: string): Promise<Edge | undefined> {
  const res = await request.get("/api/graph");
  expect(res.ok()).toBeTruthy();
  return ((await res.json()).data.edges as Edge[]).find((e) => e.id === id);
}

async function openGraph(page: Page) {
  await page.goto("/graph");
  await expect(page.getByTestId("graph-node-node-vendor-cloudcomms")).toBeVisible();
  await page.waitForLoadState("networkidle");
}

const inspector = (page: Page) => page.getByTestId("edge-inspector");

/**
 * Click an edge like a user does: at the centre of its drawn line. Playwright's
 * actionability check treats SVG edge groups (and a straight path's zero-height
 * box) as "not visible", but the 20px interaction path is the real hit target there.
 */
async function clickEdge(page: Page, edgeId: string) {
  const box = await page.getByTestId(`rf__edge-${edgeId}`).boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest("[data-id]")?.getAttribute("data-id"), [x, y]);
  expect(hit).toBe(edgeId);
  await page.mouse.click(x, y);
}

test.describe("Graph edge inspector and review", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("clicking CloudComms → OTP gateway explains why the edge exists", async ({ page }) => {
    await openGraph(page);
    await clickEdge(page, HERO_EDGE);

    const drawer = inspector(page);
    await expect(drawer).toHaveAttribute("data-edge-id", HERO_EDGE);
    await expect(drawer.getByRole("heading", { name: /CloudComms\s+POWERS\s+OTP gateway/ })).toBeVisible();
    await expect(drawer.getByTestId("edge-review-status")).toHaveText("Confirmed");
    await expect(drawer.getByText("Why this edge exists")).toBeVisible();
    await expect(drawer.getByTestId("edge-evidence-excerpt")).toContainText("CloudComms POWERS OTP gateway");
    await expect(drawer.getByTestId("edge-evidence-method")).toHaveAttribute("data-method", "FIXTURE");
    await expect(drawer).toContainText("northstar-demo-fixture");
    await expect(drawer).toContainText("DEMO DATA");
    // Never offer review on a confirmed edge.
    await expect(drawer.getByRole("button", { name: /Confirm edge|Reject edge/ })).toHaveCount(0);

    await drawer.getByRole("link", { name: "Open in Sources" }).click();
    await expect(page).toHaveURL(/\/sources\?source=ev-edge-vendor-cloudcomms--service-otp-gateway/);
  });

  test("keyboard: Tab to an edge (or use the text list) and press Enter to inspect; Escape closes", async ({ page }) => {
    await openGraph(page);
    const edge = page.getByTestId(`rf__edge-${HERO_EDGE}`);
    await edge.focus();
    await page.keyboard.press("Enter");
    await expect(inspector(page)).toHaveAttribute("data-edge-id", HERO_EDGE);
    await page.keyboard.press("Escape");
    await expect(inspector(page)).toHaveCount(0);

    await page.locator(`[data-inspect-edge="${HERO_EDGE}"]`).first().click();
    await expect(inspector(page)).toHaveAttribute("data-edge-id", HERO_EDGE);
  });

  test("confirming MetricsRelay's suggested edge makes it solid and adds growth reporting to confirmed impact", async ({
    page,
    request,
  }) => {
    const before = await edgeStatus(request, SUGGESTED_EDGE);
    expect(before).toBeDefined();
    test.skip(before!.reviewStatus === "REJECTED", "edge was rejected by another run; confirm path not applicable");

    await openGraph(page);
    if (before!.reviewStatus === "SUGGESTED") {
      await expect(page.getByTestId(`rf__edge-${SUGGESTED_EDGE}`)).toHaveAttribute("data-review-status", "SUGGESTED");
      await page.locator(`[data-inspect-edge="${SUGGESTED_EDGE}"]`).first().click();
      const drawer = inspector(page);
      await expect(drawer.getByTestId("reviewer-identity-note")).toHaveText("Demo reviewer identity, not authenticated.");

      // Justification is required.
      await drawer.getByLabel("Justification (at least 10 characters)").fill("ok");
      await drawer.getByRole("button", { name: "Confirm edge" }).click();
      await expect(drawer.getByTestId("review-error")).toContainText("at least 10 characters");

      await drawer.getByLabel("Reviewer").fill("growth-lead");
      await drawer
        .getByLabel("Justification (at least 10 characters)")
        .fill("The weekly growth report reads Product analytics exports every Monday.");
      await drawer.getByRole("button", { name: "Confirm edge" }).click();
      await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Edge confirmed" })).toBeVisible();
    }

    // End state (either just confirmed, or confirmed by an earlier run).
    await expect(page.getByTestId(`rf__edge-${SUGGESTED_EDGE}`)).toHaveAttribute("data-review-status", "CONFIRMED");
    await page.locator(`[data-inspect-edge="${SUGGESTED_EDGE}"]`).first().click();
    const drawer = inspector(page);
    await expect(drawer.getByTestId("edge-review-status")).toHaveText("Confirmed");
    await expect(drawer.getByTestId("edge-evidence-method")).toHaveAttribute("data-method", "MANUAL");
    await expect(drawer).toContainText("Verified by a reviewer");
    await expect(drawer.getByRole("button", { name: /Confirm edge|Reject edge/ })).toHaveCount(0);
    await drawer.getByRole("button", { name: "Close edge inspector" }).click();

    // Impact recomputed: MetricsRelay now reaches Weekly growth reporting through confirmed edges only.
    await page.getByTestId("graph-node-node-vendor-metricsrelay").click();
    await expect(page.getByTestId("confirmed-impacts")).toContainText("Weekly growth reporting");
    await expect(page.getByTestId("possible-impacts")).toHaveCount(0);

    // A repeat review is refused (409), never silently re-applied.
    const again = await request.post(`/api/graph/edges/${SUGGESTED_EDGE}/review`, {
      data: { decision: "CONFIRM", reviewer: "growth-lead", justification: "Trying to confirm a second time." },
    });
    expect(again.status()).toBe(409);
  });

  test("rejecting an imported suggestion removes it from the graph and the possible impact", async ({ page, request }) => {
    // Idempotent: a re-import returns duplicates and never creates new edges.
    const imp = await request.post("/api/imports/manifest", {
      data: { serviceNodeId: SAMPLE_REPO_SERVICE_NODE_ID, importedBy: "e2e-importer", files: SAMPLE_REPO_FILES },
    });
    expect(imp.status()).toBe(201);
    const before = await edgeStatus(request, IMPORTED_EDGE);
    expect(before).toBeDefined();
    test.skip(before!.reviewStatus === "CONFIRMED", "edge was confirmed by another run; reject path not applicable");

    await openGraph(page);
    if (before!.reviewStatus === "SUGGESTED") {
      await page.locator(`[data-inspect-edge="${IMPORTED_EDGE}"]`).first().click();
      const drawer = inspector(page);
      await expect(drawer.getByTestId("edge-evidence-method")).toHaveAttribute("data-method", "MANIFEST");
      await drawer.getByText("Reject", { exact: true }).click();
      await drawer.getByLabel("Reviewer").fill("platform-lead");
      await drawer
        .getByLabel("Justification (at least 10 characters)")
        .fill("main.tf only references ComputeHarbor for a staging bucket; not used by monitoring.");
      await drawer.getByRole("button", { name: "Reject edge" }).click();
      await expect(page.locator('[data-slot="toast"]').filter({ hasText: "Edge rejected" })).toBeVisible();
      await expect(drawer.getByTestId("edge-review-status")).toHaveText("Rejected");
    }

    // Rejected edges are hidden by default and never offered for review again.
    await expect(page.getByTestId(`rf__edge-${IMPORTED_EDGE}`)).toHaveCount(0);
    const after = await edgeStatus(request, IMPORTED_EDGE);
    expect(after!.reviewStatus).toBe("REJECTED");
  });
});
