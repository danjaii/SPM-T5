import { EventRequestPage } from "../../pages/EventRequestPage";
import { waitForButton } from "../../fixtures/hydration";
import { LeadQueuePage } from "../../pages/ReviewPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-53, 54 (and the draft screens, SCRUM-124): Save as draft keeps a half-filled request that nobody else sees; it is listed
// as a draft; resuming restores what was typed; saving again updates the SAME draft (no copy); submitting then puts it in front of
// the Lead.
const t = tc("E2E-EVT-02");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const name = data.name("Draft");
  data.trackWhere("events", `name=eq.${encodeURIComponent(name)}`);
  const organiser = await as("organiser");
  const lead = await as("lead");
  const form = new EventRequestPage(organiser);
  const drafts = () => data.rest<{ id: string; is_draft: boolean; expected_attendance: number | null }[]>(`events?select=id,is_draft,expected_attendance&name=eq.${encodeURIComponent(name)}`);

  await test.step("save a half-filled request as a draft", async () => {
    await form.open();
    await form.basics({ name, purpose: "Team offsite", description: "A planning day for the whole team." });
    await form.continueTo("Date & attendance");
    await form.schedule({ start: `${DAY}T09:00`, end: `${DAY}T17:00`, attendance: 25 });
    await form.saveDraft();
    const rows = await drafts();
    expect(rows).toHaveLength(1);
    expect(rows[0].is_draft).toBe(true);
  });

  await test.step("it is listed in My event requests as a draft, and the Lead does not see it", async () => {
    await organiser.goto("/my-event-requests");
    await expect(organiser.getByRole("row").filter({ hasText: name })).toContainText("Draft");

    const queue = new LeadQueuePage(lead);
    await queue.open();
    await expect(queue.row(name), "a draft is not a request yet").toHaveCount(0);
  });

  let draftId = "";
  await test.step("resuming restores what was typed, and saving again updates the same draft", async () => {
    draftId = (await drafts())[0].id;
    await organiser.getByRole("link", { name }).first().click();
    await expect(organiser).toHaveURL(new RegExp(`/events/new\\?draft=${draftId}`));
    // a resumed draft opens on the step it was saved on (SCRUM-124), with that step's values back
    await expect(organiser.getByRole("heading", { level: 2, name: "Date & attendance" })).toBeVisible();
    await expect(organiser.getByLabel("Expected attendance")).toHaveValue("25");
    await waitForButton(organiser, "Back");
    await organiser.getByRole("button", { name: "Back" }).click();
    await expect(organiser.getByLabel("Event name"), "the earlier step is restored too").toHaveValue(name);
    await form.continueTo("Date & attendance");

    await organiser.getByLabel("Expected attendance").fill("35");
    await form.saveDraft();
    const rows = await drafts();
    expect(rows, "still one draft, not a copy").toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: draftId, expected_attendance: 35 });
  });

  await test.step("finishing and submitting turns it into a request the Lead sees", async () => {
    await form.continueTo("Venue needs");
    await form.venueNeeds({ requirements: "A large room with breakout corners.", layout: "Classroom" });
    await form.continueTo("Equipment");
    await form.equipment("A projector.");
    await form.continueTo("Registration");
    await form.noRegistration();
    await form.continueTo("Review & submit");
    await form.submit();
    await expect.poll(async () => (await drafts())[0].is_draft).toBe(false);

    const queue = new LeadQueuePage(lead);
    await queue.open();
    await expect(queue.row(name)).toBeVisible();
  });
});
