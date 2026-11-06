import { expect } from "@playwright/test";
import { EventRequestPage } from "../../pages/EventRequestPage";
import { EventReviewPage, LeadQueuePage } from "../../pages/ReviewPages";
import { VenueRequestPage } from "../../pages/VenueRequestPage";
import { BookingQueuePage, VenueSearchPage } from "../../pages/VenueJourneyPages";
import { EquipmentQueuePage, EventEquipmentPage } from "../../pages/EquipmentJourneyPages";
import { SafetyCheckPages } from "../../pages/SafetyCheckPages";
import { AttendeePages } from "../../pages/AttendeePages";
import { waitForButton, waitForHydration } from "../../fixtures/hydration";
import { shot } from "../../fixtures/shots";
import type { Persona } from "../../fixtures/accounts";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { test } from "../../fixtures/test";

// The golden journey (Week 4 brief, the whole of release 1 in one pass), one browser context per person:
//   organiser drafts, saves, resumes and submits -> Lead assigns -> coordinator reviews and approves -> ...
// Stages share one event, so they run in order inside ONE test with a test.step per stage (a failure names the stage).
const t = tc("E2E-JRN-01");

test.describe.configure({ timeout: 360_000 }); // many pages, and `next dev` compiles each on its first visit

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  // a search only offers venues open at the event's times that have its layout: Theatre, 07:00-23:00, holding 100 (more than the 40 expected)
  const venue = await data.venue({ capacity: 100, hours: ["07:00", "23:00"], layout: "Theatre", accessible: true });
  const tooSmall = await data.venue({ capacity: 10, hours: ["07:00", "23:00"], layout: "Theatre", accessible: true, label: "Small venue" }); // same, but too small for 40: the search must leave it out
  const name = data.name("Journey");
  // everything the journey creates hangs off the event (all tables cascade), so one delete by name cleans up, even after a failure
  data.trackWhere("events", `name=eq.${encodeURIComponent(name)}`);

  const organiser = await as("organiser");
  const lead = await as("lead");
  const coordinator = await as("coordinator");
  const venueStaff = await as("venueStaff");
  const tech = await as("tech");
  const safety = await as("safety");
  const attendee = await as("attendee");
  const item = await data.equipment({ totalQuantity: 5 }); // our own item, so the journey does not depend on seeded stock

  let eventId = "";
  const statusOf = async () => (await data.rest<{ status: string }[]>(`events?select=status&id=eq.${eventId}`))[0].status;

  // who was told of an event's `type` notification (user ids, sorted), and who should have been (ids of personas, sorted)
  const told = async (type: string) =>
    (await data.rest<{ user_id: string }[]>(`notifications?select=user_id&event_id=eq.${eventId}&type=eq.${type}`)).map((n) => n.user_id).sort();
  const ids = async (...who: Persona[]) => (await Promise.all(who.map((w) => data.idOf(w)))).sort();

  const start = `${DAY}T09:00`;
  const end = `${DAY}T17:00`;
  const yesterday = new Date(Date.now() + 8 * 3600e3 - 86400e3).toISOString().slice(0, 16); // Singapore time, a datetime-local value

  await test.step("1 organiser drafts, saves, resumes and submits the request (SCRUM-49, 53, 54)", async () => {
    const form = new EventRequestPage(organiser);
    await form.open();
    await form.basics({ name, purpose: "Annual customer summit", description: "Keynotes, breakouts and a partner expo for customers." });
    await form.continueTo("Date & attendance");
    await form.schedule({ start, end, attendance: 40 });
    await form.continueTo("Venue needs");
    await form.venueNeeds({ requirements: "Stage, podium and two breakout areas.", layout: "Theatre" });
    await form.continueTo("Equipment");
    await form.equipment("Two projectors and four wireless microphones.");
    await form.saveDraft();

    const [draft] = await data.rest<{ id: string; status: string; is_draft: boolean }[]>(`events?select=id,status,is_draft&name=eq.${encodeURIComponent(name)}`);
    expect(draft.is_draft, "saved as a draft, not submitted").toBe(true);
    eventId = draft.id;

    // leave, then come back to it from My event requests
    await organiser.goto("/my-event-requests");
    await organiser.getByRole("link", { name }).first().click();
    await expect(organiser).toHaveURL(new RegExp(`/events/new\\?draft=${eventId}`));
    // a resumed draft opens on the step it was saved on (SCRUM-124): Equipment, with its text back; the first step is restored too
    await expect(organiser.getByRole("heading", { level: 2, name: "Equipment" })).toBeVisible();
    await expect(organiser.getByLabel("Equipment requirements", { exact: false })).toHaveValue("Two projectors and four wireless microphones.");
    await waitForButton(organiser, "Back");
    for (let i = 0; i < 3; i++) await organiser.getByRole("button", { name: "Back" }).click();
    await expect(organiser.getByLabel("Event name")).toHaveValue(name); // what was saved is back

    await form.continueTo("Date & attendance");
    await form.continueTo("Venue needs");
    await form.continueTo("Equipment");
    await form.continueTo("Registration");
    await form.registration({ capacity: 30, opens: yesterday, closes: `${DAY}T08:00` });
    await form.continueTo("Review & submit");
    await form.submit();

    await expect.poll(async () => (await data.rest<{ status: string; is_draft: boolean }[]>(`events?select=status,is_draft&id=eq.${eventId}`))[0]).toEqual({ status: "submitted", is_draft: false });
    // 172-AC1: every active Lead is told a request needs a coordinator
    await expect.poll(() => told("event_submitted")).toEqual(await ids("lead", "lead2"));
    await shot(organiser, "E2E-JRN-01", "01-organiser-submitted");
  });

  await test.step("2 the Lead assigns it to a coordinator (SCRUM-77, 78)", async () => {
    const queue = new LeadQueuePage(lead);
    await queue.open();
    await expect(queue.row(name)).toBeVisible();
    await queue.assign(name, "Rachel Tan");
    await expect(queue.row(name)).toHaveCount(0); // it has left the unassigned queue

    const [row] = await data.rest<{ assigned_coordinator_id: string }[]>(`events?select=assigned_coordinator_id&id=eq.${eventId}`);
    expect(row.assigned_coordinator_id).toBe(await data.idOf("coordinator"));
    // 47-AC1: the assigned coordinator, and nobody else, is told they are responsible
    await expect.poll(() => told("coordinator_assigned")).toEqual(await ids("coordinator"));
    await shot(lead, "E2E-JRN-01", "02-lead-assigned");
  });

  await test.step("3 the coordinator reviews and approves it (SCRUM-24, 44)", async () => {
    const review = new EventReviewPage(coordinator);
    await review.open(eventId);
    await review.startReview();
    await review.approve();
    await expect.poll(statusOf).toBe("approved");
    // 47-AC4: the organiser is told
    await expect.poll(() => told("event_approved")).toEqual(await ids("organiser"));
    await shot(coordinator, "E2E-JRN-01", "03-coordinator-approved");
  });

  await test.step("3b the coordinator moves it into Planning", async () => {
    // arrangements are tracked from Planning: the last approval moves a Planning event on by itself (SCRUM-171)
    await coordinator.goto(`/events/${eventId}`);
    await new EventReviewPage(coordinator).setStatus("Planning");
    await expect.poll(statusOf).toBe("planning");
  });

  await test.step("4 the coordinator searches venues, checks suitability and requests one (SCRUM-65, 109, 110, 32)", async () => {
    const search = new VenueSearchPage(coordinator);
    await search.openFromEvent(eventId);
    await expect(search.result(venue.name)).toBeVisible();
    await expect(search.result(tooSmall.name), "a venue smaller than the attendance is not offered").toHaveCount(0);

    const request = new VenueRequestPage(coordinator);
    await request.open(eventId);
    await request.fill({ venueName: venue.name, capacity: venue.max_capacity, date: DAY, start: "09:00", end: "17:00" });
    await coordinator.getByRole("button", { name: "Check suitability" }).click();
    await expect(coordinator.getByRole("region", { name: "Venue suitability" })).toContainText("Suitable");
    await shot(coordinator, "E2E-JRN-01", "04-venue-suitable");
    await request.submit();

    await expect(coordinator).toHaveURL(/\/venue-bookings\/[0-9a-f-]+$/);
    expect((await data.bookingsOf({ id: eventId, name }))).toEqual([expect.objectContaining({ status: "requested" })]);
    await shot(coordinator, "E2E-JRN-01", "05-booking-pending");
  });

  await test.step("5 venue staff approve the request (SCRUM-37, 38)", async () => {
    const queue = new BookingQueuePage(venueStaff);
    await queue.open();
    await queue.openRequest(name);
    await queue.approve();
    await expect.poll(async () => (await data.bookingsOf({ id: eventId, name }))[0]?.status).toBe("approved");
    // with no equipment asked for yet, the event's arrangements are complete, so the last approval moves it on by itself (SCRUM-171)
    await expect.poll(statusOf).toBe("awaiting_arrangements");
    // 172-AC2: the event's assigned coordinator is told of the decision
    await expect.poll(() => told("venue_booking_approved")).toEqual(await ids("coordinator"));
    await shot(venueStaff, "E2E-JRN-01", "06-venue-staff-approved");
  });

  await test.step("6 the coordinator asks for equipment and Technical Support arrange it (SCRUM-86, 87, 88)", async () => {
    const equipment = new EventEquipmentPage(coordinator);
    await equipment.addItem(eventId, item.name, 2);
    await expect(equipment.row(item.name)).toContainText("Submitted");
    expect(await statusOf(), "an open equipment request means the arrangements are not complete").toBe("awaiting_arrangements");

    const queue = new EquipmentQueuePage(tech);
    await queue.open(eventId);
    await queue.setStatus(item.name, "Arranged");
    await expect.poll(async () => (await data.reservationsOf(item))[0]?.status).toBe("approved");
  });

  await test.step("7 the Safety Officer approves the safety check (SCRUM-99)", async () => {
    const check = new SafetyCheckPages(safety);
    await check.openFromQueue(name);
    await check.decide("Approve", "Exits, capacity and accessibility are in order.");
    await expect(check.recorded).toContainText("Safety Approved");
    await shot(safety, "E2E-JRN-01", "07-safety-approved");
    // 47-AC12: the coordinator and the organiser are told
    await expect.poll(() => told("safety_approved")).toEqual(await ids("coordinator", "organiser"));
  });

  await test.step("8 the coordinator confirms the event (SCRUM-99/AC5, AC7)", async () => {
    await coordinator.goto(`/events/${eventId}`);
    await new EventReviewPage(coordinator).setStatus("Confirmed");
    await expect.poll(statusOf).toBe("confirmed");
    // 172-AC5: the organiser is told. The coordinator made the change, so is not (the team applies "never the person who did it" to every criterion)
    await expect.poll(() => told("event_confirmed")).toEqual(await ids("organiser"));
    await shot(coordinator, "E2E-JRN-01", "08-event-confirmed");
  });

  await test.step("9 an attendee finds the event, registers and then withdraws (SCRUM-83, 73)", async () => {
    const attendees = new AttendeePages(attendee);
    const register = await attendees.findRegisterButton(eventId, name);
    await expect(register, "the confirmed event is offered to attendees").toBeVisible();
    await register.click();
    await attendees.register({ name: "Alicia Fernandez", email: "alicia.fernandez@example.com", phone: "91234567" });
    await expect(attendees.registered).toContainText("Status:");
    await shot(attendee, "E2E-JRN-01", "09-attendee-registered");

    const mine = await attendees.row(name);
    await expect(mine).toBeVisible();

    await attendees.withdraw(name);
    await expect((await attendees.row(name))).toContainText("Withdrawn");
    await shot(attendee, "E2E-JRN-01", "10-attendee-withdrawn");

    // the database agrees, and the registration is kept as history, not deleted
    const rows = await data.rest<{ status: string }[]>(`event_registrations?select=status&event_id=eq.${eventId}`);
    expect(rows.map((r) => r.status)).toEqual(["withdrawn"]);
  });

  await test.step("10 the organiser asks for a change after confirmation (SCRUM-66)", async () => {
    await organiser.goto(`/events/${eventId}?tab=changes`);
    await expect(organiser.getByRole("heading", { name: "Request a change" })).toBeVisible();
    await waitForHydration(organiser, "#attendance, input");
    await organiser.getByLabel("Expected attendance").fill("60");
    await organiser.getByRole("button", { name: "Submit change request" }).click();
    await expect(organiser.getByText(/submitted for approval/)).toBeVisible();
    await expect(organiser.getByRole("heading", { name: "Change requests" })).toBeVisible();

    // the request waits for the coordinator: the event itself is unchanged until it is approved (66-S6)
    const requests = await data.rest<{ status: string; proposed_changes: Record<string, unknown> }[]>(`event_change_requests?select=status,proposed_changes&event_id=eq.${eventId}`);
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe("pending");
    const [event] = await data.rest<{ expected_attendance: number }[]>(`events?select=expected_attendance&id=eq.${eventId}`);
    expect(event.expected_attendance, "the event keeps its attendance until the change is approved").toBe(40);
  });

  await test.step("11 only the right people were told, and their notification lists show it (SCRUM-47, 172)", async () => {
    // people with nothing to do with this event heard nothing
    for (const who of ["coordinator2", "coordinator3", "organiser2", "attendee2"] as const) {
      const rows = await data.rest(`notifications?select=id&event_id=eq.${eventId}&user_id=eq.${await data.idOf(who)}`);
      expect(rows, `${who} has no part in this event`).toEqual([]);
    }

    // and on screen, each person's list carries their own messages for this event
    const screens: [typeof organiser, string[]][] = [
      [organiser, ["Your event request was approved", "Safety check decision", "An event was confirmed"]],
      [coordinator, ["You are responsible for an event", "A venue booking was approved", "Safety check decision"]],
      [lead, ["A new event request needs a coordinator"]],
    ];
    for (const [page, titles] of screens) {
      await page.goto("/notifications");
      for (const title of titles) {
        await expect(page.getByRole("listitem").filter({ hasText: name }).filter({ hasText: title }).first(), title).toBeVisible();
      }
    }
  });
});
