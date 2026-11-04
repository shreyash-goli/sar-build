import { expect, test, type Page } from "@playwright/test";

// playwright.config.ts starts the server with DEMO_MODE=true and
// DEMO_NOW=2026-11-17T16:00:00Z.

const ROUTES = [
  { path: "/dashboard", nav: "Overview", heading: "Overview" },
  { path: "/graph", nav: "Dependency Graph", heading: "Dependency Graph" },
  { path: "/incidents", nav: "Incidents", heading: "Incidents" },
  { path: "/scenarios", nav: "Response Studio", heading: "Response Studio" },
  { path: "/sources", nav: "Sources", heading: "Sources" },
] as const;

function topBarChip(page: Page) {
  return page.getByRole("banner").getByTestId("mode-chip");
}

function freshness(page: Page, placement: "topbar" | "mobile" | "drawer") {
  return page.locator(
    `[data-testid="source-freshness"][data-placement="${placement}"]`,
  );
}

function demoClock(page: Page, placement: "topbar" | "mobile" | "drawer") {
  return page.locator(
    `[data-testid="demo-clock"][data-placement="${placement}"]`,
  );
}

test.describe("app shell", () => {
  test("root redirects to the Overview", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Overview" }),
    ).toBeVisible();
  });

  for (const route of ROUTES) {
    test(`${route.path} renders shell, heading, mode chip and honest empty state`, async ({
      page,
    }) => {
      const response = await page.goto(route.path);
      expect(response?.status()).toBe(200);

      await expect(
        page.getByRole("heading", { level: 1, name: route.heading }),
      ).toBeVisible();
      await expect(page).toHaveTitle(new RegExp(`^${route.heading} · FailSafe$`));

      const chip = topBarChip(page);
      await expect(chip).toBeVisible();
      await expect(chip).toContainText("DEMO DATA");
      await expect(chip).not.toContainText("RAMP SANDBOX");

      await expect(chip).toHaveAttribute("data-mode", "DEMO");
      await expect(freshness(page, "topbar")).toBeVisible();
      await expect(freshness(page, "topbar")).toHaveText("No data loaded");
      await expect(demoClock(page, "topbar")).toBeVisible();
      await expect(demoClock(page, "topbar")).toHaveText(
        "Demo clock: 17 Nov 2026, 16:00 UTC",
      );
      // The compact strip is for narrow viewports only.
      await expect(page.getByTestId("mobile-status")).toBeHidden();

      await expect(
        page.getByText(
          "No data loaded yet — the seeded demo arrives in a later task.",
        ),
      ).toBeVisible();

      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link")).toHaveCount(5);
      await expect(nav.getByRole("link", { name: route.nav })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    });
  }

  test("keyboard: skip link, then Tab through every nav item in order", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();

    const nav = page.getByRole("navigation", { name: "Main" });
    for (const route of ROUTES) {
      await page.keyboard.press("Tab");
      await expect(nav.getByRole("link", { name: route.nav })).toBeFocused();
    }

    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeFocused();

    // Shift+Tab back to Sources and activate it with Enter.
    await page.keyboard.press("Shift+Tab");
    await expect(nav.getByRole("link", { name: "Sources" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sources$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Sources" }),
    ).toBeVisible();
  });

  test("keyboard: skip link moves focus to main content", async ({ page }) => {
    await page.goto("/graph");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("focused nav link shows a visible focus ring", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const link = page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Overview" });
    await expect(link).toBeFocused();
    const outline = await link.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(outline.style).toBe("solid");
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });

  test("sidebar collapses and expands", async ({ page }) => {
    await page.goto("/incidents");
    const sidebar = page.locator("#app-sidebar");
    const before = (await sidebar.boundingBox())!.width;

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    const expand = page.getByRole("button", { name: "Expand sidebar" });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect
      .poll(async () => (await sidebar.boundingBox())!.width)
      .toBeLessThan(before);

    // Links stay reachable and labelled while collapsed.
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Incidents" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await expand.click();
    await expect(
      page.getByRole("button", { name: "Collapse sidebar" }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});

for (const width of [390, 320]) {
  test.describe(`narrow viewport (${width}px)`, () => {
    test.use({ viewport: { width, height: 844 } });

    for (const route of ROUTES) {
      test(`${route.path} fits and keeps freshness visible`, async ({
        page,
      }) => {
        await page.goto(route.path);
        await expect(
          page.getByRole("heading", { level: 1, name: route.heading }),
        ).toBeVisible();
        await expect(topBarChip(page)).toBeVisible();
        await expect(topBarChip(page)).toContainText("DEMO DATA");
        await expect(page.locator("#app-sidebar")).toBeHidden();

        // Desktop status is hidden; the compact strip replaces it.
        await expect(freshness(page, "topbar")).toBeHidden();
        await expect(freshness(page, "mobile")).toBeVisible();
        await expect(freshness(page, "mobile")).toHaveText("No data loaded");
        await expect(demoClock(page, "mobile")).toBeVisible();
        await expect(demoClock(page, "mobile")).toHaveText(
          "Demo clock: 17 Nov 2026, 16:00 UTC",
        );

        // Strip stays inside the viewport and under the top bar.
        const strip = (await page.getByTestId("mobile-status").boundingBox())!;
        expect(strip.x).toBeGreaterThanOrEqual(0);
        expect(strip.x + strip.width).toBeLessThanOrEqual(width);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}

test.describe("narrow viewport (390px) drawer", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("mobile navigation drawer opens, traps Escape, and navigates", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const menu = page.getByRole("button", { name: "Open navigation" });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    await menu.click();
    const dialog = page.getByRole("dialog", { name: "Navigation" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link")).toHaveCount(5);
    await expect(
      dialog.getByRole("button", { name: "Close navigation" }),
    ).toBeFocused();
    await expect(freshness(page, "drawer")).toHaveText("No data loaded");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menu).toBeFocused();

    await menu.click();
    await dialog.getByRole("link", { name: "Response Studio" }).click();
    await expect(page).toHaveURL(/\/scenarios$/);
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("heading", { level: 1, name: "Response Studio" }),
    ).toBeVisible();
  });
});
