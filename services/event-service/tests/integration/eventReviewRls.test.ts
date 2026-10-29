import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * Review tables, storage and per-role RLS (migration 08). Every check signs in as a seeded user, so
 * it goes through the same JWT + publishable-key path event-service uses. Fixtures are created with
 * the secret key (which bypasses RLS) and are prefixed "IT-" and removed afterwards.
 * Stories: SCRUM-25 (comments), 26 (replies), 27 (mentions), 28 (attachments), 42/43 (assignment).
 */
const EMAILS = {
  coordinatorA: "rachel.tan@connectsphere.example.com",
  coordinatorB: "marcus.lim@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
  organiserA: "jason.chua@techconnect.example.com",
  organiserB: "weiling.ong@techconnect.example.com",
};

/** Postgres "insufficient_privilege": an RLS WITH CHECK failure or a missing grant. */
const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-25/26/27/28/42/43 event review row level security (migration 08)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  const storagePaths: string[] = [];
  let eventA: string; // organiser A, coordinator A
  let eventB: string; // organiser B, coordinator B

  async function newEvent(organiser: string, coordinator: string): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-event-${Math.random().toString(36).slice(2, 8)}`,
        organiser_id: organiser,
        assigned_coordinator_id: coordinator,
        status: "submitted",
        is_draft: false,
        expected_attendance: 50,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  /** A comment arranged with the secret key, so RLS never gets in the way of setting up. */
  async function arrangeComment(eventId: string, authorId: string): Promise<string> {
    const { data, error } = await admin
      .from("event_comments")
      .insert({ event_id: eventId, author_id: authorId, comment_text: "IT comment" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    eventA = await newEvent(who.organiserA.userId, who.coordinatorA.userId);
    eventB = await newEvent(who.organiserB.userId, who.coordinatorB.userId);
  });

  afterAll(async () => {
    if (storagePaths.length > 0) await admin.storage.from("event-attachments").remove(storagePaths);
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds); // cascades comments, logs
  });

  describe("event_comments", () => {
    it("SCRUM-25/AC1 a coordinator and the event's organiser can comment, as themselves", async () => {
      for (const actor of [who.coordinatorA, who.organiserA]) {
        const { error } = await actor.client
          .from("event_comments")
          .insert({ event_id: eventA, author_id: actor.userId, comment_text: "hello" });
        expect(error).toBeNull();
      }
    });

    it("SCRUM-25/AC5 an organiser of another event, venue staff and attendees cannot comment", async () => {
      for (const actor of [who.organiserB, who.venueStaff, who.attendee]) {
        const { error } = await actor.client
          .from("event_comments")
          .insert({ event_id: eventA, author_id: actor.userId, comment_text: "nope" });
        expect(error?.code).toBe(DENIED);
      }
    });

    it("SCRUM-25/AC1 nobody can comment in someone else's name", async () => {
      const { error } = await who.coordinatorA.client
        .from("event_comments")
        .insert({ event_id: eventA, author_id: who.coordinatorB.userId, comment_text: "spoof" });
      expect(error?.code).toBe(DENIED);
    });

    // SCRUM-156: "coordinators" is now the event's assigned coordinator; any other coordinator reads nothing
    it("SCRUM-25/AC3 comments are visible to the event's coordinator and organiser only", async () => {
      const id = await arrangeComment(eventA, who.coordinatorA.userId);
      const visible = async (actor: Actor) =>
        ((await actor.client.from("event_comments").select("id").eq("id", id)).data ?? []).length;
      expect(await visible(who.coordinatorA)).toBe(1);
      expect(await visible(who.coordinatorB)).toBe(0);
      expect(await visible(who.organiserA)).toBe(1);
      expect(await visible(who.organiserB)).toBe(0);
      expect(await visible(who.attendee)).toBe(0);
      expect(await visible(who.venueStaff)).toBe(0);
    });

    it("SCRUM-26/AC1 a reply must sit in the same event as its parent", async () => {
      const parent = await arrangeComment(eventA, who.coordinatorA.userId);
      const ok = await who.coordinatorA.client
        .from("event_comments")
        .insert({ event_id: eventA, author_id: who.coordinatorA.userId, parent_comment_id: parent, comment_text: "re" });
      expect(ok.error).toBeNull();
      const crossEvent = await who.coordinatorA.client
        .from("event_comments")
        .insert({ event_id: eventB, author_id: who.coordinatorA.userId, parent_comment_id: parent, comment_text: "re" });
      expect(crossEvent.error?.code).toBe(DENIED);
    });

    it("comments are append-only: no update and no delete through the API", async () => {
      const id = await arrangeComment(eventA, who.coordinatorA.userId);
      const update = await who.coordinatorA.client.from("event_comments").update({ comment_text: "edited" }).eq("id", id);
      expect(update.error?.code).toBe(DENIED);
      const del = await who.coordinatorA.client.from("event_comments").delete().eq("id", id);
      expect(del.error?.code).toBe(DENIED);
    });
  });

  describe("event_comment_mentions", () => {
    it("SCRUM-27/AC2 the author can mention a user who can see the event", async () => {
      const id = await arrangeComment(eventA, who.coordinatorA.userId);
      const { error } = await who.coordinatorA.client.from("event_comment_mentions").insert({ comment_id: id, user_id: who.organiserA.userId });
      expect(error).toBeNull();
    });

    it("SCRUM-27/AC5 a user who cannot see the event cannot be mentioned", async () => {
      const id = await arrangeComment(eventA, who.coordinatorA.userId);
      // SCRUM-156: another coordinator cannot see the event either
      for (const mentioned of [who.coordinatorB.userId, who.organiserB.userId, who.attendee.userId, who.venueStaff.userId]) {
        const { error } = await who.coordinatorA.client.from("event_comment_mentions").insert({ comment_id: id, user_id: mentioned });
        expect(error?.code).toBe(DENIED);
      }
    });

    it("only the comment's author can add mentions to it", async () => {
      const id = await arrangeComment(eventA, who.coordinatorA.userId);
      const { error } = await who.coordinatorB.client.from("event_comment_mentions").insert({ comment_id: id, user_id: who.organiserA.userId });
      expect(error?.code).toBe(DENIED);
    });

    it("SCRUM-27/AC3 mentions are readable by people who can see the event, not by others", async () => {
      const id = await arrangeComment(eventA, who.coordinatorA.userId);
      await admin.from("event_comment_mentions").insert({ comment_id: id, user_id: who.organiserA.userId });
      const count = async (actor: Actor) =>
        ((await actor.client.from("event_comment_mentions").select("id").eq("comment_id", id)).data ?? []).length;
      expect(await count(who.organiserA)).toBe(1);
      expect(await count(who.organiserB)).toBe(0);
    });
  });

  describe("event_comment_attachments and the event-attachments bucket", () => {
    it("SCRUM-28/AC1 the author attaches a file stored under the comment's own event folder", async () => {
      const id = await arrangeComment(eventA, who.coordinatorA.userId);
      const ok = await who.coordinatorA.client
        .from("event_comment_attachments")
        .insert({ comment_id: id, file_name: "plan.pdf", storage_path: `${eventA}/plan.pdf` });
      expect(ok.error).toBeNull();
      const wrongFolder = await who.coordinatorA.client
        .from("event_comment_attachments")
        .insert({ comment_id: id, file_name: "plan.pdf", storage_path: `${eventB}/plan.pdf` });
      expect(wrongFolder.error?.code).toBe(DENIED);
      const noFolder = await who.coordinatorA.client
        .from("event_comment_attachments")
        .insert({ comment_id: id, file_name: "plan.pdf", storage_path: "plan.pdf" });
      expect(noFolder.error?.code).toBe(DENIED);
    });

    it("SCRUM-28/AC3 a coordinator uploads under an event folder and the organiser gets a signed URL; others cannot", async () => {
      const path = `${eventA}/it-${Date.now()}.txt`;
      storagePaths.push(path);
      const up = await who.coordinatorA.client.storage
        .from("event-attachments")
        .upload(path, new Blob(["hello"], { type: "text/plain" }));
      expect(up.error).toBeNull();
      const signed = await who.organiserA.client.storage.from("event-attachments").createSignedUrl(path, 60);
      expect(signed.data?.signedUrl).toBeTruthy();
      const other = await who.organiserB.client.storage.from("event-attachments").createSignedUrl(path, 60);
      expect(other.data?.signedUrl).toBeUndefined();
      const attendeeUp = await who.attendee.client.storage
        .from("event-attachments")
        .upload(`${eventA}/it-attendee.txt`, new Blob(["x"], { type: "text/plain" }));
      expect(attendeeUp.error).not.toBeNull();
    });

    it("SCRUM-28/AC5 an unsupported file type is rejected", async () => {
      const { error } = await who.coordinatorA.client.storage
        .from("event-attachments")
        .upload(`${eventA}/it-virus.exe`, new Blob(["MZ"], { type: "application/x-msdownload" }));
      expect(error).not.toBeNull();
    });

    it("SCRUM-28/AC6 a file over the 10 MB limit is rejected", async () => {
      const { error } = await who.coordinatorA.client.storage
        .from("event-attachments")
        .upload(`${eventA}/it-big.txt`, new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "text/plain" }));
      expect(error).not.toBeNull();
    });
  });

  describe("coordinator_assignment_logs", () => {
    const log = (eventId: string, coordinator: string, assignedBy: string) => ({
      event_id: eventId,
      coordinator_id: coordinator,
      assigned_by: assignedBy,
    });

    it("SCRUM-42/AC6 a coordinator records an assignment in their own name", async () => {
      const { error } = await who.coordinatorA.client
        .from("coordinator_assignment_logs")
        .insert(log(eventA, who.coordinatorB.userId, who.coordinatorA.userId));
      expect(error).toBeNull();
    });

    it("SCRUM-42/AC6 the assigned_by cannot be someone else, and non-coordinators cannot assign", async () => {
      const spoof = await who.coordinatorA.client
        .from("coordinator_assignment_logs")
        .insert(log(eventA, who.coordinatorB.userId, who.coordinatorB.userId));
      expect(spoof.error?.code).toBe(DENIED);
      for (const actor of [who.organiserA, who.venueStaff, who.attendee]) {
        const { error } = await actor.client
          .from("coordinator_assignment_logs")
          .insert(log(eventA, who.coordinatorB.userId, actor.userId));
        expect(error?.code).toBe(DENIED);
      }
    });

    it("SCRUM-43/AC1,AC5 history is visible to the event's coordinator and organiser only", async () => {
      await admin.from("coordinator_assignment_logs").insert(log(eventA, who.coordinatorA.userId, who.coordinatorA.userId));
      const count = async (actor: Actor) =>
        ((await actor.client.from("coordinator_assignment_logs").select("id").eq("event_id", eventA)).data ?? []).length;
      expect(await count(who.coordinatorA)).toBeGreaterThan(0);
      expect(await count(who.coordinatorB)).toBe(0);
      expect(await count(who.organiserA)).toBeGreaterThan(0);
      expect(await count(who.organiserB)).toBe(0);
      expect(await count(who.attendee)).toBe(0);
    });

    it("SCRUM-43/AC4 history is preserved: no update and no delete through the API", async () => {
      const { data } = await admin
        .from("coordinator_assignment_logs")
        .insert(log(eventA, who.coordinatorA.userId, who.coordinatorA.userId))
        .select("id")
        .single();
      const update = await who.coordinatorA.client
        .from("coordinator_assignment_logs")
        .update({ coordinator_id: who.coordinatorB.userId })
        .eq("id", data!.id);
      expect(update.error?.code).toBe(DENIED);
      const del = await who.coordinatorA.client.from("coordinator_assignment_logs").delete().eq("id", data!.id);
      expect(del.error?.code).toBe(DENIED);
    });
  });
});
