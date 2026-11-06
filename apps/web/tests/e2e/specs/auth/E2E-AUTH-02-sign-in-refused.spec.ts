import { ACCOUNTS } from "../../fixtures/accounts";
import { LoginPage } from "../../pages/LoginPage";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-122/AC2: a wrong password, and a role that does not belong to the account, are refused with a message, keep the
// email in the box and give no session. The message is the same for both, so it does not say which part was wrong.
const t = tc("E2E-AUTH-02");

test(t.title, { annotation: t.annotation }, async ({ page, context }) => {
  const login = new LoginPage(page);
  const { email } = ACCOUNTS.attendee;
  const sessionCookies = async () => (await context.cookies()).filter((c) => c.name === "cs_session");
  const refusal = () => page.getByRole("alert").filter({ hasText: "Invalid" }).first();

  await login.open();
  await login.submit(email, "attendee", "not-the-password");
  await expect(refusal()).toBeVisible();
  const wrongPasswordMessage = (await refusal().innerText()).trim();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel("Work email")).toHaveValue(email);
  expect(await sessionCookies(), "no session after a wrong password").toEqual([]);

  // the right password, but the account is an attendee's and the form says organiser
  await login.open();
  await login.submit(email, "event_organiser");
  await expect(refusal()).toHaveText(wrongPasswordMessage);
  await expect(page).toHaveURL(/\/login/);
  expect(await sessionCookies(), "no session after a wrong role").toEqual([]);
});
