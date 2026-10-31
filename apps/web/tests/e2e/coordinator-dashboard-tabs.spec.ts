import { expect, test, type Locator, type Page } from "@playwright/test";

// SCRUM-179: needs the local stack (supabase start + seed, auth-service, event-service and venue-service), which CI's e2e job
// doesn't run. Opt in with E2E_FULL_STACK=1. Rachel Tan's seeded events span enough statuses for the tabs to wrap.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "http://localhost:4001";

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
};

/** Every tab sits inside the tab list, and the open tab's panel starts below the list. */
async function expectTabsClearOfList(card: Locator) {
  const list = await box(card.getByRole("tablist"));
  for (const tab of await card.getByRole("tab").all()) {
    const { y, height } = await box(tab);
    expect(y + height).toBeLessThanOrEqual(list.y + list.height);
  }
  const panel = await box(card.getByRole("tabpanel"));
  expect(panel.y).toBeGreaterThanOrEqual(list.y + list.height);
}

const openDashboard = async (page: Page, width: number) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/dashboard/event_coordinator");
  const card = page.getByRole("region", { name: "My events" });
  await expect(card.getByRole("tab").first()).toBeVisible();
  return card;
};

test.describe("SCRUM-179 status tabs on the coordinator dashboard", () => {
  test.beforeEach(async ({ context }) => {
    const login = await context.request.post(`${AUTH_URL}/auth/login`, {
      data: { email: "rachel.tan@connectsphere.example.com", password: "ConnectSphere2026!", role: "event_coordinator" },
    });
    expect(login.ok()).toBe(true);
  });

  test("SCRUM-179/AC1 the list starts below every row of tabs", async ({ page }) => {
    const card = await openDashboard(page, 1280);
    expect(await card.getByRole("tab").count()).toBeGreaterThan(3);
    await expectTabsClearOfList(card);
  });

  test("SCRUM-179/AC2 a tab on the second row opens its list, also below the tabs", async ({ page }) => {
    const card = await openDashboard(page, 1280);
    const last = card.getByRole("tab").last();
    await last.click();
    await expect(last).toHaveAttribute("aria-selected", "true");
    await expectTabsClearOfList(card);
  });

  test("SCRUM-179/AC3 at phone width the list stays below the tabs and the page does not scroll sideways", async ({ page }) => {
    const card = await openDashboard(page, 375);
    await expectTabsClearOfList(card);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
