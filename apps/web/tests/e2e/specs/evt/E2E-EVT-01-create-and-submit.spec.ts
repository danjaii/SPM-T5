import { EventRequestPage } from "../../pages/EventRequestPage";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-49 and SCRUM-52: the organiser fills the six-step form and submits; the request is stored as submitted (not a draft) with
// what was typed, and it appears in My event requests as Submitted.
const t = tc("E2E-EVT-01");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const name = data.name("Request");
  data.trackWhere("events", `name=eq.${encodeURIComponent(name)}`);
  const organiser = await as("organiser");
  const form = new EventRequestPage(organiser);

  await test.step("the organiser fills every step and submits", async () => {
    await form.open();
    await form.basics({ name, purpose: "Customer appreciation evening", description: "Dinner and a short keynote for our top customers." });
    await form.continueTo("Date & attendance");
    await form.schedule({ start: `${DAY}T18:00`, end: `${DAY}T21:00`, attendance: 60 });
    await form.continueTo("Venue needs");
    await form.venueNeeds({ requirements: "Round tables and a small stage.", layout: "Banquet" });
    await form.continueTo("Equipment");
    await form.equipment("One projector and a lectern microphone.");
    await form.continueTo("Registration");
    await form.noRegistration();
    await form.continueTo("Review & submit");
    await organiser.getByText(name).first().waitFor(); // the review step shows what will be sent
    await form.submit();
  });

  await test.step("it is stored as a submitted request with what was typed (49)", async () => {
    await expect
      .poll(async () => (await data.rest<{ status: string; is_draft: boolean }[]>(`events?select=status,is_draft&name=eq.${encodeURIComponent(name)}`))[0])
      .toEqual({ status: "submitted", is_draft: false });
    const [row] = await data.rest<{ organiser_id: string; expected_attendance: number; purpose: string; registration_required: boolean }[]>(
      `events?select=organiser_id,expected_attendance,purpose,registration_required&name=eq.${encodeURIComponent(name)}`,
    );
    expect(row).toEqual({ organiser_id: await data.idOf("organiser"), expected_attendance: 60, purpose: "Customer appreciation evening", registration_required: false });
  });

  await test.step("My event requests lists it as Submitted (52)", async () => {
    await organiser.goto("/my-event-requests");
    await expect(organiser.getByRole("row").filter({ hasText: name })).toContainText("Submitted");
  });
});
