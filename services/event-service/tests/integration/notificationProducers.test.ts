import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVENT_FIELD_LABELS, EVENT_IMPORTANT_FIELDS, receivesEventUpdates, registrationStatus, type RegistrationStatus } from "@spm-t5/shared";
import { adminClient, hasDb, SEED_PASSWORD, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-172: the remaining notifications are written by the database in the same transaction as the change they announce
 * (ADR 0002, migration 65). Each test makes the change as a real signed-in user and reads the recipient's notifications as
 * them, so row level security applies. Fixtures are made with the secret key, named "IT-172-", dated 2031 and removed
 * afterwards. Counts only ever look at this suite's own events and accounts (SCRUM-143).
 */

const ORGANISER = "jason.chua@techconnect.example.com";
const SAFETY_OFFICER = "farah.ismail@connectsphere.example.com";

/** Accounts made for this suite. */
const MADE = {
  lead: "event_coordinator_lead",
  inactiveLead: "event_coordinator_lead",
  coordinator: "event_coordinator",
  attendeeWaitlisted: "attendee",
  attendeeRegistered: "attendee",
  attendeeWithdrawn: "attendee",
  attendeeCancelled: "attendee",
} as const;

/** One attendee of this suite per registration_status, by the enum's own values. */
const ATTENDEE_BY_DB_STATUS = {
  waitlisted: "attendeeWaitlisted",
  registered: "attendeeRegistered",
  withdrawn: "attendeeWithdrawn",
  cancelled: "attendeeCancelled",
} as const;

const DETAILS = { name: "IT-172 Attendee", email: "it-172@example.com", phone: "+65 9123 4567" };

describe.skipIf(!hasDb)("SCRUM-172 Notify on the remaining changes (migration 65)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof MADE | "organiser" | "safetyOfficer", Actor>;
  const eventIds: string[] = [];
  const madeUsers: string[] = [];

  async function newAccount(key: keyof typeof MADE) {
    const email = `it-172-${key.toLowerCase()}-${randomUUID().slice(0, 8)}@connectsphere.example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message);
    madeUsers.push(data.user.id);
    const profile = await admin.from("users").insert({ id: data.user.id, role: MADE[key], full_name: `IT-172 ${key}`, email });
    if (profile.error) throw new Error(profile.error.message);
    who[key] = await signInAs(email);
  }

  /** Submits a request as the organiser, the way POST /events does. */
  async function submitRequest(): Promise<string> {
    const { data, error } = await who.organiser.client.rpc("create_event_request", {
      p_name: `IT-172-${randomUUID().slice(0, 8)}`,
      p_purpose: "Integration test",
      p_description: "Created by notificationProducers.test.ts",
      p_preferred_start_datetime: "2031-05-03T09:00:00Z",
      p_preferred_end_datetime: "2031-05-03T17:00:00Z",
      p_expected_attendance: 40,
      p_venue_requirements: "Projector",
      p_preferred_room_layout_id: null,
      p_accessibility_requirements: "None required",
      p_equipment_requirements_notes: "None required",
      p_registration_required: false,
    });
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  /** An event assigned to this suite's coordinator, made directly so a test can start it at any status. */
  async function newEvent(fields: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-172-${randomUUID().slice(0, 8)}`,
        organiser_id: who.organiser.userId,
        assigned_coordinator_id: who.coordinator.userId,
        status: "planning",
        is_draft: false,
        preferred_start_datetime: "2031-08-01T02:00:00Z",
        preferred_end_datetime: "2031-08-01T06:00:00Z",
        expected_attendance: 60,
        ...fields,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  /** Gives the event one registration in each status, one attendee each. */
  async function registerOneInEachStatus(eventId: string) {
    const rows = Object.entries(ATTENDEE_BY_DB_STATUS).map(([status, key]) => ({
      event_id: eventId,
      attendee_id: who[key].userId,
      status,
      registration_details: DETAILS,
    }));
    const { error } = await admin.from("event_registrations").insert(rows);
    if (error) throw new Error(error.message);
  }

  async function registrationOf(attendee: Actor, eventId: string, status: string): Promise<string> {
    const { data, error } = await admin
      .from("event_registrations")
      .insert({ event_id: eventId, attendee_id: attendee.userId, status, registration_details: DETAILS })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  /** An event that has passed its safety check, so the safety gate (migration 37) lets it become Confirmed. */
  async function safetyApprovedEvent(): Promise<string> {
    const eventId = await newEvent({ status: "awaiting_arrangements" });
    const { error } = await admin.from("safety_checks").insert({ event_id: eventId, decided_by: who.safetyOfficer.userId, decision: "approved" });
    if (error) throw new Error(error.message);
    return eventId;
  }

  /** The notifications of one type a user has about one event. Read with the secret key: a recipient's access to the event is not what is under test. */
  const notificationsOf = async (actor: Actor, eventId: string, type: string) =>
    (await admin.from("notifications").select("type, title, message").eq("user_id", actor.userId).eq("event_id", eventId).eq("type", type)).data ?? [];

  beforeAll(async () => {
    who.organiser = await signInAs(ORGANISER);
    who.safetyOfficer = await signInAs(SAFETY_OFFICER);
    for (const key of Object.keys(MADE) as Array<keyof typeof MADE>) await newAccount(key);
    await admin.from("users").update({ is_active: false }).eq("id", who.inactiveLead.userId);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds); // cascades the notifications
    for (const id of madeUsers) await admin.auth.admin.deleteUser(id);
  });

  // AC1: every active Lead hears of a new request, because Leads share the one unassigned queue
  it("SCRUM-172/AC1 an organiser submitting a request notifies an active Lead once, and not an inactive one", async () => {
    const eventId = await submitRequest();

    expect(await notificationsOf(who.lead, eventId, "event_submitted")).toHaveLength(1);
    expect(await notificationsOf(who.inactiveLead, eventId, "event_submitted")).toEqual([]);
  });

  // AC5: both people running the event hear it is confirmed. Here nobody signed in made the change, so nobody is left out.
  it("SCRUM-172/AC5 an event becoming Confirmed notifies its organiser and assigned coordinator", async () => {
    const eventId = await safetyApprovedEvent();

    const { error } = await admin.rpc("change_event_status", { p_event_id: eventId, p_new_status: "confirmed" }).maybeSingle();

    expect(error).toBeNull();
    expect(await notificationsOf(who.organiser, eventId, "event_confirmed")).toHaveLength(1);
    expect(await notificationsOf(who.coordinator, eventId, "event_confirmed")).toHaveLength(1);
  });

  // Decision: nobody is told about their own action (the rule AC3 states, applied to every criterion)
  it("SCRUM-172/AC5 the coordinator who confirms the event is not told, its organiser is", async () => {
    const eventId = await safetyApprovedEvent();

    const { error } = await who.coordinator.client.rpc("change_event_status", { p_event_id: eventId, p_new_status: "confirmed" }).maybeSingle();

    expect(error).toBeNull();
    expect(await notificationsOf(who.organiser, eventId, "event_confirmed")).toHaveLength(1);
    expect(await notificationsOf(who.coordinator, eventId, "event_confirmed")).toEqual([]);
  });

  // A coordinator may insert status history directly (migration 14's policy): a row that isn't the event's status announces nothing
  it("SCRUM-172/AC5 a history row that does not match the event's status notifies nobody", async () => {
    const eventId = await newEvent({ status: "planning" });

    const { error } = await who.coordinator.client
      .from("event_status_history")
      .insert({ event_id: eventId, old_status: "planning", new_status: "confirmed", changed_by: who.coordinator.userId });

    expect(error).toBeNull();
    expect(await notificationsOf(who.organiser, eventId, "event_confirmed")).toEqual([]);
  });

  // AC6: the reason travels with the news when one was given (W9 r19)
  it("SCRUM-172/AC6 an event becoming Cancelled notifies its organiser and assigned coordinator, with the reason", async () => {
    const eventId = await newEvent();

    const { error } = await admin
      .rpc("change_event_status", { p_event_id: eventId, p_new_status: "cancelled", p_reason: "The speaker withdrew" })
      .maybeSingle();

    expect(error).toBeNull();
    for (const person of [who.organiser, who.coordinator]) {
      const [notice] = await notificationsOf(person, eventId, "event_cancelled");
      expect(notice?.message).toContain("The speaker withdrew");
    }
  });

  // SCRUM-174/AC1: change_event_status() refuses a cancellation without a reason (migration 60), so these tests give one
  const CANCEL_REASON = "Organiser withdrew the event";

  // AC6, AC9: the database's rule must be the shared one, for all four statuses: Pending and Confirmed hear, Withdrawn and Rejected don't
  it("SCRUM-172/AC6,AC9 a cancellation reaches exactly the attendees receivesEventUpdates() allows", async () => {
    const eventId = await newEvent();
    await registerOneInEachStatus(eventId);

    const { error } = await admin.rpc("change_event_status", { p_event_id: eventId, p_new_status: "cancelled", p_reason: CANCEL_REASON }).maybeSingle();

    expect(error).toBeNull();
    for (const [dbStatus, key] of Object.entries(ATTENDEE_BY_DB_STATUS)) {
      const expected = receivesEventUpdates(registrationStatus(dbStatus) as RegistrationStatus) ? 1 : 0;
      expect(await notificationsOf(who[key], eventId, "event_cancelled"), dbStatus).toHaveLength(expected);
    }
  });

  // AC3: the other person running the event hears of an important change, and which field it was; whoever made it does not
  it("SCRUM-172/AC3 an important change notifies the organiser, naming the field, and not the coordinator who made it", async () => {
    const eventId = await newEvent();

    const { error } = await who.coordinator.client.rpc("update_event_details", {
      p_event_id: eventId,
      p_changes: { expected_attendance: { from: 60, to: 80 } },
    });

    expect(error).toBeNull();
    const [notice] = await notificationsOf(who.organiser, eventId, "event_changed");
    expect(notice?.message).toContain(EVENT_FIELD_LABELS.expected_attendance);
    expect(await notificationsOf(who.coordinator, eventId, "event_changed")).toEqual([]);
  });

  // AC3: the migration's copy of the labels must be the shared ones, so a notice names a field as the change history does
  it("SCRUM-172/AC3 the notice names every important field as EVENT_FIELD_LABELS does", async () => {
    const eventId = await newEvent({ accessibility_requirements: null, venue_requirements: null, equipment_requirements_notes: null });
    const same = (value: unknown) => ({ from: value, to: value });

    const { error } = await who.coordinator.client.rpc("update_event_details", {
      p_event_id: eventId,
      p_changes: {
        preferred_start_datetime: same("2031-08-01T02:00:00Z"),
        preferred_end_datetime: same("2031-08-01T06:00:00Z"),
        expected_attendance: same(60),
        preferred_room_layout_id: same(null),
        accessibility_requirements: same(null),
        venue_requirements: same(null),
        equipment_requirements_notes: same(null),
      },
    });

    expect(error).toBeNull();
    const [notice] = await notificationsOf(who.organiser, eventId, "event_changed");
    for (const field of EVENT_IMPORTANT_FIELDS) expect(notice?.message).toContain(EVENT_FIELD_LABELS[field]);
  });

  // AC3: only an important change; renaming an event is not one
  it("SCRUM-172/AC3 an ordinary change notifies nobody", async () => {
    const eventId = await newEvent({ description: "Before" });

    const { error } = await who.coordinator.client.rpc("update_event_details", {
      p_event_id: eventId,
      p_changes: { description: { from: "Before", to: "After" } },
    });

    expect(error).toBeNull();
    expect(await notificationsOf(who.organiser, eventId, "event_changed")).toEqual([]);
  });

  // AC3: a refused change leaves nothing behind (ADR 0002)
  it("SCRUM-172/AC3 a refused change notifies nobody", async () => {
    const eventId = await newEvent();

    const { error } = await who.coordinator.client.rpc("update_event_details", {
      p_event_id: eventId,
      p_changes: { expected_attendance: { from: 999, to: 80 } }, // not the current value, so the database refuses it as stale
    });

    expect(error?.code).toBe("CS111");
    expect(await notificationsOf(who.organiser, eventId, "event_changed")).toEqual([]);
  });

  // AC4: an organiser or a future route changes the status; the attendee hears the new status in their own words
  it("SCRUM-172/AC4 a registration's status changing notifies that attendee", async () => {
    const eventId = await newEvent();
    const registrationId = await registrationOf(who.attendeeWaitlisted, eventId, "waitlisted");

    const { error } = await admin.from("event_registrations").update({ status: "registered" }).eq("id", registrationId);

    expect(error).toBeNull();
    const [notice] = await notificationsOf(who.attendeeWaitlisted, eventId, "registration_status_changed");
    expect(notice?.message).toContain("Confirmed");
  });

  // Decision: nobody is told about their own action, and withdrawing is the attendee's own (SCRUM-73's route does this update)
  it("SCRUM-172/AC4 an attendee withdrawing their own registration is not told", async () => {
    const eventId = await newEvent();
    const registrationId = await registrationOf(who.attendeeRegistered, eventId, "registered");

    const { data, error } = await who.attendeeRegistered.client
      .from("event_registrations")
      .update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
      .eq("id", registrationId)
      .select("id");

    expect(error).toBeNull();
    expect(data).toHaveLength(1); // the update really happened
    expect(await notificationsOf(who.attendeeRegistered, eventId, "registration_status_changed")).toEqual([]);
  });

  // AC9: once withdrawn, nothing more, even if the row changes later
  it("SCRUM-172/AC9 a change to an already withdrawn registration notifies nobody", async () => {
    const eventId = await newEvent();
    const registrationId = await registrationOf(who.attendeeWithdrawn, eventId, "withdrawn");

    const { error } = await admin.from("event_registrations").update({ status: "cancelled" }).eq("id", registrationId);

    expect(error).toBeNull();
    expect(await notificationsOf(who.attendeeWithdrawn, eventId, "registration_status_changed")).toEqual([]);
  });

  // AC4: saving the same status is not a change
  it("SCRUM-172/AC4 setting a registration to the status it already has notifies nobody", async () => {
    const eventId = await newEvent();
    const registrationId = await registrationOf(who.attendeeRegistered, eventId, "registered");

    const { error } = await admin.from("event_registrations").update({ status: "registered" }).eq("id", registrationId);

    expect(error).toBeNull();
    expect(await notificationsOf(who.attendeeRegistered, eventId, "registration_status_changed")).toEqual([]);
  });

  // AC1: a request the organiser was asked to amend goes back to the same queue
  it("SCRUM-172/AC1 a returned request being submitted again notifies a Lead", async () => {
    const eventId = await newEvent({ status: "returned", assigned_coordinator_id: null });

    const { error } = await admin.rpc("change_event_status", { p_event_id: eventId, p_new_status: "submitted" }).maybeSingle();

    expect(error).toBeNull();
    expect(await notificationsOf(who.lead, eventId, "event_submitted")).toHaveLength(1);
  });

  // AC1: only the organiser submitting. A coordinator sending an event back a step is not a new request.
  it("SCRUM-172/AC1 an event moved back to submitted during review notifies no Lead", async () => {
    const eventId = await newEvent({ status: "under_review" });

    const { error } = await admin.rpc("change_event_status", { p_event_id: eventId, p_new_status: "submitted" }).maybeSingle();

    expect(error).toBeNull();
    expect(await notificationsOf(who.lead, eventId, "event_submitted")).toEqual([]);
  });

  // AC6: setting a status the event already has announces nothing
  it("SCRUM-172/AC6 cancelling an already cancelled event notifies nobody", async () => {
    const eventId = await newEvent({ status: "cancelled" });

    const { error } = await admin.rpc("change_event_status", { p_event_id: eventId, p_new_status: "cancelled", p_reason: CANCEL_REASON }).maybeSingle();

    expect(error).toBeNull();
    expect(await notificationsOf(who.organiser, eventId, "event_cancelled")).toEqual([]);
  });
});
