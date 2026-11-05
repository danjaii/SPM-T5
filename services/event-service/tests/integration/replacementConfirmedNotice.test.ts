import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-185/AC3 against Postgres (migration 83, docs/specs/replacement-confirmed-notice.md): when the last open arrangement of an
 * event that a venue block returned to Planning is approved, the organiser and the attendees with an active registration are
 * told, once. The block's return to Planning is arranged here as its status history row (Confirmed to Planning, made by Venue
 * Staff), which is what migration 82 writes. Fixtures are made with the secret key, named "IT-185-", dated 2032 and removed
 * afterwards. Approvals are made as the signed-in staff, as the services do.
 */
const EMAILS = {
  safetyOfficer: "farah.ismail@connectsphere.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  technician: "aaron.koh@connectsphere.example.com",
  confirmed: "alicia.fernandez@example.com",
  pending: "bryan.ho@example.com",
  withdrawn: "chen.wei.jie@example.com",
  cancelled: "deepa.krishnan@example.com",
};

const START = "2032-06-15T01:00:00+00:00";
const END = "2032-06-15T09:00:00+00:00";
const DETAILS = { name: "IT", email: "it@example.com", phone: "+65 9123 4567" };
const TYPE = "arrangements_reconfirmed";

describe.skipIf(!hasDb)("SCRUM-185/AC3 the organiser and attendees are told when replacement arrangements are confirmed (migration 83)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  const venueIds: string[] = [];
  let equipmentId: string;

  beforeAll(async () => {
    for (const [key, email] of Object.entries(EMAILS)) who[key as keyof typeof EMAILS] = await signInAs(email);
    const equipment = await admin.from("equipment").insert({ name: "IT-185 PA System", total_quantity: 1000 }).select("id").single();
    if (equipment.error) throw new Error(equipment.error.message);
    equipmentId = equipment.data.id as string;
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds); // bookings, requests, history, registrations, notifications go too
    if (venueIds.length > 0) await admin.from("venues").delete().in("id", venueIds);
    if (equipmentId) await admin.from("equipment").delete().eq("id", equipmentId);
  });

  const must = <T>(result: { data: T; error: { message: string } | null }): T => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };

  async function eventIn(status: string) {
    const event = must(
      await admin
        .from("events")
        .insert({
          name: `IT-185-${Math.random().toString(36).slice(2, 8)}`,
          organiser_id: who.organiser.userId,
          assigned_coordinator_id: who.coordinator.userId,
          status,
          is_draft: false,
          expected_attendance: 120,
          preferred_start_datetime: START,
          preferred_end_datetime: END,
        })
        .select("id")
        .single(),
    );
    eventIds.push(event.id as string);
    return event.id as string;
  }

  /** A venue booking on its own venue (so no fixture's booking overlaps another's); returns the booking id and the venue's name. */
  async function booking(eventId: string, status: string) {
    const name = `IT-185 Riverside Hall ${Math.random().toString(36).slice(2, 6)}`;
    const venue = must(await admin.from("venues").insert({ name, address: "1 Test Road", max_capacity: 150 }).select("id").single());
    venueIds.push(venue.id as string);
    const row = must(
      await admin
        .from("venue_bookings")
        .insert({ event_id: eventId, venue_id: venue.id, status, event_start_datetime: START, event_end_datetime: END, snapshot_expected_attendance: 120 })
        .select("id")
        .single(),
    );
    return { id: row.id as string, venueName: name };
  }

  async function equipmentRequest(eventId: string, bookingId: string, status: string) {
    const row = must(
      await admin
        .from("equipment_reservations")
        .insert({ event_id: eventId, equipment_id: equipmentId, venue_booking_id: bookingId, quantity_requested: 2, status, start_datetime: START, end_datetime: END })
        .select("id")
        .single(),
    );
    return row.id as string;
  }

  /** What migration 82 leaves when a block returns a Confirmed event to Planning: the history row, made by Venue Staff. */
  const blockReturnedIt = async (eventId: string, changedAt = new Date(Date.now() - 3_600_000)) =>
    must(
      await admin.from("event_status_history").insert({
        event_id: eventId,
        old_status: "confirmed",
        new_status: "planning",
        changed_by: who.venueStaff.userId,
        reason: "The venue is unavailable, so the event was returned to Planning.",
        changed_at: changedAt.toISOString(),
      }),
    );

  const returnedBy = async (eventId: string, actor: Actor, from: string, changedAt = new Date(Date.now() - 3_600_000)) =>
    must(
      await admin.from("event_status_history").insert({
        event_id: eventId,
        old_status: from,
        new_status: "planning",
        changed_by: actor.userId,
        changed_at: changedAt.toISOString(),
      }),
    );

  const register = async (eventId: string, key: "confirmed" | "pending" | "withdrawn" | "cancelled") => {
    const status = { confirmed: "registered", pending: "waitlisted", withdrawn: "withdrawn", cancelled: "cancelled" }[key];
    must(await admin.from("event_registrations").insert({ event_id: eventId, attendee_id: who[key].userId, status, registration_details: DETAILS }));
  };

  /** As venue-service does (decisionService.approve), signed in as Venue Staff. */
  const approveBooking = async (bookingId: string) =>
    must(
      await who.venueStaff.client
        .from("venue_bookings")
        .update({ status: "approved", reviewed_by: who.venueStaff.userId, reviewed_at: new Date().toISOString() })
        .eq("id", bookingId)
        .eq("status", "requested")
        .select("id")
        .single(),
    );

  /** As equipment-service does, signed in as Technical Support Staff. */
  const arrangeEquipment = async (requestId: string) => {
    const [result] = must(await who.technician.client.rpc("review_equipment_request", { p_request_id: requestId, p_status: "approved", p_reason: null })) as { outcome: string }[];
    expect(result.outcome).toBe("updated");
  };

  const statusOf = async (eventId: string) => must(await admin.from("events").select("status").eq("id", eventId).single()).status;
  const noticesOf = async (eventId: string) => must(await admin.from("notifications").select("user_id, type, title, message, is_read").eq("event_id", eventId).eq("type", TYPE));
  const recipients = async (eventId: string) => (await noticesOf(eventId)).map((n) => n.user_id as string).sort();

  describe("185-S3 the last arrangement is approved after a block", () => {
    it("SCRUM-185/AC3 185-S3: the organiser and the active attendees get one notice each; the others, the coordinator and the approver get none", async () => {
      const eventId = await eventIn("planning");
      await blockReturnedIt(eventId);
      const replacement = await booking(eventId, "requested");
      for (const key of ["confirmed", "pending", "withdrawn", "cancelled"] as const) await register(eventId, key);

      await approveBooking(replacement.id);

      expect(await statusOf(eventId)).toBe("awaiting_arrangements");
      expect(await recipients(eventId)).toEqual([who.organiser.userId, who.confirmed.userId, who.pending.userId].sort());
      const [notice] = await noticesOf(eventId);
      expect(notice).toMatchObject({ type: TYPE, title: "Arrangements confirmed", is_read: false });
      expect(notice.message).toContain("replacement arrangements are confirmed");
      expect(notice.message).toContain(`Venue: ${replacement.venueName}`);
      expect(notice.message).toContain("confirmed once its safety check is done");
      for (const key of ["withdrawn", "cancelled", "coordinator", "venueStaff"] as const) {
        expect(await recipients(eventId)).not.toContain(who[key].userId);
      }
    });

    it("SCRUM-185/AC3 185-S3: each attendee can read their own notice", async () => {
      const eventId = await eventIn("planning");
      await blockReturnedIt(eventId);
      await register(eventId, "confirmed");

      await approveBooking((await booking(eventId, "requested")).id);

      const { data } = await who.confirmed.client.from("notifications").select("id, type").eq("event_id", eventId).eq("type", TYPE);
      expect(data).toHaveLength(1);
    });

    it("SCRUM-185/AC3 185-S3: the notice names every venue the event now holds", async () => {
      const eventId = await eventIn("planning");
      await blockReturnedIt(eventId);
      const kept = await booking(eventId, "approved");
      const replacement = await booking(eventId, "requested");

      await approveBooking(replacement.id);

      const [notice] = await noticesOf(eventId);
      expect(notice.message).toContain(kept.venueName);
      expect(notice.message).toContain(replacement.venueName);
    });
  });

  describe("185-S3b not the last arrangement", () => {
    it("SCRUM-185/AC3 185-S3b: nobody is told while equipment is still unarranged; the notices go out when it is arranged", async () => {
      const eventId = await eventIn("planning");
      await blockReturnedIt(eventId);
      await register(eventId, "confirmed");
      const replacement = await booking(eventId, "requested");
      const open = await equipmentRequest(eventId, (await booking(eventId, "approved")).id, "requested");

      await approveBooking(replacement.id);
      expect(await statusOf(eventId)).toBe("planning");
      expect(await noticesOf(eventId)).toEqual([]);

      await arrangeEquipment(open);
      expect(await statusOf(eventId)).toBe("awaiting_arrangements");
      expect(await recipients(eventId)).toEqual([who.organiser.userId, who.confirmed.userId].sort());
    });
  });

  describe("185-S3c not after a block", () => {
    it("SCRUM-185/AC3 185-S3c: an event a Safety Officer returned to Planning moves on as before, with no notice", async () => {
      const eventId = await eventIn("planning");
      await returnedBy(eventId, who.safetyOfficer, "awaiting_arrangements");
      await register(eventId, "confirmed");

      await approveBooking((await booking(eventId, "requested")).id);

      expect(await statusOf(eventId)).toBe("awaiting_arrangements");
      expect(await noticesOf(eventId)).toEqual([]);
    });

    it("SCRUM-185/AC3 185-S3c: an event its own coordinator moved from Confirmed to Planning gets no notice either", async () => {
      const eventId = await eventIn("planning");
      await returnedBy(eventId, who.coordinator, "confirmed");

      await approveBooking((await booking(eventId, "requested")).id);

      expect(await statusOf(eventId)).toBe("awaiting_arrangements");
      expect(await noticesOf(eventId)).toEqual([]);
    });

    it("SCRUM-185/AC3 185-S3c: an event with no history of being returned gets no notice", async () => {
      const eventId = await eventIn("planning");

      await approveBooking((await booking(eventId, "requested")).id);

      expect(await statusOf(eventId)).toBe("awaiting_arrangements");
      expect(await noticesOf(eventId)).toEqual([]);
    });
  });

  describe("185-S3d once per return", () => {
    it("SCRUM-185/AC3 185-S3d: arranged again after a Safety Officer's rejection, no second notice", async () => {
      const eventId = await eventIn("planning");
      await blockReturnedIt(eventId, new Date(Date.now() - 7_200_000));
      await register(eventId, "confirmed");
      await approveBooking((await booking(eventId, "requested")).id);
      expect(await recipients(eventId)).toEqual([who.organiser.userId, who.confirmed.userId].sort());

      // the Safety Officer rejects: the event is back in Planning, and a new arrangement is approved
      must(await admin.from("events").update({ status: "planning" }).eq("id", eventId));
      await returnedBy(eventId, who.safetyOfficer, "awaiting_arrangements", new Date());
      await approveBooking((await booking(eventId, "requested")).id);

      expect(await statusOf(eventId)).toBe("awaiting_arrangements");
      expect(await recipients(eventId)).toEqual([who.organiser.userId, who.confirmed.userId].sort());
    });

    it("SCRUM-185/AC3 185-S3d: a second block after the first arrangement sends a second notice", async () => {
      const eventId = await eventIn("planning");
      await blockReturnedIt(eventId, new Date(Date.now() - 7_200_000));
      await approveBooking((await booking(eventId, "requested")).id);
      expect(await noticesOf(eventId)).toHaveLength(1);

      must(await admin.from("events").update({ status: "planning" }).eq("id", eventId));
      await blockReturnedIt(eventId, new Date());
      await approveBooking((await booking(eventId, "requested")).id);

      expect(await noticesOf(eventId)).toHaveLength(2);
    });
  });
});
