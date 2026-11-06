import { ACCOUNTS } from "../../fixtures/accounts";
import { waitForButton } from "../../fixtures/hydration";
import { LoginPage } from "../../pages/LoginPage";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-17/AC1-AC4: Log out is in the sidebar and ends the session; Back and reopening a guarded page then end on the sign-in
// page. Logging out revokes the session it was made with (auth-service, scope "local"), so this test signs in through the form
// for a session of its own: logging out of the saved session would sign out every other test that uses the same persona.
const t = tc("E2E-AUTH-04");

test(t.title, { annotation: t.annotation }, async ({ browser }) => {
  const context = await browser.newContext(); // no saved session
  const page = await context.newPage();
  await new LoginPage(page).signIn(ACCOUNTS.attendee.email, "attendee");

  await test.step("Log out is on the page and takes the user to the sign-in page (AC1, AC3)", async () => {
    await waitForButton(page, "Log out"); // a click before React has attached does nothing
    await page.getByRole("complementary", { name: "Sidebar" }).getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    const cookies = (await context.cookies()).filter((c) => c.name === "cs_session");
    expect(cookies, "the session cookie is gone").toEqual([]);
  });

  await test.step("Back does not reopen the dashboard, and the dashboard URL now sends the user to sign in (AC2, AC4)", async () => {
    await page.goBack();
    await expect(page).not.toHaveURL(/\/dashboard\//);
    await page.goto("/dashboard/attendee");
    await expect(page).toHaveURL(/\/login/);
  });

  await context.close();
});
