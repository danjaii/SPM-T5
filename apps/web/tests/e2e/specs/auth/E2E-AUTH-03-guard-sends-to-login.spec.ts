import { ACCOUNTS } from "../../fixtures/accounts";
import { LoginPage } from "../../pages/LoginPage";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-177/AC2 and the route guard (middleware.ts): with no session a guarded page goes to /login. The registration page
// remembers where the person was going and returns there after signing in; other guarded pages go to their own home.
const t = tc("E2E-AUTH-03");

test(t.title, { annotation: t.annotation }, async ({ page }) => {
  await test.step("a dashboard without a session goes to the sign-in page", async () => {
    await page.goto("/dashboard/attendee");
    await expect(page).toHaveURL(/\/login/);
  });

  await test.step("a role-only page without a session goes to the sign-in page", async () => {
    await page.goto("/booking-queue");
    await expect(page).toHaveURL(/\/login/);
  });

  await test.step("the registration page keeps where the person was going", async () => {
    const target = "/events/00000000-0000-4000-8000-000000000001/register";
    await page.goto(target);
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get("next") ?? "")).toBe(target);

    const login = new LoginPage(page);
    await login.submit(ACCOUNTS.attendee.email, "attendee");
    await expect(page, "signing in returns to the page they were going to").toHaveURL(new RegExp(`${target}$`));
  });
});
