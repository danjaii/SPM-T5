import { expect, type Page } from "@playwright/test";
import type { Role } from "@spm-t5/shared";
import { PASSWORD } from "../fixtures/env";
import { ROLE_LABEL } from "../fixtures/accounts";
import { waitForHydration } from "../fixtures/hydration";

/** The sign-in form (apps/web/src/components/LoginForm.tsx). */
export class LoginPage {
  constructor(private readonly page: Page) {}

  async open(next?: string) {
    await this.page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
    await waitForHydration(this.page, "input[type=password]");
  }

  /** Fills the form and presses Sign in; does not wait for the result, so a refusal can be asserted too. */
  async submit(email: string, role: Role, password = PASSWORD) {
    await this.page.getByLabel("Work email").fill(email);
    await this.page.getByLabel("Password").fill(password);
    await this.page.getByRole("combobox", { name: "Continue as" }).click();
    // "Event Coordinator" must not also match "Event Coordinator Lead"
    const name = new RegExp(`^${ROLE_LABEL[role]}(?!\\s*Lead)`);
    await this.page.getByRole("option", { name }).click();
    await this.page.getByRole("button", { name: "Sign in" }).click();
  }

  async signIn(email: string, role: Role) {
    await this.open();
    await this.submit(email, role);
    await expect(this.page).toHaveURL(new RegExp(`/dashboard/${role}$`));
  }
}
