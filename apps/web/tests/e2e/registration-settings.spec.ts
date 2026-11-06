import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-185/AC4 (docs/specs/registration-settings-while-replanning.md): needs the whole local stack (supabase start + seed,
// auth-service, event-service, notification-service) and the service-role key to arrange throwaway fixtures; CI's e2e job has none of
// that. Opt in with E2E_FULL_STACK=1 and SUPABASE_URL + SUPABASE_SECRET_KEY set. Happy-path screenshots go to
// C:\dev\SPM-T5-screenshots\SCRUM-185-AC4\.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-185-AC4";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const ATTENDEES = ["alicia.fernandez@example.com", "bryan.ho@example.com", "chen.wei.jie@example.com", "deepa.krishnan@example.com", "ethan.tan@example.com"];

test.describe.configure({ mode: "serial" });

const suffix = Math.random().toString(36).slice(2, 7);
const eventName = `IT-Settings Summit-${suffix}`;
let eventId = "";

const rest = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers },
  });
  if (!res.ok) throw new Error(`${path}: ${await res.text()}`);
  return res.status === 204 ? [] : res.json();
};
const userId = async (email: string) => (await rest(`users?email=eq.${encodeURIComponent(email)}&select=id`))[0].id as string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const [rachel, organiser] = await Promise.all([userId("rachel.tan@connectsphere.example.com"), userId("jason.chua@techconnect.example.com")]);
  // an event a venue block returned to Planning, taking registrations, with five Confirmed registrations
  eventId = (
    await rest("events", {
      method: "POST",
      body: JSON.stringify({
        name: eventName,
        organiser_id: organiser,
        assigned_coordinator_id: rachel,
        status: "planning",
        is_draft: false,
        expected_attendance: 50,
        preferred_start_datetime: "2031-11-14T01:00:00Z",
        preferred_end_datetime: "2031-11-14T09:00:00Z",
        registration_required: true,
        registration_capacity: 100,
        registration_opens_at: "2031-01-01T00:00:00Z",
        registration_closes_at: "2031-11-10T00:00:00Z",
      }),
    })
  )[0].id as string;
  for (const email of ATTENDEES) {
    await rest("event_registrations", {
      method: "POST",
      body: JSON.stringify({ event_id: eventId, attendee_id: await userId(email), status: "registered", registration_details: { name: "IT", email, phone: "+65 9123 4567" } }),
    });
  }
});

test.afterAll(async () => {
  if (eventId) {
    await rest(`activity_log?entity_id=eq.${eventId}`, { method: "DELETE" });
    await rest(`events?id=eq.${eventId}`, { method: "DELETE" }); // registrations go with the event
  }
});

async function signIn(page: Page, role: string, email: string, dashboard: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("combobox", { name: "Continue as" }).click();
  await page.getByRole("option", { name: role, exact: true }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(dashboard);
}
const signInAsRachel = (page: Page) => signIn(page, "Event Coordinator", "rachel.tan@connectsphere.example.com", /\/dashboard\/event_coordinator$/);

// A value filled in before React hydrates the form is thrown away, so wait for the form to be live.
async function waitForLive(page: Page, selector: string) {
  await page.waitForFunction((css) => {
    const el = document.querySelector(css);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, selector);
}

const settingsOf = async () => (await rest(`events?id=eq.${eventId}&select=registration_capacity,registration_opens_at,registration_closes_at`))[0];

test.describe("SCRUM-185/AC4 registration while an event is back in Planning", () => {
  test("185-S4g: the coordinator sees the settings and that registration is closed while the event is in Planning", async ({ page }) => {
    await signInAsRachel(page);
    await page.goto(`/events/${eventId}?tab=registrations`);
    await waitForLive(page, "#registrationCapacity");

    await expect(page.getByRole("heading", { name: "Registration settings" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Registration is closed while this event is Planning");
    await expect(page.getByLabel("Capacity")).toHaveValue("100");
    await expect(page.getByText("5 attendees are confirmed")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\01-settings-planning.png`, fullPage: true });
  });

  test("185-S4c: a capacity below the confirmed attendees is refused next to the field and saves nothing", async ({ page }) => {
    await signInAsRachel(page);
    await page.goto(`/events/${eventId}?tab=registrations`);
    await waitForLive(page, "#registrationCapacity");

    await page.getByLabel("Capacity").fill("4");
    await page.getByRole("button", { name: "Save registration settings" }).click();

    await expect(page.getByText("5 attendees are already confirmed, so the capacity can't be lower than 5.")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\02-capacity-refused.png`, fullPage: true });
    expect((await settingsOf()).registration_capacity).toBe(100);
  });

  test("185-S4b: the coordinator adjusts the capacity and the window, and it is saved", async ({ page }) => {
    await signInAsRachel(page);
    await page.goto(`/events/${eventId}?tab=registrations`);
    await waitForLive(page, "#registrationCapacity");

    await page.getByLabel("Capacity").fill("40");
    await page.getByLabel("Registration opens").fill("2031-10-01T09:00");
    await page.getByLabel("Registration closes").fill("2031-11-13T09:00");
    await page.getByRole("button", { name: "Save registration settings" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Registration settings saved." })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\03-settings-saved.png`, fullPage: true });
    await expect.poll(async () => (await settingsOf()).registration_capacity).toBe(40);
    const saved = await settingsOf();
    expect(new Date(saved.registration_opens_at as string).toISOString()).toBe("2031-10-01T01:00:00.000Z");
    expect(new Date(saved.registration_closes_at as string).toISOString()).toBe("2031-11-13T01:00:00.000Z");
    expect(await rest(`event_registrations?event_id=eq.${eventId}&status=eq.registered&select=id`)).toHaveLength(5);
  });

  test("185-S4e: the organiser sees the Registrations tab but no settings form", async ({ page }) => {
    await signIn(page, "Event Organiser", "jason.chua@techconnect.example.com", /\/dashboard\/event_organiser$/);
    await page.goto(`/events/${eventId}?tab=registrations`);

    await expect(page.getByRole("link", { name: "View registrations" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Registration settings" })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}\\04-organiser-no-form.png`, fullPage: true });
  });
});
