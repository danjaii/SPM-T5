import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { adminClient, DB_ENV, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-153 (docs/specs/equipment-reservations-rls.md): equipment reservations and technical support requests follow the
 * event's access (migration 54). Every check signs in as a seeded user, so it goes through the same JWT + publishable-key
 * path the services use. Fixtures are created with the secret key (which bypasses RLS), are prefixed "IT-153" and are removed
 * afterwards. Assertions only cover rows these tests create, never a count of a whole table (CLAUDE.md, SCRUM-143).
 */
const EMAILS = {
  coordinatorA: "rachel.tan@connectsphere.example.com", // assigned to event A
  coordinatorB: "marcus.lim@connectsphere.example.com", // assigned to event B
  organiserA: "jason.chua@techconnect.example.com", // organises event A
  organiserB: "weiling.ong@techconnect.example.com", // organises event B
  technicalSupport: "aaron.koh@connectsphere.example.com",
  lead: "helen.ong@connectsphere.example.com",
  safetyOfficer: "farah.ismail@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
};
type Who = keyof typeof EMAILS;

/** Postgres "insufficient_privilege": a missing grant, or an RLS WITH CHECK failure. */
const DENIED = "42501";

// A far-future day, so the holds cannot overlap anyone else's.
const START = new Date(Date.UTC(2034, 2, 1, 1, 0, 0)).toISOString();
const END = new Date(Date.UTC(2034, 2, 1, 9, 0, 0)).toISOString();

describe.skipIf(!hasDb)("SCRUM-153 equipment reservations and technical support requests follow the event's access (migration 54)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<Who, Actor>;
  const everyone = Object.keys(EMAILS) as Who[];

  const eventIds: string[] = [];
  let eventA: string;
  let eventB: string;
  let item: string;
  let reservationA: string; // approved, 2 units, event A
  let reservationB: string; // approved, 3 units, event B, same item and period
  let supportA: string;
  let supportB: string;

  async function newEvent(name: string, organiser: Actor, coordinator: Actor): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name,
        organiser_id: organiser.userId,
        assigned_coordinator_id: coordinator.userId,
        status: "planning",
        is_draft: false,
        expected_attendance: 30,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  async function newReservation(eventId: string, quantity: number): Promise<string> {
    const { data, error } = await admin
      .from("equipment_reservations")
      .insert({ event_id: eventId, equipment_id: item, quantity_requested: quantity, quantity_reserved: quantity, status: "approved", start_datetime: START, end_datetime: END, notes: "IT-153" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  async function newSupport(eventId: string): Promise<string> {
    const { data, error } = await admin.from("technical_support_requests").insert({ event_id: eventId, description: "IT-153 mic check" }).select("id").single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  /** The ids, among `ids`, that this actor can read from `table`. */
  const readable = async (actor: Actor, table: string, ids: string[]) => {
    const { data, error } = await actor.client.from(table).select("id").in("id", ids);
    expect(error).toBeNull();
    return ((data ?? []) as { id: string }[]).map((r) => r.id).sort();
  };

  beforeAll(async () => {
    for (const key of everyone) who[key] = await signInAs(EMAILS[key]);

    eventA = await newEvent("IT-153 event A", who.organiserA, who.coordinatorA);
    eventB = await newEvent("IT-153 event B", who.organiserB, who.coordinatorB);
    const eq = await admin.from("equipment").insert({ name: `IT-153 item ${Math.random().toString(36).slice(2, 8)}`, type: "Audio", total_quantity: 5 }).select("id").single();
    if (eq.error) throw new Error(eq.error.message);
    item = eq.data.id as string;
    reservationA = await newReservation(eventA, 2);
    reservationB = await newReservation(eventB, 3);
    supportA = await newSupport(eventA);
    supportB = await newSupport(eventB);
  });

  afterAll(async () => {
    if (!hasDb) return;
    await admin.from("technical_support_requests").delete().in("event_id", eventIds);
    await admin.from("equipment_reservations").delete().in("event_id", eventIds);
    await admin.from("events").delete().in("id", eventIds);
    await admin.from("equipment").delete().eq("id", item);
  });

  describe("SCRUM-153/AC1 who reads equipment reservations", () => {
    it("153-S1: Technical Support Staff read both events' reservations; the coordinator and organiser read only their own event's", async () => {
      const both = [reservationA, reservationB].sort();
      expect(await readable(who.technicalSupport, "equipment_reservations", both)).toEqual(both);
      expect(await readable(who.coordinatorA, "equipment_reservations", both)).toEqual([reservationA]);
      expect(await readable(who.organiserA, "equipment_reservations", both)).toEqual([reservationA]);
      expect(await readable(who.coordinatorB, "equipment_reservations", both)).toEqual([reservationB]);
      expect(await readable(who.organiserB, "equipment_reservations", both)).toEqual([reservationB]);
    });

    it("153-S2: every other role, and someone not signed in, reads none of them", async () => {
      for (const key of ["lead", "safetyOfficer", "venueStaff", "attendee"] as const) {
        expect(await readable(who[key], "equipment_reservations", [reservationA, reservationB]), key).toEqual([]);
      }
      const anon = createClient(DB_ENV.url!, DB_ENV.publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await anon.from("equipment_reservations").select("id").in("id", [reservationA, reservationB]);
      expect(data ?? []).toEqual([]);
    });
  });

  describe("SCRUM-153/AC2 nobody deletes a reservation", () => {
    it("153-S3: every role is refused deleting a reservation and the row remains", async () => {
      for (const key of everyone) {
        const { error } = await who[key].client.from("equipment_reservations").delete().eq("id", reservationA);
        expect(error?.code, key).toBe(DENIED);
      }
      const { data } = await admin.from("equipment_reservations").select("id").eq("id", reservationA);
      expect(data).toHaveLength(1);
    });
  });

  describe("SCRUM-153/AC4 writes keep working for the people who make them", () => {
    const base = (eventId: string, by: Actor) => ({
      event_id: eventId,
      equipment_id: item,
      quantity_requested: 1,
      status: "requested",
      requested_by: by.userId,
      start_datetime: START,
      end_datetime: END,
      notes: "IT-153 insert",
    });

    it("153-S4: the assigned coordinator adds a request; no other role can insert one", async () => {
      for (const key of ["coordinatorB", "organiserA", "technicalSupport", "lead", "attendee"] as const) {
        const { error } = await who[key].client.from("equipment_reservations").insert(base(eventA, who[key]));
        expect(error?.code, key).toBe(DENIED);
      }
      // the coordinator of event B cannot add to event A, nor can A's coordinator add to B
      expect((await who.coordinatorA.client.from("equipment_reservations").insert(base(eventB, who.coordinatorA))).error?.code).toBe(DENIED);
      expect((await admin.from("equipment_reservations").select("id").eq("notes", "IT-153 insert")).data).toEqual([]);

      const { error } = await who.coordinatorA.client.from("equipment_reservations").insert(base(eventA, who.coordinatorA));
      expect(error).toBeNull();
      const { data } = await admin.from("equipment_reservations").select("id, event_id, status").eq("notes", "IT-153 insert");
      expect(data).toEqual([{ id: expect.any(String), event_id: eventA, status: "requested" }]);
    });

    it("153-S5: Technical Support Staff update a request's status; no other role changes one directly", async () => {
      const row = (await admin.from("equipment_reservations").insert({ event_id: eventA, equipment_id: item, quantity_requested: 1, status: "requested", start_datetime: START, end_datetime: END, notes: "IT-153 review" }).select("id").single()).data!;
      const statusOf = async () => (await admin.from("equipment_reservations").select("status").eq("id", row.id).single()).data!.status;

      for (const key of ["coordinatorA", "organiserA", "coordinatorB", "lead", "venueStaff", "attendee"] as const) {
        await who[key].client.from("equipment_reservations").update({ status: "rejected" }).eq("id", row.id);
        expect(await statusOf(), key).toBe("requested");
      }
      const { error } = await who.technicalSupport.client.from("equipment_reservations").update({ status: "under_review" }).eq("id", row.id);
      expect(error).toBeNull();
      expect(await statusOf()).toBe("under_review");
    });

    it("153-S6: a coordinator's free-unit count still includes another event's hold, which they cannot read", async () => {
      const { data, error } = await who.coordinatorA.client.rpc("equipment_free_units", { p_equipment_id: item, p_start: START, p_end: END });
      expect(error).toBeNull();
      // 5 units, 2 held by event A and 3 by event B (both approved, same period)
      expect(data).toBe(0);
      expect(await readable(who.coordinatorA, "equipment_reservations", [reservationB])).toEqual([]);
    });
  });

  describe("SCRUM-153/AC3 technical support requests", () => {
    it("153-S8: Technical Support Staff and the event's coordinator read its requests; every other role reads none", async () => {
      const both = [supportA, supportB].sort();
      expect(await readable(who.technicalSupport, "technical_support_requests", both)).toEqual(both);
      expect(await readable(who.coordinatorA, "technical_support_requests", both)).toEqual([supportA]);
      expect(await readable(who.coordinatorB, "technical_support_requests", both)).toEqual([supportB]);
      for (const key of ["organiserA", "organiserB", "lead", "safetyOfficer", "venueStaff", "attendee"] as const) {
        expect(await readable(who[key], "technical_support_requests", both), key).toEqual([]);
      }
    });

    it("153-S9: the coordinator adds a request for their event; only Technical Support Staff update one; nobody deletes one", async () => {
      const mine = (eventId: string, by: Actor, over: Record<string, unknown> = {}) => ({
        event_id: eventId,
        description: "IT-153 insert",
        requested_by: by.userId,
        status: "requested",
        ...over,
      });
      const refused = [
        await who.coordinatorB.client.from("technical_support_requests").insert(mine(eventA, who.coordinatorB)),
        await who.coordinatorA.client.from("technical_support_requests").insert(mine(eventB, who.coordinatorA)),
        await who.coordinatorA.client.from("technical_support_requests").insert(mine(eventA, who.coordinatorA, { status: "confirmed" })),
        await who.coordinatorA.client.from("technical_support_requests").insert(mine(eventA, who.coordinatorB)),
        await who.organiserA.client.from("technical_support_requests").insert(mine(eventA, who.organiserA)),
        await who.technicalSupport.client.from("technical_support_requests").insert(mine(eventA, who.technicalSupport)),
        await who.attendee.client.from("technical_support_requests").insert(mine(eventA, who.attendee)),
      ];
      for (const r of refused) expect(r.error?.code).toBe(DENIED);
      expect((await admin.from("technical_support_requests").select("id").eq("description", "IT-153 insert")).data).toEqual([]);

      expect((await who.coordinatorA.client.from("technical_support_requests").insert(mine(eventA, who.coordinatorA))).error).toBeNull();
      expect((await admin.from("technical_support_requests").select("event_id").eq("description", "IT-153 insert")).data).toEqual([{ event_id: eventA }]);

      const statusOf = async () => (await admin.from("technical_support_requests").select("status").eq("id", supportA).single()).data!.status;
      for (const key of ["coordinatorA", "organiserA", "lead", "attendee"] as const) {
        await who[key].client.from("technical_support_requests").update({ status: "cancelled" }).eq("id", supportA);
        expect(await statusOf(), key).toBe("requested");
      }
      expect((await who.technicalSupport.client.from("technical_support_requests").update({ status: "in_review" }).eq("id", supportA)).error).toBeNull();
      expect(await statusOf()).toBe("in_review");

      for (const key of everyone) {
        const { error } = await who[key].client.from("technical_support_requests").delete().eq("id", supportB);
        expect(error?.code, key).toBe(DENIED);
      }
      expect((await admin.from("technical_support_requests").select("id").eq("id", supportB)).data).toHaveLength(1);
    });
  });
});
