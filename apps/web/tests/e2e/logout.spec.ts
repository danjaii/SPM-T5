import { expect, test, type Page } from "@playwright/test";

// SCRUM-17: logging out needs a real session, so this needs the local stack (supabase start + seed and auth-service),
// which CI's e2e job doesn't run. Opt in with E2E_FULL_STACK=1.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";

async function signInAsAttendee(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("alicia.fernandez@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("combobox", { name: "Continue as" }).click();
  await page.getByRole("option", { name: "Attendee" }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard\/attendee$/);
}

test.describe("SCRUM-17 log out", () => {
  test("SCRUM-17/AC1,AC3 Log out is on the page and takes the user to the login page", async ({ page }) => {
    await signInAsAttendee(page);

    await page.getByRole("complementary", { name: "Sidebar" }).getByRole("button", { name: "Log out" }).click();

    await expect(page).toHaveURL(/\/login$/);
  });

  test("SCRUM-17/AC2,AC4 after logging out, Back and reopening the page both end on the login page", async ({ page }) => {
    await signInAsAttendee(page);
    await page.getByRole("complementary", { name: "Sidebar" }).getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goBack();
    await expect(page).not.toHaveURL(/\/dashboard\//);

    await page.goto("/dashboard/attendee");
    await expect(page).toHaveURL(/\/login$/);
  });
});
