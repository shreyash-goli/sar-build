import { expect, test } from "@playwright/test";

// FS-18 / FS-19 integrations status on the Sources page. Read-only (no sync is
// triggered), so this spec runs in the main project. Expected states come from
// the APIs; the e2e environment has no Ramp or LLM credentials.

type RampStatus = { status: string; missing: string[]; syncAllowed: boolean; notice: string; label: string };
type AiStatus = { status: string; missing: string[]; notice: string };

test.describe("Integrations status", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("shows Ramp and AI state honestly, never secret values", async ({ page, request }) => {
    const ramp = (await (await request.get("/api/integrations/ramp/status")).json()).data as RampStatus;
    const ai = (await (await request.get("/api/integrations/ai/status")).json()).data as AiStatus;

    await page.goto("/sources");
    const panel = page.getByTestId("integrations-panel");
    await expect(panel).toBeVisible();

    const rampRow = panel.getByTestId("ramp-status");
    await expect(rampRow).toHaveAttribute("data-status", ramp.status);
    if (ramp.status === "NOT_CONFIGURED") {
      await expect(rampRow.getByTestId("ramp-not-connected")).toHaveText("Ramp sandbox: Not connected");
      for (const name of ramp.missing) await expect(rampRow.getByTestId("missing-vars")).toContainText(name);
      await expect(rampRow.getByTestId("ramp-label")).toHaveCount(0);
    } else {
      await expect(rampRow.getByTestId("ramp-label")).toHaveText(ramp.label);
    }
    // A sync button exists only when the server allows it (never in the demo).
    await expect(rampRow.getByRole("button", { name: /Sync from Ramp/ })).toHaveCount(ramp.syncAllowed ? 1 : 0);
    await expect(rampRow).toContainText(ramp.notice);

    const aiRow = panel.getByTestId("ai-status");
    await expect(aiRow).toHaveAttribute("data-status", ai.status);
    if (ai.status === "AI_OFF") {
      await expect(aiRow.getByTestId("ai-off-badge")).toHaveText("AI OFF");
      await expect(aiRow.getByTestId("ai-off-text")).toHaveText(
        "AI OFF: no LLM key configured. Showing rules-based suggestions.",
      );
    }
    await expect(aiRow).toContainText(ai.notice);

    // Names of missing variables may appear; values never do (none are set here anyway).
    await expect(panel).not.toContainText(/secret\s*=|sk-[A-Za-z0-9]/i);
  });

  test("demo workspace chip is not mislabelled as a Ramp connection", async ({ page }) => {
    await page.goto("/sources");
    await expect(page.getByRole("banner").getByTestId("mode-chip")).toContainText("DEMO DATA");
    await expect(page.getByRole("banner").getByTestId("mode-chip")).not.toContainText("RAMP");
  });
});
