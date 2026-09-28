import { test, expect } from "@playwright/test";

test("ER-01/AC4 direct navigation to a denied request reveals no details", async ({ page, baseURL }) => {
  await page.route("http://localhost:4006/review/requests/**", (route) => route.fulfill({
    status: 404, contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": baseURL!, "Access-Control-Allow-Credentials": "true" },
    body: JSON.stringify({ error: "Request not found or access denied.", name: "Private event" }),
  }));
  await page.goto("/event-review/requests/10000000-0000-4000-8000-000000000001");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Request not found or access denied");
  await expect(page.getByText("Private event")).toHaveCount(0);
});

test("ER-01/AC4 expired sessions offer a sign-in link", async ({ page, baseURL }) => {
  await page.route("http://localhost:4006/review/requests/**", (route) => route.fulfill({
    status: 401, contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": baseURL!, "Access-Control-Allow-Credentials": "true" },
    body: "{}",
  }));
  await page.goto("/event-review/requests/10000000-0000-4000-8000-000000000001");
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
});
