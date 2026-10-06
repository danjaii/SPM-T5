import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-71: list_public_events() (migration 10), the data behind the attendee's List of events. Signs in
 * as a seeded attendee, so it goes through the same JWT + publishable-key path event-service uses.
 * Fixtures are created with the secret key (which bypasses RLS), prefixed "IT-", and removed afterwards.
 */
const ATTENDEE = "alicia.fernandez@example.com";
const ORGANISER = "jason.chua@techconnect.example.com";

// A far-future slot, written the way the database sends timestamps back
const START = "2031-03-03T02:00:00+00:00";
const END = "2031-03-03T04:00:00+00:00";
const REGISTRATION_OPENS = "2031-02-01T00:00:00+00:00";
const REGISTRATION_CLOSES = "2031-03-01T00:00:00+00:00";

describe.skipIf(!hasDb)("SCRUM-71 list_public_events() (migration 10)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const eventIds: string[] = [];
  const venueIds: string[] = [];
  let attendee: Actor;
  let organiserId: string;
  let attendeeIds: string[]; // seeded attendees, to register for events

  async function newVenue(name: string, address: string): Promise<string> {
    const { data, error } = await admin.from("venues").insert({ name, address, max_capacity: 100 }).select("id").single();
    if (error) throw new Error(error.message);
    venueIds.push(data.id as string);
    return data.id as string;
  }

  async function newEvent(fields: Record<string, unknown>): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-event-${Math.random().toString(36).slice(2, 8)}`,
        organiser_id: organiserId,
        is_draft: false,
        preferred_start_datetime: START,
        preferred_end_datetime: END,
        ...fields,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  async function bookVenue(eventId: string, venueId: string, status: string) {
    const { error } = await admin
      .from("venue_bookings")
      .insert({ event_id: eventId, venue_id: venueId, status, event_start_datetime: START, event_end_datetime: END });
    if (error) throw new Error(error.message);
  }

  async function register(eventId: string, attendeeId: string, status: string) {
    const { error } = await admin.from("event_registrations").insert({ event_id: eventId, attendee_id: attendeeId, status });
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    attendee = await signInAs(ATTENDEE);
    const { data, error } = await admin.from("users").select("id").eq("email", ORGANISER).single();
    if (error) throw new Error(error.message);
    organiserId = data.id as string;
    const { data: attendees, error: attendeesError } = await admin.from("users").select("id").eq("role", "attendee").limit(4);
    if (attendeesError) throw new Error(attendeesError.message);
    attendeeIds = (attendees ?? []).map((a) => a.id as string);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds); // cascades bookings, registrations
    if (venueIds.length > 0) await admin.from("venues").delete().in("id", venueIds);
  });

  // AC1 + AC3: an attendee can't read venue_bookings (RLS), so the function has to supply the venue
  it("SCRUM-71/AC1 returns a confirmed event with its approved venue's name and address to an attendee", async () => {
    const venueId = await newVenue("IT-Orchid Hall", "IT-Level 3, East Wing");
    const eventId = await newEvent({ name: "IT-Tech Summit", status: "confirmed", registration_required: true });
    await bookVenue(eventId, venueId, "approved");

    const { data, error } = await attendee.client.rpc("list_public_events");

    expect(error).toBeNull();
    expect(data).toContainEqual(
      expect.objectContaining({
        id: eventId,
        name: "IT-Tech Summit",
        start_at: START,
        end_at: END,
        venue_name: "IT-Orchid Hall",
        venue_address: "IT-Level 3, East Wing",
      }),
    );
  });

  // AC1: the list is of public events: confirmed (or cancelled, for AC7's label) and open to attendee registration
  it("SCRUM-71/AC1 leaves out events attendees shouldn't see (draft, under review, or not taking registrations)", async () => {
    const draft = await newEvent({ status: "draft", is_draft: true, registration_required: true });
    const underReview = await newEvent({ status: "under_review", registration_required: true });
    const internalOnly = await newEvent({ status: "confirmed", registration_required: false });

    const { data, error } = await attendee.client.rpc("list_public_events");

    expect(error).toBeNull();
    const ids = (data as { id: string }[]).map((row) => row.id);
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(underReview);
    expect(ids).not.toContain(internalOnly);
  });
  // end of AC1

  // AC3: the location is where the event is actually booked, so a rejected request's venue must not show
  it("SCRUM-71/AC3 uses the venue of the event's approved booking, not a rejected one", async () => {
    const rejectedVenue = await newVenue("IT-Rejected Hall", "IT-1 Nowhere Road");
    const approvedVenue = await newVenue("IT-Orchid Hall", "IT-Level 3, East Wing");
    const eventId = await newEvent({ status: "confirmed", registration_required: true });
    await bookVenue(eventId, rejectedVenue, "rejected");
    await bookVenue(eventId, approvedVenue, "approved");

    const { data, error } = await attendee.client.rpc("list_public_events");

    expect(error).toBeNull();
    const rows = (data as { id: string }[]).filter((row) => row.id === eventId);
    expect(rows).toEqual([
      expect.objectContaining({ venue_name: "IT-Orchid Hall", venue_address: "IT-Level 3, East Wing" }),
    ]);
  });

  // AC3: "confirmed" is the legacy name for an agreed booking (migration 06), and most seeded bookings use it
  it("SCRUM-71/AC3 also uses the venue of a confirmed (legacy) booking", async () => {
    const venueId = await newVenue("IT-Jade Room", "IT-2 Marina Way");
    const eventId = await newEvent({ status: "confirmed", registration_required: true });
    await bookVenue(eventId, venueId, "confirmed");

    const { data, error } = await attendee.client.rpc("list_public_events");

    expect(error).toBeNull();
    expect(data).toContainEqual(
      expect.objectContaining({ id: eventId, venue_name: "IT-Jade Room", venue_address: "IT-2 Marina Way" }),
    );
  });
  // end of AC3

  // AC7: the facts event-service needs to pick a label; "Event Full" counts only places held (Confirmed, Pending)
  it("SCRUM-71/AC7 returns the status, capacity and registration window, and counts only active registrations", async () => {
    const eventId = await newEvent({
      status: "confirmed",
      registration_required: true,
      registration_capacity: 50,
      registration_opens_at: REGISTRATION_OPENS,
      registration_closes_at: REGISTRATION_CLOSES,
    });
    const [confirmed, pending, withdrawn, rejected] = attendeeIds;
    await register(eventId, confirmed, "registered");
    await register(eventId, pending, "waitlisted");
    await register(eventId, withdrawn, "withdrawn");
    await register(eventId, rejected, "cancelled");

    const { data, error } = await attendee.client.rpc("list_public_events");

    expect(error).toBeNull();
    expect(data).toContainEqual(
      expect.objectContaining({
        id: eventId,
        status: "confirmed",
        registration_capacity: 50,
        registration_opens_at: REGISTRATION_OPENS,
        registration_closes_at: REGISTRATION_CLOSES,
        active_registrations: 2,
      }),
    );
  });

  // AC7: a cancelled event stays on the list, so its card can say "Cancelled" (rather than just vanishing)
  it("SCRUM-71/AC7 also lists a cancelled event, with its cancelled status", async () => {
    const eventId = await newEvent({ status: "cancelled", registration_required: true });

    const { data, error } = await attendee.client.rpc("list_public_events");

    expect(error).toBeNull();
    expect(data).toContainEqual(expect.objectContaining({ id: eventId, status: "cancelled" }));
  });
  // end of AC7

  // AC10: each attendee sees their own registration, never someone else's (auth.uid() inside the function)
  it("SCRUM-71/AC10 returns the caller's own registration status, and null where only others registered", async () => {
    const mine = await newEvent({ status: "confirmed", registration_required: true });
    const othersOnly = await newEvent({ status: "confirmed", registration_required: true });
    const someoneElse = attendeeIds.find((id) => id !== attendee.userId)!;
    await register(mine, attendee.userId, "waitlisted");
    await register(othersOnly, someoneElse, "registered");

    const { data, error } = await attendee.client.rpc("list_public_events");

    expect(error).toBeNull();
    expect(data).toContainEqual(expect.objectContaining({ id: mine, my_registration_status: "waitlisted" }));
    expect(data).toContainEqual(expect.objectContaining({ id: othersOnly, my_registration_status: null }));
  });
  // end of AC10
});
// end of SCRUM-71
