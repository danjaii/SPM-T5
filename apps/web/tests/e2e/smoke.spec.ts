import { test, expect } from "@playwright/test";

test("visitors land on the sign-in page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  // SCRUM-75/AC3: the Event Coordinator Lead is the sixth sign-in option; SCRUM-116/AC4: the Safety Officer the seventh
  await expect(page.getByRole("radio")).toHaveCount(7);
  await expect(page.getByRole("radio", { name: /Event Coordinator Lead/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Safety Officer/ })).toBeVisible();
});

test("dashboards are not reachable without signing in", async ({ page }) => {
  await page.goto("/dashboard/event_coordinator");
  await expect(page).toHaveURL(/\/login$/);
});
