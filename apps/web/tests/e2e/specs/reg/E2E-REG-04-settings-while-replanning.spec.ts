import { waitForHydration } from "../../fixtures/hydration";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-185/AC4 (docs/specs/registration-settings-while-replanning.md): while an event is back in Planning, registration is closed.
// The assigned coordinator sees that, and can adjust the capacity and the registration window, but not below the attendees already
// confirmed, which nothing saves. The organiser sees the registrations but no settings form.
const t = tc("E2E-REG-04");
const ATTENDEES = ["alicia.fernandez@example.com", "bryan.ho@example.com", "chen.wei.jie@example.com", "deepa.krishnan@example.com", "ethan.tan@example.com"];

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const event = await data.event({ status: "planning", coordinator: "coordinator", day: DAY, start: "09:00", end: "17:00", registration: { capacity: 100 }, label: "Replanning" });
  for (const email of ATTENDEES) {
    await data.insert("event_registrations", { event_id: event.id, attendee_id: await data.userId(email), status: "registered", registration_details: { name: "E2E", email, phone: "+65 9123 4567" } });
  }
  const settings = async () => (await data.rest<{ registration_capacity: number; registration_opens_at: string; registration_closes_at: string }[]>(
    `events?select=registration_capacity,registration_opens_at,registration_closes_at&id=eq.${event.id}`))[0];

  const page = await as("coordinator");
  await page.goto(`/events/${event.id}?tab=registrations`);
  await waitForHydration(page, "#registrationCapacity");

  await test.step("185-S4g: the coordinator sees the settings, and that registration is closed while the event is in Planning", async () => {
    await expect(page.getByRole("heading", { name: "Registration settings" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Registration is closed while this event is Planning");
    await expect(page.getByLabel("Capacity")).toHaveValue("100");
    await expect(page.getByText("5 attendees are confirmed")).toBeVisible();
  });

  await test.step("185-S4c: a capacity below the confirmed attendees is refused next to the field, and saves nothing", async () => {
    await page.getByLabel("Capacity").fill("4");
    await page.getByRole("button", { name: "Save registration settings" }).click();
    await expect(page.getByText("5 attendees are already confirmed, so the capacity can't be lower than 5.")).toBeVisible();
    expect((await settings()).registration_capacity).toBe(100);
  });

  await test.step("185-S4b: the coordinator adjusts the capacity and the window, and it is saved; nobody is dropped", async () => {
    await page.getByLabel("Capacity").fill("40");
    await page.getByLabel("Registration opens").fill("2031-10-01T09:00");
    await page.getByLabel("Registration closes").fill("2031-11-13T09:00");
    await page.getByRole("button", { name: "Save registration settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Registration settings saved." })).toBeVisible();
    await expect.poll(async () => (await settings()).registration_capacity).toBe(40);
    const saved = await settings();
    expect(new Date(saved.registration_opens_at).toISOString()).toBe("2031-10-01T01:00:00.000Z"); // 09:00 Singapore time
    expect(new Date(saved.registration_closes_at).toISOString()).toBe("2031-11-13T01:00:00.000Z");
    expect(await data.rest<unknown[]>(`event_registrations?select=id&event_id=eq.${event.id}&status=eq.registered`)).toHaveLength(5);
  });

  await test.step("185-S4e: the organiser sees the Registrations tab but no settings form", async () => {
    const organiser = await as("organiser");
    await organiser.goto(`/events/${event.id}?tab=registrations`);
    await expect(organiser.getByRole("link", { name: "View registrations" })).toBeVisible();
    await expect(organiser.getByRole("heading", { name: "Registration settings" })).toHaveCount(0);
  });
});
