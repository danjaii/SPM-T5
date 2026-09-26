import { test, expect } from "@playwright/test";

test("visitors land on the sign-in page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(5);
});

test("dashboards are not reachable without signing in", async ({ page }) => {
  await page.goto("/dashboard/event_coordinator");
  await expect(page).toHaveURL(/\/login$/);
});
