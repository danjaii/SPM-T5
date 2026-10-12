import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createFake } from "../support/fakeSupabase";

/**
 * SCRUM-12 Account Registration with the in-memory Supabase fake: input rules decided before Supabase is
 * called, and the forced system error. What actually gets stored is checked live in
 * tests/integration/accountRegistration.test.ts.
 */
const valid = { fullName: "Jamie Lee", email: "jamie@example.com", password: "Passw0rd!", confirmPassword: "Passw0rd!" };

let fake: ReturnType<typeof createFake>;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  fake = createFake();
  app = createApp(fake.deps);
});

const register = (body: Record<string, unknown>) => request(app).post("/auth/register").send({ ...valid, ...body });

describe("SCRUM-12 Account Registration", () => {
  it.each(["fullName", "email", "password", "confirmPassword"])(
    "SCRUM-12/AC1: shows an error next to %s when it is left empty, and creates no account",
    async (field) => {
      const res = await register({ [field]: "" });

      expect(res.status).toBe(400);
      expect(res.body.fieldErrors[field]).toBeDefined();
      expect(fake.authUsers).toHaveLength(0);
      expect(fake.tables.users).toHaveLength(0);
    },
  );

  it.each([
    ["is shorter than 8 characters", "Pa1!"],
    ["has no uppercase letter", "passw0rd!"],
    ["has no lowercase letter", "PASSW0RD!"],
    ["has no number", "Password!"],
    ["has no symbol", "Passw0rd1"],
  ])("SCRUM-12/AC5: refuses a password that %s, and creates no account", async (_rule, password) => {
    const res = await register({ password, confirmPassword: password });

    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.password).toBeDefined();
    expect(fake.authUsers).toHaveLength(0);
  });

  it.each([
    ["email", "not-an-email", "Enter a valid email address."],
    ["password", "Pa1!", "Password must be at least 8 characters."],
    ["password", "passw0rd!", "Password must include an uppercase letter."],
    ["password", "PASSW0RD!", "Password must include a lowercase letter."],
    ["password", "Password!", "Password must include a number."],
    ["password", "Passw0rd1", "Password must include a symbol."],
  ])("SCRUM-12/AC6: %s %s shows the message %s next to that field", async (field, value, message) => {
    const body = field === "password" ? { password: value, confirmPassword: value } : { [field]: value };

    const res = await register(body);

    expect(res.body.fieldErrors[field]).toBe(message);
  });

  it("SCRUM-12/AC7: shows an error next to confirm password when it doesn't match, and creates no account", async () => {
    const res = await register({ password: "Passw0rd!", confirmPassword: "Different1!" });

    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.confirmPassword).toBe("Passwords do not match.");
    expect(fake.authUsers).toHaveLength(0);
    expect(fake.tables.users).toHaveLength(0);
  });

  it.each(["event_organiser", "event_coordinator", "venue_staff", "technical_support_staff"])(
    "SCRUM-12/AC10: rejects a request that tries to register as %s, and creates no account",
    async (role) => {
      const res = await register({ role });

      expect(res.status).toBe(400);
      expect(fake.authUsers).toHaveLength(0);
      expect(fake.tables.users).toHaveLength(0);
    },
  );

  it("SCRUM-12/AC13: shows an error and creates no account when Supabase has a system error", async () => {
    fake.signUpError.value = { status: 500, code: "unexpected_failure", message: "Database error saving new user" };

    const res = await register({});

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("We couldn't create your account. Please try again.");
    expect(fake.authUsers).toHaveLength(0);
    expect(fake.tables.users).toHaveLength(0);
  });
});
