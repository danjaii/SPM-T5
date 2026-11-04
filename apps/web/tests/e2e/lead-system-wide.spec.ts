import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// SCRUM-184 (docs/specs/lead-system-wide-scope.md): a Lead sees and assigns across every coordinator. Needs the whole local stack
// (supabase start + seed, auth-service, event-service) and the service-role key to arrange throwaway fixtures; CI's e2e job has
// none of that. Opt in with E2E_FULL_STACK=1 and SUPABASE_URL + SUPABASE_SECRET_KEY set. Screenshots go to
// C:\dev\SPM-T5-screenshots\SCRUM-184\.
test.skip(!process.env.E2E_FULL_STACK, "set E2E_FULL_STACK=1 with the local stack running");

const PASSWORD = "ConnectSphere2026!";
const SHOTS = "C:\\dev\\SPM-T5-screenshots\\SCRUM-184";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const HELEN = "helen.ong@connectsphere.example.com"; // Lead A, who supervises Rachel Tan and Marcus Lim
const SAMUEL = "samuel.tay@connectsphere.example.com"; // Lead B, who supervises the coordinator made below

test.describe.configure({ mode: "serial" });

const suffix = Math.random().toString(36).slice(2, 7);
const coordinatorName = `IT-184 Coordinator ${suffix}`;
const eventName = `IT-184 Request ${suffix}`;
let coordinatorId = "";
let eventId = "";

const headers = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
const rest = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...headers, Prefer: "return=representation", ...init.headers } });
  if (!res.ok) throw new Error(`${path}: ${await res.text()}`);
  return res.status === 204 ? [] : res.json();
};
const userId = async (email: string) => (await rest(`users?email=eq.${encodeURIComponent(email)}&select=id`))[0].id as string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const [samuel, organiser] = await Promise.all([userId(SAMUEL), userId("jason.chua@techconnect.example.com")]);
  const email = `it-184-${suffix}@connectsphere.example.com`;
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  if (!created.ok) throw new Error(await created.text());
  coordinatorId = (await created.json()).id as string;
  // linked to Samuel Tay (Lead B), not to Helen Ong, who will assign to them
  await rest("users", {
    method: "POST",
    body: JSON.stringify({ id: coordinatorId, role: "event_coordinator", full_name: coordinatorName, email, is_active: true, supervising_lead_id: samuel }),
  });
  eventId = (
    await rest("events", {
      method: "POST",
      body: JSON.stringify({
        name: eventName,
        organiser_id: organiser,
        status: "submitted",
        is_draft: false,
        preferred_start_datetime: "2031-09-01T02:00:00Z",
        preferred_end_datetime: "2031-09-01T06:00:00Z",
        expected_attendance: 60,
        submitted_at: "2031-01-01T00:00:00Z",
      }),
    })
  )[0].id as string;
});

test.afterAll(async () => {
  if (eventId) await rest(`events?id=eq.${eventId}`, { method: "DELETE" }); // cascades the assignment log and notifications
  if (coordinatorId) {
    await rest(`users?id=eq.${coordinatorId}`, { method: "PATCH", body: JSON.stringify({ supervising_lead_id: null }) });
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${coordinatorId}`, { method: "DELETE", headers }); // cascades to users
  }
});

async function signInAsLead(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(HELEN);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("combobox", { name: "Continue as" }).click();
  await page.getByRole("option", { name: "Event Coordinator Lead", exact: true }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard\/event_coordinator_lead$/);
}

test.describe("SCRUM-184 the Lead works across every coordinator", () => {
  test("184-S2: the overview lists a coordinator another Lead supervises, with their workload", async ({ page }) => {
    await signInAsLead(page);
    await page.goto("/lead/coordinators");

    await expect(page.getByText(coordinatorName)).toBeVisible();
    await expect(page.getByText("Priya Nair")).toBeVisible(); // seeded, also Samuel Tay's
    await expect(page.getByText("Rachel Tan").first()).toBeVisible(); // Helen Ong's own
    await page.screenshot({ path: `${SHOTS}\\01-overview-all-coordinators.png`, fullPage: true });
  });

  test("184-S1: the unassigned queue shows the request", async ({ page }) => {
    await signInAsLead(page);
    await page.goto("/lead/queue");

    await expect(page.getByText(eventName)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\02-queue.png`, fullPage: true });
  });

  test("184-S3: the Lead assigns the request to another Lead's coordinator", async ({ page }) => {
    await signInAsLead(page);
    await page.goto(`/lead/events/${eventId}/assign`);

    await page.getByRole("radio", { name: new RegExp(coordinatorName) }).click();
    await page.screenshot({ path: `${SHOTS}\\03-choose-other-leads-coordinator.png`, fullPage: true });
    await page.getByRole("button", { name: "Confirm assignment" }).click();

    await expect(page.getByRole("status").filter({ hasText: `is now assigned to ${coordinatorName}` })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\04-assigned.png`, fullPage: true });
    await expect.poll(async () => (await rest(`events?id=eq.${eventId}&select=assigned_coordinator_id`))[0].assigned_coordinator_id).toBe(coordinatorId);
    const logs = await rest(`coordinator_assignment_logs?event_id=eq.${eventId}&select=coordinator_id,previous_coordinator_id`);
    expect(logs).toEqual([{ coordinator_id: coordinatorId, previous_coordinator_id: null }]);
  });

  test("184-S2: the assignment now shows in the overview, and the Lead lists that coordinator's events", async ({ page }) => {
    await signInAsLead(page);
    await page.goto(`/lead/coordinators/${coordinatorId}`);

    await expect(page.getByText(eventName)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}\\05-other-leads-coordinator-events.png`, fullPage: true });
  });
});
