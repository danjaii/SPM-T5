import { BookingDecisionPage } from "../../pages/BookingPages";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-185/AC3 (docs/specs/replacement-confirmed-notice.md) and SCRUM-172: when the last replacement arrangement of an event a
// venue block sent back to Planning is approved, the event moves on and the organiser and the registered attendees are told.
// A withdrawn attendee is not (receivesEventUpdates), nor the coordinator, nor the Venue Staff who approved.
const t = tc("E2E-NOTIF-03");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const venue = await data.venue({ capacity: 200, label: "Replacement venue" });
  // an event a venue block returned to Planning (migration 82 leaves exactly this history row), with its replacement waiting
  const event = await data.event({ status: "planning", coordinator: "coordinator", day: DAY, start: "09:00", end: "17:00", label: "Re-plan" });
  await data.insert("event_status_history", {
    event_id: event.id, old_status: "confirmed", new_status: "planning", changed_by: await data.idOf("venueStaff"),
    reason: "The original venue is unavailable, so the event was returned to Planning.", changed_at: new Date(Date.now() - 3_600_000).toISOString(),
  });
  const replacement = await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "09:00", end: "17:00", status: "requested" });
  const details = (name: string, email: string) => ({ name, email, phone: "+65 9123 4567" });
  for (const [who, status] of [["attendee", "registered"], ["attendee2", "withdrawn"]] as const) {
    const email = who === "attendee" ? "alicia.fernandez@example.com" : "bryan.ho@example.com";
    await data.insert("event_registrations", { event_id: event.id, attendee_id: await data.idOf(who), status, registration_details: details("E2E", email) });
  }

  await test.step("Venue Staff approve the replacement, the last open arrangement, and the event moves on (185-S3)", async () => {
    const decision = new BookingDecisionPage(await as("venueStaff"));
    await decision.open(replacement.id);
    await decision.approve();
    await expect.poll(async () => (await data.rest<{ status: string }[]>(`events?select=status&id=eq.${event.id}`))[0].status).toBe("awaiting_arrangements");
  });

  await test.step("only the organiser and the registered attendee were told, once each, and nobody else (172)", async () => {
    const told = (await data.rest<{ user_id: string }[]>(`notifications?select=user_id&event_id=eq.${event.id}&type=eq.arrangements_reconfirmed`)).map((n) => n.user_id).sort();
    const expected = (await Promise.all([data.idOf("organiser"), data.idOf("attendee")])).sort();
    expect(told, "organiser and the registered attendee: not the withdrawn attendee, the coordinator or the Venue Staff who approved").toEqual(expected);
  });

  await test.step("the organiser and the attendee see the notice on their notifications page, and it asks for no action", async () => {
    const organiser = await as("organiser");
    await organiser.goto("/notifications");
    const row = organiser.getByRole("listitem").filter({ hasText: event.name }).filter({ hasText: "Arrangements confirmed" });
    await expect(row).toContainText(`replacement arrangements are confirmed. Venue: ${venue.name}.`);
    await expect(row).not.toContainText("Action needed");

    const attendee = await as("attendee");
    await attendee.goto("/notifications");
    await expect(attendee.getByRole("listitem").filter({ hasText: event.name }).filter({ hasText: "Arrangements confirmed" }))
      .toContainText("The event will be confirmed once its safety check is done.");
  });

  await test.step("the withdrawn attendee has no notice", async () => {
    const withdrawn = await as("attendee2");
    await withdrawn.goto("/notifications");
    await expect(withdrawn.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(withdrawn.getByText(event.name)).toHaveCount(0);
  });
});
