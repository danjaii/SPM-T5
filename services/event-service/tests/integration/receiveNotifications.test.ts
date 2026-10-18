import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, SEED_PASSWORD, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-47: notifications are written by the database in the same transaction as the change they announce (ADR 0002,
 * migration 44). Each test makes the change as a real signed-in user and reads the recipient's notifications as them,
 * so row level security applies. Fixtures are made with the secret key, named "IT-47-", dated 2031 and removed afterwards.
 */

const EMAILS = {
  organiser: "jason.chua@techconnect.example.com",
  safetyOfficer: "farah.ismail@connectsphere.example.com",
};

/** Accounts made for this suite: a Lead who supervises two coordinators. */
const MADE = ["lead", "coordA", "coordB"] as const;

describe.skipIf(!hasDb)("SCRUM-47 Receive relevant notifications (migration 44)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS | (typeof MADE)[number], Actor>;
  const eventIds: string[] = [];
  const venueIds: string[] = [];
  const madeUsers: string[] = [];

  async function newEvent(fields: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-47-${randomUUID().slice(0, 8)}`,
        organiser_id: who.organiser.userId,
        status: "submitted",
        is_draft: false,
        preferred_start_datetime: "2031-08-01T02:00:00Z",
        preferred_end_datetime: "2031-08-01T06:00:00Z",
        expected_attendance: 60,
        submitted_at: "2031-01-01T00:00:00Z",
        ...fields,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  async function newAccount(key: (typeof MADE)[number], role: string, lead: Actor | null) {
    const email = `it-47-${key.toLowerCase()}-${randomUUID().slice(0, 8)}@connectsphere.example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message);
    madeUsers.push(data.user.id);
    const profile = await admin.from("users").insert({
      id: data.user.id,
      role,
      full_name: `IT-47 ${key}`,
      email,
      supervising_lead_id: lead?.userId ?? null,
    });
    if (profile.error) throw new Error(profile.error.message);
    who[key] = await signInAs(email);
  }

  /** The notifications a user can read about one event, as that user (RLS applies). */
  const notificationsOf = async (actor: Actor, eventId: string) =>
    (await actor.client.from("notifications").select("type, event_id").eq("event_id", eventId)).data ?? [];

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    await newAccount("lead", "event_coordinator_lead", null);
    await newAccount("coordA", "event_coordinator", who.lead);
    await newAccount("coordB", "event_coordinator", who.lead);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds); // cascades the notifications
    if (venueIds.length > 0) await admin.from("venues").delete().in("id", venueIds);
    if (madeUsers.length > 0) await admin.from("users").update({ supervising_lead_id: null }).in("id", madeUsers);
    for (const id of madeUsers) await admin.auth.admin.deleteUser(id);
  });

  // AC1: the coordinator a Lead assigns is told they are responsible for the event
  it("SCRUM-47/AC1 a coordinator assigned to an event receives a coordinator_assigned notification for it", async () => {
    const eventId = await newEvent();

    const { error } = await who.lead.client.rpc("lead_assign_coordinator", {
      p_event_id: eventId,
      p_coordinator_id: who.coordA.userId,
    });

    expect(error).toBeNull();
    expect(await notificationsOf(who.coordA, eventId)).toEqual([{ type: "coordinator_assigned", event_id: eventId }]);
  });

  it("SCRUM-47/AC1 a coordinator reassigned to an event receives a coordinator_assigned notification for it", async () => {
    const eventId = await newEvent();
    await who.lead.client.rpc("lead_assign_coordinator", { p_event_id: eventId, p_coordinator_id: who.coordA.userId });

    const { error } = await who.lead.client.rpc("lead_reassign_coordinator", {
      p_event_id: eventId,
      p_coordinator_id: who.coordB.userId,
    });

    expect(error).toBeNull();
    expect(await notificationsOf(who.coordB, eventId)).toEqual([{ type: "coordinator_assigned", event_id: eventId }]);
  });
  // end of AC1

  // AC4: the organiser is told when the coordinator approves their event request
  it("SCRUM-47/AC4 the organiser receives an event_approved notification when their event is approved", async () => {
    const eventId = await newEvent({ status: "under_review", assigned_coordinator_id: who.coordA.userId });

    const { error } = await who.coordA.client.rpc("change_event_status", {
      p_event_id: eventId,
      p_new_status: "approved",
      p_reason: null,
    });

    expect(error).toBeNull();
    expect(await notificationsOf(who.organiser, eventId)).toEqual([{ type: "event_approved", event_id: eventId }]);
  });
  // end of AC4

  // AC5: the organiser is told when the coordinator rejects their event request
  it("SCRUM-47/AC5 the organiser receives an event_rejected notification when their event is rejected", async () => {
    const eventId = await newEvent({ status: "under_review", assigned_coordinator_id: who.coordA.userId });

    const { error } = await who.coordA.client.rpc("change_event_status", {
      p_event_id: eventId,
      p_new_status: "rejected",
      p_reason: "The venue budget is not confirmed.",
    });

    expect(error).toBeNull();
    expect(await notificationsOf(who.organiser, eventId)).toEqual([{ type: "event_rejected", event_id: eventId }]);
  });
  // end of AC5

  /**
   * Posts a comment as the actor through post_event_comment(), which saves it and its mentions together; `clarification`
   * marks it as a request for clarification from the organiser (AC2).
   */
  const postComment = (
    actor: Actor,
    eventId: string,
    body: string,
    mentions: string[] = [],
    parentCommentId: string | null = null,
    clarification = false,
  ) =>
    actor.client.rpc("post_event_comment", {
      p_event_id: eventId,
      p_body: body,
      p_parent_comment_id: parentCommentId,
      p_mentions: mentions,
      ...(clarification && { p_clarification_request: true }),
    });

  // AC2: the organiser is told when the event's coordinator asks them for clarification
  it("SCRUM-47/AC2 the organiser receives a clarification_requested notification when the coordinator asks for clarification", async () => {
    const eventId = await newEvent({ assigned_coordinator_id: who.coordA.userId });

    const { error } = await postComment(who.coordA, eventId, "What is the expected split between staff and guests?", [], null, true);

    expect(error).toBeNull();
    expect(await notificationsOf(who.organiser, eventId)).toEqual([{ type: "clarification_requested", event_id: eventId }]);
  });

  it("SCRUM-47/AC2 a coordinator who is not assigned to the event cannot ask its organiser for clarification", async () => {
    const eventId = await newEvent({ assigned_coordinator_id: who.coordA.userId });

    const { error } = await postComment(who.coordB, eventId, "Can you confirm the catering numbers?", [], null, true);

    expect(error?.code).toBe("42501");
    expect(await notificationsOf(who.organiser, eventId)).toEqual([]);
  });
  // end of AC2

  // AC3: the event's coordinator is told when the organiser answers their clarification request
  it("SCRUM-47/AC3 the coordinator receives one clarification_answered notification when the organiser answers", async () => {
    const eventId = await newEvent({ assigned_coordinator_id: who.coordA.userId });
    const { data: requestId } = await postComment(who.coordA, eventId, "How many guests use wheelchairs?", [], null, true);

    const { error } = await postComment(who.organiser, eventId, "Three, and one guide dog.", [], requestId as string);

    expect(error).toBeNull();
    expect(await notificationsOf(who.coordA, eventId)).toEqual([{ type: "clarification_answered", event_id: eventId }]);
  });

  it("SCRUM-47/AC3 another coordinator's reply to a clarification request is an ordinary reply, not an answer", async () => {
    const eventId = await newEvent({ assigned_coordinator_id: who.coordA.userId });
    const { data: requestId } = await postComment(who.coordA, eventId, "How many guests use wheelchairs?", [], null, true);

    await postComment(who.coordB, eventId, "I asked them last week; it was three.", [], requestId as string);

    expect(await notificationsOf(who.coordA, eventId)).toEqual([{ type: "comment_reply", event_id: eventId }]);
  });
  // end of AC3

  // AC6: someone mentioned in a comment is told
  it("SCRUM-47/AC6 a user mentioned in a comment receives a comment_mention notification", async () => {
    const eventId = await newEvent({ assigned_coordinator_id: who.coordA.userId });

    const { error } = await postComment(who.coordA, eventId, `@[${who.organiser.userId}] can you confirm the headcount?`, [
      who.organiser.userId,
    ]);

    expect(error).toBeNull();
    expect(await notificationsOf(who.organiser, eventId)).toEqual([{ type: "comment_mention", event_id: eventId }]);
  });

  it("SCRUM-47/AC6 the mention notification shows the mentioned person's name, not their id", async () => {
    const eventId = await newEvent({ assigned_coordinator_id: who.coordA.userId });

    await postComment(who.coordA, eventId, `@[${who.organiser.userId}] can you confirm the headcount?`, [who.organiser.userId]);

    const { data } = await who.organiser.client.from("notifications").select("message").eq("event_id", eventId).single();
    expect(data?.message).toBe("@Jason Chua can you confirm the headcount?");
  });
  // end of AC6

  // AC7: the author of a comment is told when someone replies to it
  it("SCRUM-47/AC7 the author of a comment receives a comment_reply notification when someone replies to it", async () => {
    const eventId = await newEvent({ assigned_coordinator_id: who.coordA.userId });
    const { data: parentId } = await postComment(who.organiser, eventId, "Is the hall wheelchair accessible?");

    const { error } = await postComment(who.coordA, eventId, "Yes, there is a ramp at the side entrance.", [], parentId as string);

    expect(error).toBeNull();
    expect(await notificationsOf(who.organiser, eventId)).toEqual([{ type: "comment_reply", event_id: eventId }]);
  });
  // end of AC7

  // AC8: only people the activity is relevant to are notified; the person who did it is not
  it("SCRUM-47/AC8 replying to your own comment does not notify you", async () => {
    const eventId = await newEvent({ assigned_coordinator_id: who.coordA.userId });
    const { data: parentId } = await postComment(who.organiser, eventId, "Is the hall wheelchair accessible?");

    const { error } = await postComment(who.organiser, eventId, "Also, is there a lift to level 2?", [], parentId as string);

    expect(error).toBeNull();
    expect(await notificationsOf(who.organiser, eventId)).toEqual([]);
  });

  it("SCRUM-47/AC8 mentioning yourself does not notify you", async () => {
    const eventId = await newEvent({ assigned_coordinator_id: who.coordA.userId });

    const { error } = await postComment(who.coordA, eventId, `Note to self @[${who.coordA.userId}]: chase the AV quote.`, [
      who.coordA.userId,
    ]);

    expect(error).toBeNull();
    expect(await notificationsOf(who.coordA, eventId)).toEqual([]);
  });
  // end of AC8

  // AC9: one activity gives one notification, even when it qualifies twice (a mention wins over a reply)
  it("SCRUM-47/AC9 a reply that also mentions the parent comment's author gives them one comment_mention notification", async () => {
    const eventId = await newEvent({ assigned_coordinator_id: who.coordA.userId });
    const { data: parentId } = await postComment(who.organiser, eventId, "Is the hall wheelchair accessible?");

    const { error } = await postComment(
      who.coordA,
      eventId,
      `@[${who.organiser.userId}] yes, there is a ramp at the side entrance.`,
      [who.organiser.userId],
      parentId as string,
    );

    expect(error).toBeNull();
    expect(await notificationsOf(who.organiser, eventId)).toEqual([{ type: "comment_mention", event_id: eventId }]);
  });

  it("SCRUM-47/AC9 a clarification request that also mentions the organiser gives them one clarification_requested notification", async () => {
    const eventId = await newEvent({ assigned_coordinator_id: who.coordA.userId });

    await postComment(who.coordA, eventId, `@[${who.organiser.userId}] how many guests use wheelchairs?`, [who.organiser.userId], null, true);

    expect(await notificationsOf(who.organiser, eventId)).toEqual([{ type: "clarification_requested", event_id: eventId }]);
  });
  // end of AC9

  // AC10: no notification unless something actually happened
  it("SCRUM-47/AC10 approving an event that is already approved does not notify the organiser again", async () => {
    const eventId = await newEvent({ status: "approved", assigned_coordinator_id: who.coordA.userId });

    const { error } = await who.coordA.client.rpc("change_event_status", {
      p_event_id: eventId,
      p_new_status: "approved",
      p_reason: null,
    });

    expect(error).toBeNull();
    expect(await notificationsOf(who.organiser, eventId)).toEqual([]);
  });
  // end of AC10

  // AC11: a notification says what happened and to which event
  it("SCRUM-47/AC11 a rejection notification names the event and gives the coordinator's reason", async () => {
    const eventId = await newEvent({ status: "under_review", assigned_coordinator_id: who.coordA.userId });
    const { data: event } = await admin.from("events").select("name").eq("id", eventId).single();

    await who.coordA.client.rpc("change_event_status", {
      p_event_id: eventId,
      p_new_status: "rejected",
      p_reason: "The venue budget is not confirmed.",
    });

    const { data } = await who.organiser.client.from("notifications").select("message").eq("event_id", eventId).single();
    expect(data?.message).toContain(event?.name);
    expect(data?.message).toContain("The venue budget is not confirmed.");
  });
  // end of AC11

  /** An event ready for its safety check (migration 37): awaiting arrangements, with one approved venue booking. */
  async function readyForSafetyCheck(): Promise<string> {
    const venue = await admin.from("venues").insert({ name: "IT-47 Riverside Hall", address: "1 Test Road", max_capacity: 150 }).select("id").single();
    if (venue.error) throw new Error(venue.error.message);
    venueIds.push(venue.data.id as string);
    const eventId = await newEvent({ status: "awaiting_arrangements", assigned_coordinator_id: who.coordA.userId });
    const booking = await admin.from("venue_bookings").insert({
      event_id: eventId,
      venue_id: venue.data.id,
      status: "approved",
      event_start_datetime: "2031-08-01T02:00:00Z",
      event_end_datetime: "2031-08-01T06:00:00Z",
      snapshot_expected_attendance: 60,
    });
    if (booking.error) throw new Error(booking.error.message);
    return eventId;
  }

  const decideSafety = (eventId: string, decision: string, reason: string | null = null) =>
    who.safetyOfficer.client.rpc("record_safety_decision", { p_event_id: eventId, p_decision: decision, p_reason: reason }).single();

  // AC12 (proposed, to be added to SCRUM-47 in Jira): the coordinator and organiser are told the safety decision
  it("SCRUM-47/AC12 a Safety Approved decision notifies the event's coordinator and organiser", async () => {
    const eventId = await readyForSafetyCheck();

    const { error } = await decideSafety(eventId, "approved");

    expect(error).toBeNull();
    expect(await notificationsOf(who.coordA, eventId)).toEqual([{ type: "safety_approved", event_id: eventId }]);
    expect(await notificationsOf(who.organiser, eventId)).toEqual([{ type: "safety_approved", event_id: eventId }]);
  });

  it("SCRUM-47/AC12 a Changes Requested notification gives the Safety Officer's requested changes", async () => {
    const eventId = await readyForSafetyCheck();

    await decideSafety(eventId, "changes_requested", "Add a second fire marshal at the east exit.");

    const { data } = await who.coordA.client.from("notifications").select("type, message").eq("event_id", eventId).single();
    expect(data?.type).toBe("safety_changes_requested");
    expect(data?.message).toContain("Add a second fire marshal at the east exit.");
  });
});
