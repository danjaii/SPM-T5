import { ROLES } from "@spm-t5/shared";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { INVALID_LOGIN_MESSAGE } from "../../src/routes/auth";
import { createFake, type Row } from "../support/fakeSupabase";

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
// SCRUM-13 — Login with email and password
// ---------------------------------------------------------------------------
describe("SCRUM-13 login", () => {
  it("SCRUM-13/AC1,AC4 logs in with a verified email, password and matching role, and redirects to that role's dashboard", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const res = await login("rachel@example.com", "Passw0rd!", "event_coordinator");

    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBe("/dashboard/event_coordinator");
    expect(res.body.user).toMatchObject({ email: "rachel@example.com", role: "event_coordinator" });
  });

  it("SCRUM-13/AC1 stores the session in an httpOnly cookie, not in the response body", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const res = await login("rachel@example.com", "Passw0rd!", "event_coordinator");

    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cookie).toMatch(/^cs_session=token-/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toContain("token-");
  });

  it("SCRUM-13/AC2 shows the same generic error for a wrong password and an unknown email", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const wrongPassword = await login("rachel@example.com", "WrongPass1!", "event_coordinator");
    const unknownEmail = await login("nobody@example.com", "Passw0rd!", "event_coordinator");

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual({ error: INVALID_LOGIN_MESSAGE });
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
  });

  it("SCRUM-13/AC1,AC2 rejects an email that hasn't been verified, with the same generic error", async () => {
    fake.seedUser("new@example.com", "attendee", { confirmed: false });
    const res = await login("new@example.com", "Passw0rd!", "attendee");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: INVALID_LOGIN_MESSAGE });
  });

  it("SCRUM-13/AC2 rejects a role that doesn't match the account, with the same generic error, and ends the session it opened", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const res = await login("rachel@example.com", "Passw0rd!", "venue_staff");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: INVALID_LOGIN_MESSAGE });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(fake.sessions.size).toBe(0);
  });

  it("SCRUM-13/AC2 rejects a deactivated account with the same generic error", async () => {
    fake.seedUser("old@example.com", "attendee", { isActive: false });
    const res = await login("old@example.com", "Passw0rd!", "attendee");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: INVALID_LOGIN_MESSAGE });
  });

  it("SCRUM-13/AC1 asks for all fields when email, password or role is missing", async () => {
    const res = await request(app).post("/auth/login").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
  });

  it.each(ROLES)("SCRUM-13/AC4 sends a %s to their own dashboard after logging in", async (role) => {
    fake.seedUser("user@example.com", role);
    const res = await login("user@example.com", "Passw0rd!", role);

    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBe(`/dashboard/${role}`);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-14 — Password reset
// ---------------------------------------------------------------------------
describe("SCRUM-14 password reset", () => {
  it("SCRUM-14/AC2 sends a reset email pointing at the web app's reset page", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const res = await request(app).post("/auth/forgot-password").send({ email: "rachel@example.com" });

    expect(res.status).toBe(200);
    expect(fake.calls.resetEmails).toEqual([{ email: "rachel@example.com", redirectTo: "http://localhost:3000/reset-password" }]);
  });

  it("SCRUM-14/AC2 gives the same reset reply whether or not the email has an account", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const known = await request(app).post("/auth/forgot-password").send({ email: "rachel@example.com" });
    const unknown = await request(app).post("/auth/forgot-password").send({ email: "nobody@example.com" });

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
  });

  it("SCRUM-14/AC2 rejects a malformed email on the reset form", async () => {
    const res = await request(app).post("/auth/forgot-password").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.email).toBe("Enter a valid email address.");
  });

  it("SCRUM-14/AC4 sets a new password that meets the rules from a valid reset link, so the user can log in with it", async () => {
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    const res = await request(app).post("/auth/reset-password").send({ accessToken: `reset-${id}`, password: "N3wPassw0rd!" });

    expect(res.status).toBe(200);
    expect((await login("rachel@example.com", "N3wPassw0rd!", "event_coordinator")).status).toBe(200);
  });

  it("SCRUM-14/AC3 refuses an invalid or expired reset link", async () => {
    const res = await request(app).post("/auth/reset-password").send({ accessToken: "junk", password: "N3wPassw0rd!" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This reset link is invalid or has expired.");
  });

  it("SCRUM-14/AC4 refuses a new password that breaks the complexity rules", async () => {
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    const weak = await request(app).post("/auth/reset-password").send({ accessToken: `reset-${id}`, password: "weak" });

    expect(weak.status).toBe(400);
    expect(weak.body.fieldErrors.password).toBe("Password must be at least 8 characters.");
  });

  it.each([
    ["n3wpassw0rd!", "Password must include an uppercase letter."],
    ["N3WPASSW0RD!", "Password must include a lowercase letter."],
    ["NewPassword!", "Password must include a number."],
    ["N3wPassw0rd", "Password must include a symbol."],
  ])("SCRUM-14/AC4 refuses %s, which breaks one complexity rule", async (password, message) => {
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    const res = await request(app).post("/auth/reset-password").send({ accessToken: `reset-${id}`, password });

    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.password).toBe(message);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-12 — Account Registration (US2)
// ---------------------------------------------------------------------------
describe("SCRUM-12 — Account Registration", () => {
  const valid = { fullName: "Jamie Lee", email: "jamie@example.com", password: "Passw0rd!", confirmPassword: "Passw0rd!", role: "attendee" };
  const register = (body: Record<string, unknown>) => request(app).post("/auth/register").send({ ...valid, ...body });

  it("SCRUM-12/AC9 does not log the user in after registering, so they go on to the login page", async () => {
    const res = await register({});
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("SCRUM-12/AC2,AC6 shows a clear message next to an invalid email, and creates no account", async () => {
    const res = await register({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.fieldErrors.email).toBe("Enter a valid email address.");
    expect(fake.tables.users).toHaveLength(0);
  });

  it("SCRUM-12/AC1 requires a full name", async () => {
    const noName = await register({ fullName: " " });

    expect(noName.body.fieldErrors.fullName).toBeDefined();
  });

  it("SCRUM-12/AC4 rejects an email that is already registered, with the agreed message", async () => {
    fake.seedUser("jamie@example.com", "attendee");
    const res = await register({});

    expect(res.status).toBe(409);
    expect(res.body.fieldErrors.email).toBe("An account with this email already exists.");
  });

  it("SCRUM-12/AC3 treats emails case-insensitively when checking for duplicates", async () => {
    fake.seedUser("jamie@example.com", "attendee");
    const res = await register({ email: "Jamie@Example.com" });
    expect(res.status).toBe(409);
  });

  it("SCRUM-12/AC3 rejects an email Supabase already knows about even if it has no profile row yet", async () => {
    fake.authUsers.push({ id: "orphan", email: "jamie@example.com", password: "x", confirmed: true });
    const res = await register({});

    expect(res.status).toBe(409);
    expect(fake.tables.users).toHaveLength(0);
  });

  it("SCRUM-12/AC13 tells the user to wait, rather than to retry, when Supabase's email rate limit is hit", async () => {
    fake.signUpError.value = { status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" };
    const res = await register({});

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/wait a while/);
    expect(fake.tables.users).toHaveLength(0);
  });

  it("SCRUM-12/AC13 removes the auth account again if the profile can't be saved, so the email isn't stuck", async () => {
    fake.failProfileInsert.value = true;
    const res = await register({});

    expect(res.status).toBe(500);
    expect(fake.authUsers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-15 — Role based access control (US3)
// ---------------------------------------------------------------------------
describe("SCRUM-15 — Role based access", () => {
  const sectionTitles = async (email: string, role: string) => {
    const cookie = await signInAs(email, role);
    const res = await request(app).get("/dashboard").set("Cookie", cookie);
    expect(res.status).toBe(200);
    return (res.body.sections as { title: string }[]).map((s) => s.title);
  };

  // AC1-AC5: each role's dashboard has its own sections and nothing from another role's
  it.each([
    ["AC1", "event_organiser", ["My event requests"]],
    ["AC2", "event_coordinator", ["Events I coordinate", "My venue booking requests"]],
    ["AC3", "venue_staff", ["Venues", "Booking requests awaiting review"]],
    ["AC4", "technical_support_staff", ["Equipment", "Technical support requests"]],
    // SCRUM-71/AC1: the attendee's List of events comes from event-service now, not this endpoint
    ["AC5", "attendee", ["My registrations & tickets"]],
  ])("SCRUM-15/%s %s only sees its own dashboard sections", async (_ac, role, expected) => {
    fake.seedUser(`${role}@example.com`, role);
    expect(await sectionTitles(`${role}@example.com`, role)).toEqual(expected);
  });

  // SCRUM-69 / week 7 changes: two new internal roles. Their real dashboards (the Lead's queue, the Safety Officer's checks)
  // come with their own stories, so for now they get an empty one, and not an error.
  it.each(["event_coordinator_lead", "safety_officer"])("%s gets an empty dashboard, not an error", async (role) => {
    fake.seedUser(`${role}@example.com`, role);
    expect(await sectionTitles(`${role}@example.com`, role)).toEqual([]);
  });

  // AC1: an organiser manages their own events, not other organisers'
  it("SCRUM-15/AC1 shows an event organiser only their own events", async () => {
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

  // SCRUM-8 UI: a coordinator reaches the edit-status page by clicking an event's status; other roles get plain text
  it("links each status in 'Events I coordinate' to that event's status page, and nowhere else", async () => {
    const coordinator = fake.seedUser("coord@example.com", "event_coordinator");
    fake.tables.events.push({ id: "evt-1", name: "Tech Summit", status: "under_review", assigned_coordinator_id: coordinator });
    const cookie = await signInAs("coord@example.com", "event_coordinator");
    const res = await request(app).get("/dashboard").set("Cookie", cookie);

    const [myEvents, myBookings] = res.body.sections;
    expect(myEvents.columns).toContainEqual({ key: "status", label: "Status", linkKey: "statusHref", statusKey: "statusKey" });
    expect(myEvents.rows).toEqual([expect.objectContaining({ status: "under review", statusHref: "/events/evt-1" })]);
    expect(myBookings.columns.some((c: Row) => c.linkKey)).toBe(false);

    // other roles' tables stay plain text (organisers got their own links in SCRUM-66/AC1, tested below)
    const venueStaff = fake.seedUser("vs@example.com", "venue_staff");
    expect(venueStaff).toBeTruthy();
    const vsRes = await request(app).get("/dashboard").set("Cookie", await signInAs("vs@example.com", "venue_staff"));
    for (const section of vsRes.body.sections) {
      expect(section.columns.some((c: Row) => c.linkKey)).toBe(false);
    }
  });

  // SCRUM-66/AC1: an organiser opens their event (where the change request form is) by clicking it on the dashboard
  it("SCRUM-66/AC1 links each of an organiser's events to its event page", async () => {
    const mine = fake.seedUser("org@example.com", "event_organiser");
    const other = fake.seedUser("org2@example.com", "event_organiser");
    fake.tables.events.push(
      { id: "evt-2", name: "My conference", organiser_id: mine, status: "submitted" },
      { id: "evt-3", name: "Someone else's gala", organiser_id: other, status: "submitted" },
    );
    const res = await request(app).get("/dashboard").set("Cookie", await signInAs("org@example.com", "event_organiser"));

    const [myEvents] = res.body.sections;
    expect(myEvents.columns).toContainEqual({ key: "name", label: "Event", linkKey: "eventHref" });
    expect(myEvents.columns).toContainEqual({ key: "status", label: "Status", linkKey: "eventHref", statusKey: "statusKey" });
    expect(myEvents.rows).toEqual([expect.objectContaining({ name: "My conference", eventHref: "/events/evt-2" })]);
  });

  // venue_bookings has two FKs to venues (venue_id, suggested_venue_id); a bare `venues(name)` embed makes PostgREST
  // answer PGRST201 and the whole dashboard 500s. The in-memory fake can't raise that, so pin the embed instead.
  it.each(["event_coordinator", "venue_staff"])("SCRUM-32/AC1 %s dashboard names the venue FK when embedding venues", async (role) => {
    fake.seedUser(`${role}@example.com`, role);
    await sectionTitles(`${role}@example.com`, role);

    const bookingSelects = fake.selects.filter((s) => s.table === "venue_bookings");
    expect(bookingSelects).not.toHaveLength(0);
    for (const { columns } of bookingSelects) {
      expect(columns).toContain("venues!venue_bookings_venue_id_fkey(name)");
    }
  });

  // SCRUM-71/AC1: the old "Events open for booking" table is gone; the List of events replaces it (event-service)
  it("shows an attendee their registrations, and no events catalogue table", async () => {
    const me = fake.seedUser("att@example.com", "attendee");
    fake.tables.event_registrations.push({ attendee_id: me, status: "registered", event: { name: "Tech Summit" } });
    fake.tables.events.push({ name: "Open day", status: "confirmed", registration_required: true });
    const cookie = await signInAs("att@example.com", "attendee");
    const res = await request(app).get("/dashboard").set("Cookie", cookie);

    expect(res.body.sections).toHaveLength(1);
    // A registered registration reads "confirmed" since SCRUM-83/AC15 (statuses in the attendee's words)
    expect(res.body.sections[0].rows).toEqual([expect.objectContaining({ event: "Tech Summit", status: "confirmed" })]);
  });

  // SCRUM-83/AC15: registrations show in the attendee's words, as on "My registrations": a new registration is
  // stored as 'waitlisted' but is Pending to the attendee
  it("SCRUM-83/AC15 shows an attendee's waitlisted registration as pending", async () => {
    const me = fake.seedUser("att@example.com", "attendee");
    fake.tables.event_registrations.push({ attendee_id: me, status: "waitlisted", event: { name: "Tech Summit" } });
    const cookie = await signInAs("att@example.com", "attendee");
    const res = await request(app).get("/dashboard").set("Cookie", cookie);

    expect(res.body.sections[0].rows).toEqual([expect.objectContaining({ event: "Tech Summit", status: "pending" })]);
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
// SCRUM-17 — Logout of ConnectSphere (US4)
// ---------------------------------------------------------------------------
describe("SCRUM-17 — Logout", () => {
  // AC2: logout invalidates the current session
  it("SCRUM-17/AC2 invalidates the session on Supabase, so the old token no longer works", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const cookie = await signInAs("rachel@example.com", "event_coordinator");
    expect((await request(app).get("/auth/me").set("Cookie", cookie)).status).toBe(200);

    const res = await request(app).post("/auth/logout").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(fake.calls.signedOut).toContain(cookie.replace("cs_session=", ""));
    expect((await request(app).get("/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("SCRUM-17/AC2 clears the session cookie", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const cookie = await signInAs("rachel@example.com", "event_coordinator");
    const res = await request(app).post("/auth/logout").set("Cookie", cookie);

    const setCookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(setCookie).toMatch(/^cs_session=;/);
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("SCRUM-17/AC2 still succeeds when there is no active session", async () => {
    const res = await request(app).post("/auth/logout");
    expect(res.status).toBe(200);
  });
  // end of AC2

  // AC4: Back re-sends the previous page's request with the old cookie; the data behind it is refused
  it("SCRUM-17/AC4 refuses the previous page's data when it is requested again after logout", async () => {
    fake.seedUser("rachel@example.com", "event_coordinator");
    const cookie = await signInAs("rachel@example.com", "event_coordinator");
    expect((await request(app).get("/dashboard").set("Cookie", cookie)).status).toBe(200);

    await request(app).post("/auth/logout").set("Cookie", cookie);

    expect((await request(app).get("/dashboard").set("Cookie", cookie)).status).toBe(401);
  });
  // end of AC4
});
// end of SCRUM-17

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

// ---------------------------------------------------------------------------
// SCRUM-71 — View Event Information: the List of events is on the attendee dashboard
// ---------------------------------------------------------------------------
describe("SCRUM-71 — Back to the List of events after signing in", () => {
  // AC6: a guest sent to the sign-in page returns to the list afterwards, because an attendee's sign-in
  // lands on /dashboard/attendee, where the List of events is
  it("SCRUM-71/AC6 sends an attendee to the attendee dashboard after signing in", async () => {
    fake.seedUser("alicia@example.com", "attendee");
    const res = await login("alicia@example.com", "Passw0rd!", "attendee");

    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBe("/dashboard/attendee");
  });
  // end of AC6
});
// end of SCRUM-71

// ---------------------------------------------------------------------------
// SCRUM-75 — An Event Coordinator Lead signs in through the same login as everyone else (SCRUM-13)
// ---------------------------------------------------------------------------
describe("SCRUM-75 — Event Coordinator Lead sign-in", () => {
  const LEAD = "event_coordinator_lead";

  // AC2: an account set up with the Lead role is recognised as a Lead when it logs in
  it("SCRUM-75/AC2 recognises a Lead account as a Lead when it logs in", async () => {
    fake.seedUser("helen@example.com", LEAD);
    const res = await login("helen@example.com", "Passw0rd!", LEAD);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: "helen@example.com", role: LEAD });
    const me = await request(app).get("/auth/me").set("Cookie", (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0]);
    expect(me.body.role).toBe(LEAD);
  });
  // end of AC2

  // AC3: login, the generic error and password reset behave exactly as SCRUM-13 does for every other role
  it("SCRUM-75/AC3 shows the same generic error for a Lead's wrong password", async () => {
    fake.seedUser("helen@example.com", LEAD);
    const res = await login("helen@example.com", "WrongPass1!", LEAD);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: INVALID_LOGIN_MESSAGE });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("SCRUM-75/AC3 a Lead is not let in as an Event Coordinator, and a coordinator is not let in as a Lead", async () => {
    fake.seedUser("helen@example.com", LEAD);
    fake.seedUser("rachel@example.com", "event_coordinator");
    const leadAsCoordinator = await login("helen@example.com", "Passw0rd!", "event_coordinator");
    const coordinatorAsLead = await login("rachel@example.com", "Passw0rd!", LEAD);

    for (const res of [leadAsCoordinator, coordinatorAsLead]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: INVALID_LOGIN_MESSAGE });
    }
    expect(fake.sessions.size).toBe(0);
  });

  it("SCRUM-75/AC3 sends a Lead a password reset email, and the new password works", async () => {
    const id = fake.seedUser("helen@example.com", LEAD);
    const forgot = await request(app).post("/auth/forgot-password").send({ email: "helen@example.com" });
    expect(forgot.status).toBe(200);
    expect(fake.calls.resetEmails).toEqual([{ email: "helen@example.com", redirectTo: "http://localhost:3000/reset-password" }]);

    const reset = await request(app).post("/auth/reset-password").send({ accessToken: `reset-${id}`, password: "N3wPassw0rd!" });
    expect(reset.status).toBe(200);
    expect((await login("helen@example.com", "N3wPassw0rd!", LEAD)).status).toBe(200);
  });
  // end of AC3

  // AC4: a successful login lands on the Lead home page
  it("SCRUM-75/AC4 sends a Lead to the Lead home page after signing in", async () => {
    fake.seedUser("helen@example.com", LEAD);
    const res = await login("helen@example.com", "Passw0rd!", LEAD);

    expect(res.body.redirectTo).toBe("/dashboard/event_coordinator_lead");
  });
  // end of AC4
});
// end of SCRUM-75

// ---------------------------------------------------------------------------
// SCRUM-116 — Safety Officer sign-in
// ---------------------------------------------------------------------------
describe("SCRUM-116/AC4 — Safety Officer sign-in", () => {
  it("SCRUM-116/AC4 a Safety Officer logs in with the Safety Officer role and is sent to their own dashboard", async () => {
    fake.seedUser("farah@example.com", "safety_officer");
    const res = await login("farah@example.com", "Passw0rd!", "safety_officer");

    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBe("/dashboard/safety_officer");
    expect(res.body.user).toMatchObject({ email: "farah@example.com", role: "safety_officer" });
  });
});
