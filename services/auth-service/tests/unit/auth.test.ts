import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { INVALID_LOGIN_MESSAGE } from "../../src/routes/auth";
import { PASSWORD_RULE_MESSAGE } from "../../src/validation";

// ---------------------------------------------------------------------------
// In-memory stand-in for Supabase (Auth + the tables auth-service touches).
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

interface AuthUser { id: string; email: string; password: string; confirmed: boolean }

function createFake() {
  const authUsers: AuthUser[] = [];
  const sessions = new Map<string, string>(); // access token -> user id
  const tables: Record<string, Row[]> = {
    users: [], events: [], venues: [], venue_bookings: [], equipment: [], technical_support_requests: [], event_registrations: [],
  };
  const calls = { resetEmails: [] as { email: string; redirectTo?: string }[], signedOut: [] as string[], deleted: [] as string[] };
  let counter = 0;
  const failProfileInsert = { value: false };
  const failReads = { value: false };
  const signUpError = { value: null as null | { status: number; code: string; message: string } };

  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder; },
      in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder; },
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      insert: async (row: Row) => {
        if (failProfileInsert.value) return { error: { message: "boom" } };
        if (tables[table].some((r) => r.email === row.email)) return { error: { message: "duplicate" } };
        tables[table].push(row);
        return { error: null };
      },
      then: (resolve: (v: unknown) => unknown) => resolve(failReads.value ? { data: null, error: { message: "db down" } } : { data: rows, error: null }),
    };
    return builder;
  };

  const userFor = (token: string) => authUsers.find((u) => u.id === sessions.get(token));

  const anon = {
    auth: {
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        const user = authUsers.find((u) => u.email === email && u.password === password && u.confirmed);
        if (!user) return { data: { user: null, session: null }, error: { message: "Invalid login credentials" } };
        const token = `token-${++counter}`;
        sessions.set(token, user.id);
        return { data: { user: { id: user.id, email: user.email }, session: { access_token: token, expires_in: 3600 } }, error: null };
      },
      signUp: async ({ email, password }: { email: string; password: string }) => {
        if (signUpError.value) return { data: { user: null, session: null }, error: signUpError.value };
        if (authUsers.some((u) => u.email === email)) {
          return { data: { user: { id: "ignored", email, identities: [] }, session: null }, error: null };
        }
        const user = { id: `user-${++counter}`, email, password, confirmed: false };
        authUsers.push(user);
        return { data: { user: { id: user.id, email, identities: [{}] }, session: null }, error: null };
      },
      getUser: async (token: string) => {
        const user = userFor(token) ?? authUsers.find((u) => `reset-${u.id}` === token);
        return user ? { data: { user: { id: user.id, email: user.email } }, error: null } : { data: { user: null }, error: { message: "bad jwt" } };
      },
      resetPasswordForEmail: async (email: string, opts?: { redirectTo?: string }) => {
        calls.resetEmails.push({ email, redirectTo: opts?.redirectTo });
        return { data: {}, error: null };
      },
    },
  };

  const admin = {
    from: (table: string) => query(table),
    auth: {
      admin: {
        signOut: async (token: string) => { sessions.delete(token); calls.signedOut.push(token); return { error: null }; },
        deleteUser: async (id: string) => { authUsers.splice(authUsers.findIndex((u) => u.id === id), 1); calls.deleted.push(id); return { error: null }; },
        updateUserById: async (id: string, attrs: { password: string }) => {
          const user = authUsers.find((u) => u.id === id);
          if (user) user.password = attrs.password;
          return { error: null };
        },
      },
    },
  };

  const deps = { anon, admin, forUser: () => ({ from: (t: string) => query(t) }) } as unknown as SupabaseDeps;

  /** Seeds an account that can log in (verified email + profile row). */
  const seedUser = (email: string, role: string, extra: Partial<AuthUser> & { isActive?: boolean } = {}) => {
    const id = `seed-${++counter}`;
    authUsers.push({ id, email, password: "Passw0rd!", confirmed: extra.confirmed ?? true });
    tables.users.push({ id, email, role, full_name: email.split("@")[0], is_active: extra.isActive ?? true });
    return id;
  };

  return { deps, tables, authUsers, sessions, calls, seedUser, failProfileInsert, failReads, signUpError };
}

let fake: ReturnType<typeof createFake>;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  fake = createFake();
  app = createApp(fake.deps);
});

const login = (email: string, password: string, role: string) => request(app).post("/auth/login").send({ email, password, role });

/** Logs in and returns the Cookie header to send on later requests. */
async function signInAs(email: string, role: string) {
  const res = await login(email, "Passw0rd!", role);
  expect(res.status).toBe(200);
  return (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

// ---------------------------------------------------------------------------
// US1 — Login to ConnectSphere
// ---------------------------------------------------------------------------
describe("US1 — Login", () => {
  it("logs in with a verified email, password and matching role, and redirects to that role's dashboard", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const res = await login("rachel@example.com", "Passw0rd!", "event_coordinator");

    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBe("/dashboard/event_coordinator");
    expect(res.body.user).toMatchObject({ email: "rachel@example.com", role: "event_coordinator" });
  });

  it("stores the session in an httpOnly cookie, not in the response body", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const res = await login("rachel@example.com", "Passw0rd!", "event_coordinator");

    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cookie).toMatch(/^cs_session=token-/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toContain("token-");
  });

  it("shows the same generic error for a wrong password and an unknown email", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const wrongPassword = await login("rachel@example.com", "WrongPass1!", "event_coordinator");
    const unknownEmail = await login("nobody@example.com", "Passw0rd!", "event_coordinator");

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual({ error: INVALID_LOGIN_MESSAGE });
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects an email that hasn't been verified, with the same generic error", async () => {
    fake.seedUser("new@example.com", "attendee", { confirmed: false });
    const res = await login("new@example.com", "Passw0rd!", "attendee");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: INVALID_LOGIN_MESSAGE });
  });

  it("rejects a role that doesn't match the account, with the same generic error, and ends the session it opened", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const res = await login("rachel@example.com", "Passw0rd!", "venue_staff");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: INVALID_LOGIN_MESSAGE });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(fake.sessions.size).toBe(0);
  });

  it("rejects a deactivated account with the same generic error", async () => {
    fake.seedUser("old@example.com", "attendee", { isActive: false });
    const res = await login("old@example.com", "Passw0rd!", "attendee");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: INVALID_LOGIN_MESSAGE });
  });

  it("asks for all fields when email, password or role is missing", async () => {
    const res = await request(app).post("/auth/login").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
  });

  it("offers a password reset: sends a reset email pointing at the web app's reset page", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const res = await request(app).post("/auth/forgot-password").send({ email: "rachel@example.com" });

    expect(res.status).toBe(200);
    expect(fake.calls.resetEmails).toEqual([{ email: "rachel@example.com", redirectTo: "http://localhost:3000/reset-password" }]);
  });

  it("gives the same reset reply whether or not the email has an account", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const known = await request(app).post("/auth/forgot-password").send({ email: "rachel@example.com" });
    const unknown = await request(app).post("/auth/forgot-password").send({ email: "nobody@example.com" });

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
  });

  it("rejects a malformed email on the reset form", async () => {
    const res = await request(app).post("/auth/forgot-password").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.email).toBe("Enter a valid email address.");
  });

  it("sets a new password from a valid reset link, so the user can log in with it", async () => {
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    const res = await request(app).post("/auth/reset-password").send({ accessToken: `reset-${id}`, password: "N3wPassw0rd!" });

    expect(res.status).toBe(200);
    expect((await login("rachel@example.com", "N3wPassw0rd!", "event_coordinator")).status).toBe(200);
  });

  it("refuses an invalid reset link, and a new password that breaks the complexity rules", async () => {
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    const badLink = await request(app).post("/auth/reset-password").send({ accessToken: "junk", password: "N3wPassw0rd!" });
    const weak = await request(app).post("/auth/reset-password").send({ accessToken: `reset-${id}`, password: "weak" });

    expect(badLink.status).toBe(400);
    expect(weak.status).toBe(400);
    expect(weak.body.fieldErrors.password).toBe(PASSWORD_RULE_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// US2 — Register for ConnectSphere
// ---------------------------------------------------------------------------
describe("US2 — Register", () => {
  const valid = { fullName: "Jamie Lee", email: "jamie@example.com", password: "Passw0rd!", role: "attendee" };
  const register = (body: Record<string, unknown>) => request(app).post("/auth/register").send({ ...valid, ...body });

  it("registers a new user with their chosen role and shows a registration successful message", async () => {
    const res = await register({ role: "venue_staff" });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/^Registration successful/);
    expect(fake.tables.users).toHaveLength(1);
    expect(fake.tables.users[0]).toMatchObject({ email: "jamie@example.com", role: "venue_staff", full_name: "Jamie Lee" });
  });

  it("does not log the user in after registering", async () => {
    const res = await register({});
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("shows a clear message for an invalid email", async () => {
    const res = await register({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.email).toBe("Enter a valid email address.");
    expect(fake.tables.users).toHaveLength(0);
  });

  it.each([
    ["is shorter than 8 characters", "Ab1!"],
    ["has no letter", "12345678!"],
    ["has no number", "Password!!"],
    ["has no symbol", "Passw0rd12"],
  ])("shows the complexity rules when the password %s", async (_why, password) => {
    const res = await register({ password });

    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.password).toBe(PASSWORD_RULE_MESSAGE);
    expect(fake.authUsers).toHaveLength(0);
  });

  it("requires a full name and a valid role", async () => {
    const noName = await register({ fullName: " " });
    const badRole = await register({ role: "administrator" });

    expect(noName.body.fieldErrors.fullName).toBeDefined();
    expect(badRole.body.fieldErrors.role).toBeDefined();
  });

  it("rejects an email that is already registered", async () => {
    fake.seedUser("jamie@example.com", "attendee");
    const res = await register({});

    expect(res.status).toBe(409);
    expect(res.body.fieldErrors.email).toBe("An account with this email already exists.");
  });

  it("treats emails case-insensitively when checking for duplicates", async () => {
    fake.seedUser("jamie@example.com", "attendee");
    const res = await register({ email: "Jamie@Example.com" });
    expect(res.status).toBe(409);
  });

  it("rejects an email Supabase already knows about even if it has no profile row yet", async () => {
    fake.authUsers.push({ id: "orphan", email: "jamie@example.com", password: "x", confirmed: true });
    const res = await register({});

    expect(res.status).toBe(409);
    expect(fake.tables.users).toHaveLength(0);
  });

  it("tells the user to wait, rather than to retry, when Supabase's email rate limit is hit", async () => {
    fake.signUpError.value = { status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" };
    const res = await register({});

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/wait a while/);
    expect(fake.tables.users).toHaveLength(0);
  });

  it("removes the auth account again if the profile can't be saved, so the email isn't stuck", async () => {
    fake.failProfileInsert.value = true;
    const res = await register({});

    expect(res.status).toBe(500);
    expect(fake.authUsers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// US3 — Role based access control
// ---------------------------------------------------------------------------
describe("US3 — Role based access", () => {
  const sectionTitles = async (email: string, role: string) => {
    const cookie = await signInAs(email, role);
    const res = await request(app).get("/dashboard").set("Cookie", cookie);
    expect(res.status).toBe(200);
    return (res.body.sections as { title: string }[]).map((s) => s.title);
  };

  it.each([
    ["event_organiser", ["My event requests"]],
    ["event_coordinator", ["Events I coordinate", "My venue booking requests"]],
    ["venue_staff", ["Venues", "Booking requests awaiting review"]],
    ["technical_support_staff", ["Equipment", "Technical support requests"]],
    ["attendee", ["My registrations & tickets", "Events open for booking"]],
  ])("%s only sees its own dashboard sections", async (role, expected) => {
    fake.seedUser(`${role}@example.com`, role);
    expect(await sectionTitles(`${role}@example.com`, role)).toEqual(expected);
  });

  it("shows an event organiser only their own events", async () => {
    const mine = fake.seedUser("org@example.com", "event_organiser");
    const other = fake.seedUser("org2@example.com", "event_organiser");
    fake.tables.events.push(
      { name: "My conference", organiser_id: mine, status: "submitted", expected_attendance: 120 },
      { name: "Someone else's gala", organiser_id: other, status: "draft" },
    );
    const cookie = await signInAs("org@example.com", "event_organiser");
    const res = await request(app).get("/dashboard").set("Cookie", cookie);

    expect(res.body.sections[0].rows).toEqual([
      expect.objectContaining({ name: "My conference", status: "submitted", attendance: 120 }),
    ]);
  });

  it("shows an attendee their registrations and only confirmed, bookable events in the catalogue", async () => {
    const me = fake.seedUser("att@example.com", "attendee");
    fake.tables.event_registrations.push({ attendee_id: me, status: "registered", event: { name: "Tech Summit" } });
    fake.tables.events.push(
      { name: "Open day", status: "confirmed", registration_required: true },
      { name: "Private draft", status: "draft", registration_required: true },
    );
    const cookie = await signInAs("att@example.com", "attendee");
    const res = await request(app).get("/dashboard").set("Cookie", cookie);

    expect(res.body.sections[0].rows).toEqual([expect.objectContaining({ event: "Tech Summit", status: "registered" })]);
    expect(res.body.sections[1].rows.map((r: Row) => r.name)).toEqual(["Open day"]);
  });

  it("tells the web app who the signed-in user is and their role", async () => {
    fake.seedUser("kenneth@example.com", "venue_staff");
    const cookie = await signInAs("kenneth@example.com", "venue_staff");
    const res = await request(app).get("/auth/me").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: "kenneth@example.com", role: "venue_staff" });
  });

  it("refuses the dashboard and identity endpoints without a session", async () => {
    expect((await request(app).get("/dashboard")).status).toBe(401);
    expect((await request(app).get("/auth/me")).status).toBe(401);
  });

  it("refuses a session token that Supabase doesn't recognise", async () => {
    const res = await request(app).get("/dashboard").set("Cookie", "cs_session=forged");
    expect(res.status).toBe(401);
  });

  it("reports a friendly error, not internals, when the dashboard data can't be loaded", async () => {
    fake.seedUser("att@example.com", "attendee");
    const cookie = await signInAs("att@example.com", "attendee");
    fake.failReads.value = true;
    const res = await request(app).get("/dashboard").set("Cookie", cookie);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't load your dashboard. Please try again." });
  });

  it("marks dashboard data as no-store so it can't be replayed from cache", async () => {
    fake.seedUser("att@example.com", "attendee");
    const cookie = await signInAs("att@example.com", "attendee");
    const res = await request(app).get("/dashboard").set("Cookie", cookie);

    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// US4 — Logout of ConnectSphere
// ---------------------------------------------------------------------------
describe("US4 — Logout", () => {
  it("invalidates the session on Supabase, so the old token no longer works", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const cookie = await signInAs("rachel@example.com", "event_coordinator");
    expect((await request(app).get("/dashboard").set("Cookie", cookie)).status).toBe(200);

    const res = await request(app).post("/auth/logout").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(fake.calls.signedOut).toContain(cookie.replace("cs_session=", ""));
    // Re-using the previous page's request (what the back button would do) is refused.
    expect((await request(app).get("/dashboard").set("Cookie", cookie)).status).toBe(401);
    expect((await request(app).get("/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("clears the session cookie", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const cookie = await signInAs("rachel@example.com", "event_coordinator");
    const res = await request(app).post("/auth/logout").set("Cookie", cookie);

    const setCookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(setCookie).toMatch(/^cs_session=;/);
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("still succeeds when there is no active session", async () => {
    const res = await request(app).post("/auth/logout");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Web app <-> auth-service (cookies across origins)
// ---------------------------------------------------------------------------
describe("CORS for the web app", () => {
  it("lets the web app's origin send credentials, and no other origin", async () => {
    const allowed = await request(app).options("/auth/login").set("Origin", "http://localhost:3000");
    const other = await request(app).options("/auth/login").set("Origin", "https://evil.example");

    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reports healthy", async () => {
    expect((await request(app).get("/health")).body).toEqual({ status: "ok", service: "auth-service" });
  });
});
