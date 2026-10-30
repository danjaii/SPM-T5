import { expect, test } from "@playwright/test";

// SCRUM-121: needs the local stack (supabase start + seed, auth-service and the services behind the home pages), which
// CI's e2e job doesn't run. Opt in with E2E_FULL_STACK=1. Signs in as a seeded account of each role.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "http://localhost:4001";
const PASSWORD = "ConnectSphere2026!";
const ACCOUNTS = {
  event_organiser: "jason.chua@techconnect.example.com",
  event_coordinator: "priya.nair@connectsphere.example.com",
  event_coordinator_lead: "helen.ong@connectsphere.example.com",
  venue_staff: "kenneth.wong@connectsphere.example.com",
  technical_support_staff: "aaron.koh@connectsphere.example.com",
  safety_officer: "farah.ismail@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
} as const;

for (const [role, email] of Object.entries(ACCOUNTS)) {
  // SCRUM-139/AC1: the attendee's home item reads Browse events
  const home = role === "attendee" ? "Browse events" : "Home";

  test.describe(`SCRUM-121 ${role}`, () => {
    test.beforeEach(async ({ context }) => {
      const login = await context.request.post(`${AUTH_URL}/auth/login`, { data: { email, password: PASSWORD, role } });
      expect(login.ok()).toBe(true);
    });

    test("SCRUM-121/AC1 the home page shows the sidebar with the home item highlighted", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/dashboard/${role}`);
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link", { name: home })).toHaveAttribute("aria-current", "page");
      await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
    });

    test("SCRUM-121/AC3 at 375px the nav collapses into a menu and the page does not scroll sideways", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/dashboard/${role}`);
      await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
      const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
      expect(widths.page).toBeLessThanOrEqual(widths.window);
      await page.getByRole("button", { name: "Open menu" }).click();
      await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: home })).toBeVisible();
    });
  });
}
