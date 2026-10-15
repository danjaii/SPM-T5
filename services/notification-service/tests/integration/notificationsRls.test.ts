import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseAccessReader } from "../../src/readers/accessReader";
import { SupabaseNotificationRepository } from "../../src/repositories/supabaseNotificationRepository";
import { listNotifications, markNotificationRead } from "../../src/services/notificationService";
import { adminClient, DB_ENV, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * Own-rows RLS on notifications (migration 34). Every check signs in as a seeded user, so it goes through the same
 * JWT + publishable-key path the service uses. Fixtures are made with the service-role key and prefixed "IT-".
 */
const EMAILS = {
  coordinator: "rachel.tan@connectsphere.example.com",
  otherCoordinator: "marcus.lim@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
};

type Actor = { client: SupabaseClient; userId: string };

/** Postgres "insufficient_privilege": an RLS WITH CHECK failure or a missing grant. */
const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-46 notifications row level security (migration 34)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  let coordinatorNote: string;
  let organiserNote: string;

  const rowOf = async (id: string) => (await admin.from("notifications").select("*").eq("id", id).single()).data!;

  beforeAll(async () => {
    if (!DB_ENV.publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY must be set for the RLS tests (see README).");
    for (const [key, email] of Object.entries(EMAILS)) who[key as keyof typeof EMAILS] = await signInAs(email);
    coordinatorNote = await fixtures.notification(who.coordinator.userId);
    organiserNote = await fixtures.notification(who.organiser.userId);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("SCRUM-46/AC6 only my own notifications (46-S6)", () => {
    it("46-S6: a coordinator sees their row and not the organiser's", async () => {
      const { data, error } = await who.coordinator.client.from("notifications").select("id");
      expect(error).toBeNull();
      const ids = (data ?? []).map((r) => r.id);
      expect(ids).toContain(coordinatorNote);
      expect(ids).not.toContain(organiserNote);
    });

    it("46-S6: asking for the organiser's row by id returns nothing", async () => {
      const { data } = await who.coordinator.client.from("notifications").select("id").eq("id", organiserNote);
      expect(data).toEqual([]);
    });

    it("46-S6: a coordinator cannot mark the organiser's notification read", async () => {
      await who.coordinator.client.from("notifications").update({ is_read: true }).eq("id", organiserNote);
      expect((await rowOf(organiserNote)).is_read).toBe(false);
    });

    it("46-S6: every role is limited the same way (venue staff cannot see the organiser's row)", async () => {
      const { data } = await who.venueStaff.client.from("notifications").select("id").eq("id", organiserNote);
      expect(data).toEqual([]);
    });

    it("46-S6: insert and delete are denied by the grants", async () => {
      const insert = await who.coordinator.client
        .from("notifications")
        .insert({ user_id: who.coordinator.userId, type: "x", title: "forged", message: "forged" });
      expect(insert.error?.code).toBe(DENIED);
      const del = await who.coordinator.client.from("notifications").delete().eq("id", coordinatorNote);
      expect(del.error?.code).toBe(DENIED);
      expect(await rowOf(coordinatorNote)).toBeTruthy();
    });

    it("46-S6: the title, message and owner of my own row cannot be rewritten", async () => {
      for (const change of [{ title: "changed" }, { message: "changed" }, { user_id: who.organiser.userId }]) {
        const res = await who.coordinator.client.from("notifications").update(change).eq("id", coordinatorNote);
        expect(res.error?.code).toBe(DENIED);
      }
      expect((await rowOf(coordinatorNote)).title).toBe("IT-title");
    });
  });

  describe("SCRUM-46/AC4 mark as read (46-S4)", () => {
    it("46-S4: marking my row read sets read_at (trigger); a second time changes nothing", async () => {
      const first = await who.coordinator.client.from("notifications").update({ is_read: true }).eq("id", coordinatorNote);
      expect(first.error).toBeNull();
      const row = await rowOf(coordinatorNote);
      expect(row.is_read).toBe(true);
      expect(row.read_at).not.toBeNull();

      await who.coordinator.client.from("notifications").update({ is_read: true }).eq("id", coordinatorNote);
      expect((await rowOf(coordinatorNote)).read_at).toBe(row.read_at);
    });

    it("46-S4: a read notification cannot be marked unread", async () => {
      const res = await who.coordinator.client.from("notifications").update({ is_read: false }).eq("id", coordinatorNote);
      expect(res.error?.code).toBe(DENIED);
      expect((await rowOf(coordinatorNote)).is_read).toBe(true);
    });

    it("46-S4: the service marks my row read and 404s for someone else's", async () => {
      const mine = await fixtures.notification(who.coordinator.userId);
      const deps = {
        repo: new SupabaseNotificationRepository(who.coordinator.client),
        access: new SupabaseAccessReader(who.coordinator.client),
      };
      const item = await markNotificationRead(deps, who.coordinator.userId, mine);
      expect(item.isRead).toBe(true);
      expect(item.readAt).not.toBeNull();
      await expect(markNotificationRead(deps, who.coordinator.userId, organiserNote)).rejects.toMatchObject({
        httpStatus: 404,
      });
    });
  });

  describe("SCRUM-46/AC5 + AC7 links follow what I can still see (46-S5, 46-S7)", () => {
    it("46-S5: the assigned coordinator's venue booking link resolves; 46-S7: a reassigned coordinator's does not", async () => {
      // The booking belongs to an event now assigned to Marcus. Rachel (the previous coordinator) still has the row.
      const eventId = await fixtures.event(who.organiser.userId, who.otherCoordinator.userId);
      const bookingId = await fixtures.booking(eventId, who.otherCoordinator.userId);
      const rachelNote = await fixtures.notification(who.coordinator.userId, { venue_booking_id: bookingId, event_id: eventId });
      const marcusNote = await fixtures.notification(who.otherCoordinator.userId, { venue_booking_id: bookingId, event_id: eventId });

      const asMarcus = await listNotifications(
        {
          repo: new SupabaseNotificationRepository(who.otherCoordinator.client),
          access: new SupabaseAccessReader(who.otherCoordinator.client),
        },
        who.otherCoordinator.userId,
        100,
      );
      expect(asMarcus.items.find((i) => i.id === marcusNote)?.related?.href).toBe(`/venue-bookings/${bookingId}`);

      const asRachel = await listNotifications(
        {
          repo: new SupabaseNotificationRepository(who.coordinator.client),
          access: new SupabaseAccessReader(who.coordinator.client),
        },
        who.coordinator.userId,
        100,
      );
      const item = asRachel.items.find((i) => i.id === rachelNote);
      expect(item?.related).toEqual({
        kind: "venue_booking",
        id: bookingId,
        label: "You no longer have access to this item",
        href: null,
      });
    });

    it("46-S7: an event the coordinator cannot see (another coordinator's draft) has no link", async () => {
      const draft = await fixtures.event(who.organiser.userId, who.otherCoordinator.userId, "draft");
      const note = await fixtures.notification(who.coordinator.userId, { event_id: draft });
      const out = await listNotifications(
        {
          repo: new SupabaseNotificationRepository(who.coordinator.client),
          access: new SupabaseAccessReader(who.coordinator.client),
        },
        who.coordinator.userId,
        100,
      );
      expect(out.items.find((i) => i.id === note)?.related?.href).toBeNull();
    });

    it("46-S5: the organiser's event link resolves to the event page", async () => {
      const eventId = await fixtures.event(who.organiser.userId, who.coordinator.userId);
      const note = await fixtures.notification(who.organiser.userId, { event_id: eventId });
      const out = await listNotifications(
        {
          repo: new SupabaseNotificationRepository(who.organiser.client),
          access: new SupabaseAccessReader(who.organiser.client),
        },
        who.organiser.userId,
        100,
      );
      expect(out.items.find((i) => i.id === note)?.related?.href).toBe(`/events/${eventId}`);
    });

    it("DB: deleting the booking removes the notification that points at it (cascade)", async () => {
      const eventId = await fixtures.event(who.organiser.userId, who.coordinator.userId);
      const bookingId = await fixtures.booking(eventId, who.coordinator.userId);
      const note = await fixtures.notification(who.coordinator.userId, { venue_booking_id: bookingId });
      await admin.from("venue_bookings").delete().eq("id", bookingId);
      const { data } = await admin.from("notifications").select("id").eq("id", note);
      expect(data).toEqual([]);
    });
  });
});
