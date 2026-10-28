import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";

// SCRUM-154 (docs/specs/users-contact-privacy.md): needs the whole local stack (supabase start + seed, auth-service,
// event-service, web), which CI's e2e job doesn't run. Opt in with E2E_FULL_STACK=1, and set SUPABASE_SECRET_KEY (the local
// service-role key) so this spec can arrange its own rows: nothing is added to supabase/seed.sql.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");
test.describe.configure({ mode: "serial" });

const PASSWORD = "ConnectSphere2026!";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const AUTH_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-154";
const EVENT_NAME = "E2E-154 Contact privacy";

const ACCOUNTS = {
  attendee: { email: "alicia.fernandez@example.com", role: "attendee" },
  otherAttendee: { email: "bryan.ho@example.com", role: "attendee" },
  organiser: { email: "jason.chua@techconnect.example.com", role: "event_organiser" },
  coordinator: { email: "rachel.tan@connectsphere.example.com", role: "event_coordinator" },
  otherCoordinator: { email: "marcus.lim@connectsphere.example.com", role: "event_coordinator" },
} as const;
type Who = keyof typeof ACCOUNTS;

/** The service-role REST API: bypasses RLS, so it can arrange rows a signed-in user could never write. */
async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SECRET_KEY,
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json().catch(() => null)) as T;
}

const userId = async (email: string) => (await rest<{ id: string }[]>(`users?select=id&email=eq.${email}`))[0].id;

/** Signs in through auth-service and opens a page in a fresh browser context that carries that session cookie. */
async function openAs(browser: Browser, who: Who): Promise<Page> {
  const { email, role } = ACCOUNTS[who];
  const res = await fetch(`${AUTH_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, role }),
  });
  if (!res.ok) throw new Error(`login as ${who} failed: ${res.status}`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("cs_session="));
  if (!cookie) throw new Error("no cs_session cookie in the login reply");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "cs_session", value: cookie.split(";")[0].slice("cs_session=".length), url: "http://localhost:3000" }]);
  return context.newPage();
}

let eventId: string;
let coordinatorOriginal: { phone: string | null; communication_preferences: unknown };

test.beforeAll(async () => {
  test.skip(!SECRET_KEY, "set SUPABASE_SECRET_KEY to the local service-role key");
  mkdirSync(SHOTS, { recursive: true });

  const [organiser, coordinator, other] = await Promise.all([
    userId(ACCOUNTS.organiser.email),
    userId(ACCOUNTS.coordinator.email),
    userId(ACCOUNTS.otherAttendee.email),
  ]);
  coordinatorOriginal = (
    await rest<{ phone: string | null; communication_preferences: unknown }[]>(
      `users?select=phone,communication_preferences&id=eq.${coordinator}`,
    )
  )[0];

  // a public, confirmed event the attendees can register for, organised by Jason and assigned to Rachel
  const [event] = await rest<{ id: string }[]>("events", {
    method: "POST",
    body: JSON.stringify({
      name: EVENT_NAME,
      organiser_id: organiser,
      assigned_coordinator_id: coordinator,
      status: "confirmed",
      is_draft: false,
      expected_attendance: 50,
      registration_required: true,
      preferred_start_datetime: "2031-06-15T01:00:00Z",
      preferred_end_datetime: "2031-06-15T09:00:00Z",
    }),
  });
  eventId = event.id;

  // Bryan registered before the form existed: no form details, so the list must fall back to his profile (through the function)
  await rest("event_registrations", {
    method: "POST",
    body: JSON.stringify({ event_id: eventId, attendee_id: other, status: "registered", registration_details: null }),
  });
});

test.afterAll(async () => {
  if (!SECRET_KEY) return;
  if (eventId) await rest(`events?id=eq.${eventId}`, { method: "DELETE" }); // cascades the registrations
  const coordinator = await userId(ACCOUNTS.coordinator.email);
  await rest(`users?id=eq.${coordinator}`, { method: "PATCH", body: JSON.stringify(coordinatorOriginal) });
});

test("SCRUM-154/AC5 the registration form still prefills the attendee's own email and phone (154-S9)", async ({ browser }) => {
  const page = await openAs(browser, "attendee");
  await page.goto(`/events/${eventId}/register`);
  await expect(page.getByLabel("Email")).toHaveValue(ACCOUNTS.attendee.email);
  await expect(page.getByLabel("Name")).not.toHaveValue("");
  await expect(page.getByLabel("Contact number")).not.toHaveValue("");
  await page.screenshot({ path: `${SHOTS}\\01-attendee-registration-form-prefilled.png` });

  await page.getByRole("button", { name: "Register" }).click();
  // the form stays on screen; a status alert confirms the registration (SCRUM-83/AC14)
  await expect(page.getByRole("status")).toContainText(`You're registered for ${EVENT_NAME}`, { timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}\\02-attendee-registered.png` });
});

test("SCRUM-154/AC3 the event's organiser sees every registrant's name, email and phone (154-S4, S8)", async ({ browser }) => {
  const page = await openAs(browser, "organiser");
  await page.goto(`/events/${eventId}/registrations`);
  await expect(page.getByRole("cell", { name: ACCOUNTS.attendee.email })).toBeVisible(); // from the form Alicia just sent
  await expect(page.getByRole("cell", { name: ACCOUNTS.otherAttendee.email })).toBeVisible(); // from Bryan's profile, via the function
  await page.screenshot({ path: `${SHOTS}\\03-organiser-sees-registrants.png` });
});

test("SCRUM-154/AC3 the event's assigned coordinator sees the same registrants (154-S4, S8)", async ({ browser }) => {
  const page = await openAs(browser, "coordinator");
  await page.goto(`/events/${eventId}/registrations`);
  await expect(page.getByRole("cell", { name: ACCOUNTS.attendee.email })).toBeVisible();
  await expect(page.getByRole("cell", { name: ACCOUNTS.otherAttendee.email })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}\\04-assigned-coordinator-sees-registrants.png` });
});

test("SCRUM-154/AC4 another coordinator gets no registrants and no contact details (154-S5)", async ({ browser }) => {
  const page = await openAs(browser, "otherCoordinator");
  await page.goto(`/events/${eventId}/registrations`);
  await expect(page.getByText("Nobody has registered for this event yet.")).toBeVisible();
  await expect(page.getByText(ACCOUNTS.attendee.email)).toHaveCount(0);
  await expect(page.getByText(ACCOUNTS.otherAttendee.email)).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}\\05-other-coordinator-sees-nothing.png` });
});

test("SCRUM-154/AC5 a user still sees and edits their own contact details on the profile page (154-S3, S6, S9)", async ({ browser }) => {
  const page = await openAs(browser, "coordinator");
  await page.goto("/profile");
  await expect(page.getByLabel("Contact email")).toHaveValue(ACCOUNTS.coordinator.email);
  await expect(page.getByLabel("Phone")).not.toHaveValue("");
  await page.screenshot({ path: `${SHOTS}\\06-profile-shows-own-contact-details.png` });

  await page.getByLabel("Phone").fill("+65 9000 1540");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile updated.")).toBeVisible();
  await expect(page.getByLabel("Phone")).toHaveValue("+65 9000 1540");
  await page.screenshot({ path: `${SHOTS}\\07-profile-edit-saved.png` });
});
