import request from "supertest";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountsFor, adminClient, canSignIn, deleteTestAccounts, hasDb, liveApp, seedAccount, uniqueEmail } from "./support/liveSupabase";

/**
 * SCRUM-12 Account Registration against local Supabase: the ACs about what actually gets stored.
 * Input-only rules and the forced system error are in tests/unit/accountRegistration.test.ts.
 */
describe.skipIf(!hasDb)("SCRUM-12 Account Registration (live Supabase)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const app = hasDb ? liveApp() : (undefined as never);
  const register = (body: Record<string, unknown>) =>
    request(app)
      .post("/auth/register")
      .send({ fullName: "Jamie Lee", password: "Passw0rd!", confirmPassword: "Passw0rd!", ...body });

  afterEach(() => deleteTestAccounts(admin));

  it("SCRUM-12/AC9: creates an account with the Attendee role and shows a success message", async () => {
    const email = uniqueEmail();

    const res = await register({ email });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/^Registration successful/);
    const { profiles } = await accountsFor(admin, email);
    expect(profiles).toEqual([expect.objectContaining({ email, full_name: "Jamie Lee", role: "attendee" })]);
  });

  it("SCRUM-12/AC2: removes spaces around the email before checking it, and saves it without them", async () => {
    const email = uniqueEmail();

    const res = await register({ email: `  ${email}  ` });

    expect(res.status).toBe(201);
    const { authUsers, profiles } = await accountsFor(admin, email);
    expect(authUsers.map((u) => u.email)).toEqual([email]);
    expect(profiles.map((p) => p.email)).toEqual([email]);
  });

  it("SCRUM-12/AC3: treats the same email in different letter case as already taken", async () => {
    const email = uniqueEmail();
    await seedAccount(admin, email);

    const res = await register({ email: email.toUpperCase() });

    expect(res.status).toBe(409);
    const { authUsers, profiles } = await accountsFor(admin, email);
    expect(authUsers).toHaveLength(1);
    expect(profiles).toHaveLength(1);
  });

  it("SCRUM-12/AC4: tells the user the email is already registered, and creates no new account", async () => {
    const email = uniqueEmail();
    await seedAccount(admin, email);

    const res = await register({ email });

    expect(res.status).toBe(409);
    expect(res.body.fieldErrors.email).toBe("An account with this email already exists.");
    const { authUsers, profiles } = await accountsFor(admin, email);
    expect(authUsers).toHaveLength(1);
    expect(profiles).toHaveLength(1);
  });

  it("SCRUM-12/AC11: never shows, logs or stores the password itself; only Supabase Auth holds it", async () => {
    const logs = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const password = "Sp0tTheLeak!";
    const email = uniqueEmail();

    try {
      const created = await register({ email, password, confirmPassword: password });
      const refused = await register({ email: uniqueEmail(), password, confirmPassword: "Different1!" });

      expect(created.status).toBe(201);
      expect(refused.status).toBe(400);
      expect(created.text).not.toContain(password);
      expect(refused.text).not.toContain(password);
      const logged = logs.flatMap((spy) => spy.mock.calls).flat().map((arg) => inspect(arg, { depth: 5 }));
      expect(logged.join("\n")).not.toContain(password);
      const { profiles } = await accountsFor(admin, email);
      expect(JSON.stringify(profiles)).not.toContain(password);
      expect(await canSignIn(email, password)).toBe(true);
    } finally {
      logs.forEach((spy) => spy.mockRestore());
    }
  });

  it("SCRUM-12/AC12: submitting the same form twice at once creates only one account", async () => {
    const email = uniqueEmail();

    const responses = await Promise.all([register({ email }), register({ email })]);
    


    expect(responses.filter((res) => res.status === 201)).toHaveLength(1);
    const { authUsers, profiles } = await accountsFor(admin, email);
    expect(authUsers).toHaveLength(1);
    expect(profiles).toHaveLength(1);
  });
});
