import { ACCOUNTS, PRIMARY_BY_ROLE } from "../../fixtures/accounts";
import { LoginPage } from "../../pages/LoginPage";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";
import type { Role } from "@spm-t5/shared";

// SCRUM-122/AC1: signing in through the form lands each role on its own home page. This is the one test that uses the
// real form for every role; the others reuse the sessions saved by the setup project.
const t = tc("E2E-AUTH-01");

test.describe.configure({ timeout: 300_000 }); // seven real sign-ins, each in a fresh context, with `next dev` compiling pages

test(t.title, { annotation: t.annotation }, async ({ browser }) => {
  for (const [role, persona] of Object.entries(PRIMARY_BY_ROLE) as [Role, keyof typeof ACCOUNTS][]) {
    await test.step(`${role} lands on its own home`, async () => {
      const context = await browser.newContext(); // no saved session
      const page = await context.newPage();
      await new LoginPage(page).signIn(ACCOUNTS[persona].email, role);
      await expect(page.getByRole("complementary"), "the sidebar is there straight after signing in").toBeVisible();
      await context.close();
    });
  }
});
