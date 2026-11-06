import { ACCOUNTS } from "../../fixtures/accounts";
import { LoginPage } from "../../pages/LoginPage";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-122/AC8 (the shared 375 px criterion): the sign-in page does not scroll sideways on a phone-width screen, and a person
// can still sign in there and reach their home. 375 px is the boundary the criterion names.
const t = tc("E2E-AUTH-06");

test(t.title, { annotation: t.annotation }, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const login = new LoginPage(page);
  await login.open();

  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
  expect(widths.page, "no sideways scroll on the sign-in page").toBeLessThanOrEqual(widths.window);

  await login.submit(ACCOUNTS.attendee.email, "attendee");
  await expect(page).toHaveURL(/\/dashboard\/attendee$/);
  const after = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }));
  expect(after.page, "no sideways scroll on the home page either").toBeLessThanOrEqual(after.window);
});
