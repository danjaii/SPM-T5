import type { Role } from "@spm-t5/shared";
import { PRIMARY_BY_ROLE } from "../../fixtures/accounts";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-121/AC1 and AC3 for every role: the home page shows the shared sidebar with the home item highlighted (once), and at
// 375 px the navigation collapses into a menu and the page does not scroll sideways. Every role's first item is "Home" (the
// attendee's too since SCRUM-161; Browse events is a second item); the Lead's home is the unassigned queue (SCRUM-188), which
// its dashboard URL redirects to.
const t = tc("E2E-AUTH-05");
const ROLES = Object.keys(PRIMARY_BY_ROLE) as Role[];

test.describe.configure({ timeout: 300_000 }); // 7 roles, 2 page loads each, compiled on first use by `next dev`

test(t.title, { annotation: t.annotation }, async ({ as }) => {
  for (const role of ROLES) {
    await test.step(`${role}: home item highlighted on a desktop, menu on a phone`, async () => {
      const page = await as(PRIMARY_BY_ROLE[role]);
      const home = "Home";

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/dashboard/${role}`);
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link", { name: home })).toHaveAttribute("aria-current", "page");
      await expect(nav.locator('a[aria-current="page"]'), "exactly one item is highlighted").toHaveCount(1);

      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/dashboard/${role}`);
      await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
      const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
      expect(widths.page, "no sideways scroll at 375 px").toBeLessThanOrEqual(widths.window);
      await page.getByRole("button", { name: "Open menu" }).click();
      await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: home })).toBeVisible();
    });
  }
});
