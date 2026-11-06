import { ACCOUNTS } from "../../fixtures/accounts";
import { waitForHydration } from "../../fixtures/hydration";
import { AttendeePages } from "../../pages/AttendeePages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-154 (docs/specs/users-contact-privacy.md): contact details of attendees go only to the people who need them. The event's
// organiser and its assigned coordinator see every registrant's name, email and phone; another coordinator gets neither the
// rows nor the details (154-S5); a person still sees their own details (154-S9, S3).
const t = tc("E2E-ACL-04");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const event = await data.event({ status: "confirmed", day: DAY, start: "09:00", end: "17:00", registration: { capacity: 30 } }); // Jason's, Rachel's
  // Bryan registered before the form existed: no form details, so the list falls back to his profile through the database function
  await data.insert("event_registrations", { event_id: event.id, attendee_id: await data.idOf("attendee2"), status: "registered", registration_details: null });

  await test.step("the registration form prefills the attendee's own email and contact number (154-S9, AC5)", async () => {
    const attendee = await as("attendee");
    await attendee.goto(`/events/${event.id}/register`);
    await waitForHydration(attendee, "#name");
    await expect(attendee.getByLabel("Email")).toHaveValue(ACCOUNTS.attendee.email);
    await expect(attendee.getByLabel("Name")).not.toHaveValue("");
    await expect(attendee.getByLabel("Contact number")).not.toHaveValue("");
    await attendee.getByRole("button", { name: "Register" }).click();
    await expect(new AttendeePages(attendee).registered).toBeVisible();
  });

  await test.step("the organiser and the assigned coordinator see both registrants' contact details (154-S4, S8, AC3)", async () => {
    for (const person of ["organiser", "coordinator"] as const) {
      const page = await as(person);
      await page.goto(`/events/${event.id}/registrations`);
      await expect(page.getByRole("cell", { name: ACCOUNTS.attendee.email }), `${person} sees Alicia, from her form`).toBeVisible();
      await expect(page.getByRole("cell", { name: ACCOUNTS.attendee2.email }), `${person} sees Bryan, from his profile`).toBeVisible();
    }
  });

  await test.step("another coordinator gets no registrants and no contact details (154-S5, AC4)", async () => {
    const other = await as("coordinator2");
    await other.goto(`/events/${event.id}/registrations`);
    await expect(other.getByRole("heading", { level: 1 })).toBeVisible(); // the page rendered, so the empty result is not a blank screen
    await expect(other.getByText(ACCOUNTS.attendee.email)).toHaveCount(0);
    await expect(other.getByText(ACCOUNTS.attendee2.email)).toHaveCount(0);
    await expect(other.getByRole("row").filter({ hasText: /@/ })).toHaveCount(0);
  });

  await test.step("a coordinator still sees their own contact details on the profile page (154-S3, AC5)", async () => {
    const page = await as("coordinator");
    await page.goto("/profile");
    await expect(page.getByLabel("Contact email")).toHaveValue(ACCOUNTS.coordinator.email);
    await expect(page.getByLabel("Phone")).not.toHaveValue("");
  });
});
