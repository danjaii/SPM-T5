import { ATTACHMENT_TYPES } from "@spm-t5/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createSupabaseDeps } from "../../src/supabase";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-51: supporting documents on a draft event request (migration 64: event_request_attachments, add_event_attachment(),
 * remove_event_attachment(), the storage delete policy) against the real database, as seeded users so RLS applies.
 * Fixtures are drafts named "IT-51-", removed afterwards with their attachments and stored files. Only rows these tests
 * create are asserted on.
 */
const EMAILS = {
  organiser: "jason.chua@techconnect.example.com",
  otherOrganiser: "weiling.ong@techconnect.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
};

/** Postgres "insufficient_privilege". */
const DENIED = "42501";
const BUCKET = "event-attachments";

describe.skipIf(!hasDb)("SCRUM-51 attach supporting documents against the database", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const app = hasDb ? createApp(createSupabaseDeps()) : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  const cookie = (actor: Actor) => `cs_session=${actor.token}`;

  async function newDraft(actor: Actor, name: string): Promise<Record<string, any>> {
    const { data, error } = await actor.client.rpc("create_event_draft", { p_name: name });
    if (error) throw new Error(error.message);
    eventIds.push(data.id);
    return data;
  }
  /** Moves a draft to submitted. A name-only draft fails submit_event_draft() as incomplete (DR003), so the status is set directly. */
  async function markSubmitted(eventId: string) {
    const { error } = await admin.from("events").update({ status: "submitted", is_draft: false, submitted_at: new Date().toISOString() }).eq("id", eventId);
    if (error) throw new Error(error.message);
  }
  /** Upload-URL, send the file, register it: what the form does. */
  async function attach(actor: Actor, eventId: string, name = "plan.pdf", type = "application/pdf", body = "%PDF-1.4 IT-51") {
    const urlRes = await request(app).post(`/events/drafts/${eventId}/attachments/upload-url`).set("Cookie", cookie(actor))
      .send({ file_name: name, content_type: type, size: body.length });
    if (urlRes.status !== 200) return { urlRes };
    const put = await fetch(urlRes.body.upload_url, { method: "PUT", headers: { "Content-Type": type }, body });
    const res = await request(app).post(`/events/drafts/${eventId}/attachments`).set("Cookie", cookie(actor))
      .send({ file_name: name, storage_path: urlRes.body.storage_path, content_type: type, size: body.length });
    return { urlRes, put, res };
  }

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
  });

  afterAll(async () => {
    if (eventIds.length === 0) return;
    const { data } = await admin.from("event_request_attachments").select("storage_path").in("event_id", eventIds);
    if (data?.length) await admin.storage.from(BUCKET).remove(data.map((r) => r.storage_path));
    await admin.from("event_request_attachments").delete().in("event_id", eventIds);
    await admin.from("event_status_history").delete().in("event_id", eventIds);
    await admin.from("events").delete().in("id", eventIds);
  });

  describe("SCRUM-51/AC1 upload an attachment", () => {
    it("stores the file, lists it for the organiser and a coordinator, and hides it from another organiser", async () => {
      const draft = await newDraft(who.organiser, "IT-51-AC1-upload");

      const { put, res } = await attach(who.organiser, draft.id);

      expect(put?.ok).toBe(true);
      expect(res?.status).toBe(201);
      for (const actor of [who.organiser, who.coordinator]) {
        const list = await request(app).get(`/events/${draft.id}/request-attachments`).set("Cookie", cookie(actor));
        expect(list.body.attachments.map((a: any) => a.file_name)).toEqual(["plan.pdf"]);
      }
      const hidden = await request(app).get(`/events/${draft.id}/request-attachments`).set("Cookie", cookie(who.otherOrganiser));
      expect(hidden.body.attachments).toEqual([]);
    });

    it("refuses a path in another request's folder (AT001) and a direct table write (42501)", async () => {
      const mine = await newDraft(who.organiser, "IT-51-AC1-mine");
      const theirs = await newDraft(who.otherOrganiser, "IT-51-AC1-theirs");

      const wrongFolder = await who.organiser.client.rpc("add_event_attachment", {
        p_event_id: mine.id, p_file_name: "x.pdf", p_storage_path: `${theirs.id}/a/x.pdf`, p_content_type: "application/pdf", p_size_bytes: 1,
      });
      const direct = await who.organiser.client.from("event_request_attachments").insert({
        event_id: mine.id, file_name: "x.pdf", storage_path: `${mine.id}/a/x.pdf`, content_type: "application/pdf", size_bytes: 1, uploaded_by: who.organiser.id,
      });

      expect(wrongFolder.error?.code).toBe("AT001");
      expect(direct.error?.code).toBe(DENIED);
    });

    it("refuses someone else's draft (404), a coordinator (403) and a submitted request (409), attaching nothing", async () => {
      const draft = await newDraft(who.organiser, "IT-51-AC1-closed");

      expect((await attach(who.otherOrganiser, draft.id)).urlRes.status).toBe(404);
      expect((await attach(who.coordinator, draft.id)).urlRes.status).toBe(403);
      await markSubmitted(draft.id);
      const late = await request(app).post(`/events/drafts/${draft.id}/attachments`).set("Cookie", cookie(who.organiser))
        .send({ file_name: "a.pdf", storage_path: `${draft.id}/a/a.pdf`, content_type: "application/pdf", size: 1 });
      expect(late.status).toBe(409);
      const { data } = await admin.from("event_request_attachments").select("id").eq("event_id", draft.id);
      expect(data).toEqual([]);
    });
  });

  describe("SCRUM-51/AC2 file type restriction", () => {
    it("refuses an unsupported type at the API (400, accepted types shown) and in the database (AT002), attaching nothing", async () => {
      const draft = await newDraft(who.organiser, "IT-51-AC2-type");

      const { urlRes } = await attach(who.organiser, draft.id, "all.zip", "application/zip");
      const direct = await who.organiser.client.rpc("add_event_attachment", {
        p_event_id: draft.id, p_file_name: "all.zip", p_storage_path: `${draft.id}/a/all.zip`, p_content_type: "application/zip", p_size_bytes: 1,
      });

      expect(urlRes.status).toBe(400);
      expect(urlRes.body).toMatchObject({ code: "FILE_TYPE_NOT_ACCEPTED" });
      expect(direct.error?.code).toBe("AT002");
      const { data } = await admin.from("event_request_attachments").select("id").eq("event_id", draft.id);
      expect(data).toEqual([]);
    });
  });

  describe("SCRUM-51/AC2 the database and the shared list accept the same types", () => {
    it.each([...ATTACHMENT_TYPES].map((t) => (t === "image/*" ? "image/png" : t)))("add_event_attachment accepts %s", async (type) => {
      const draft = await newDraft(who.organiser, `IT-51-AC2-sync-${type.replace(/\W/g, "")}`.slice(0, 60));
      const { error } = await who.organiser.client.rpc("add_event_attachment", {
        p_event_id: draft.id, p_file_name: "f", p_storage_path: `${draft.id}/sync/${crypto.randomUUID()}`, p_content_type: type, p_size_bytes: 10,
      });
      expect(error?.code).not.toBe("AT002");
    });

    it.each(["image/", "video/x-flv", "application/zip", "application/x-msdownload"])("add_event_attachment refuses %s (AT002)", async (type) => {
      const draft = await newDraft(who.organiser, `IT-51-AC2-near-${type.replace(/\W/g, "")}`.slice(0, 60));
      const { error } = await who.organiser.client.rpc("add_event_attachment", {
        p_event_id: draft.id, p_file_name: "f", p_storage_path: `${draft.id}/sync/${crypto.randomUUID()}`, p_content_type: type, p_size_bytes: 10,
      });
      expect(error?.code).toBe("AT002");
    });
  });

  describe("SCRUM-51/AC3 file size restriction", () => {
    it("refuses a file over 10 MB at the API (400, maximum shown) and in the database (AT003), accepting exactly 10 MB", async () => {
      const draft = await newDraft(who.organiser, "IT-51-AC3-size");
      const tenMb = 10 * 1024 * 1024;

      const over = await request(app).post(`/events/drafts/${draft.id}/attachments/upload-url`).set("Cookie", cookie(who.organiser))
        .send({ file_name: "big.pdf", content_type: "application/pdf", size: tenMb + 1 });
      const direct = await who.organiser.client.rpc("add_event_attachment", {
        p_event_id: draft.id, p_file_name: "big.pdf", p_storage_path: `${draft.id}/a/big.pdf`, p_content_type: "application/pdf", p_size_bytes: tenMb + 1,
      });
      const exact = await who.organiser.client.rpc("add_event_attachment", {
        p_event_id: draft.id, p_file_name: "exact.pdf", p_storage_path: `${draft.id}/a/exact.pdf`, p_content_type: "application/pdf", p_size_bytes: tenMb,
      });

      expect(over.status).toBe(400);
      expect(over.body).toMatchObject({ code: "FILE_TOO_LARGE", maxBytes: tenMb });
      expect(direct.error?.code).toBe("AT003");
      expect(exact.error).toBeNull();
    });
  });

  describe("SCRUM-51/AC4 remove an attachment", () => {
    it("deletes the row and the stored file of an unsubmitted request, and refuses another organiser's draft", async () => {
      const draft = await newDraft(who.organiser, "IT-51-AC4-remove");
      const { res } = await attach(who.organiser, draft.id);
      const path = res!.body.storage_path as string;
      const url = `/events/drafts/${draft.id}/attachments/${res!.body.id}`;

      const refused = await request(app).delete(url).set("Cookie", cookie(who.otherOrganiser));
      const removed = await request(app).delete(url).set("Cookie", cookie(who.organiser));

      expect(refused.status).toBe(404);
      expect(removed.status).toBe(200);
      expect(removed.body).toEqual({ removed: true, fileRemoved: true });
      const { data: rows } = await admin.from("event_request_attachments").select("id").eq("event_id", draft.id);
      expect(rows).toEqual([]);
      const { data: file } = await admin.storage.from(BUCKET).download(path);
      expect(file).toBeNull();
    });

    it("cannot remove an attachment of one draft through another draft of the same organiser (404), and it stays", async () => {
      const a = await newDraft(who.organiser, "IT-51-AC4-cross-a");
      const b = await newDraft(who.organiser, "IT-51-AC4-cross-b");
      const { res } = await attach(who.organiser, a.id);

      const refused = await request(app).delete(`/events/drafts/${b.id}/attachments/${res!.body.id}`).set("Cookie", cookie(who.organiser));

      expect(refused.status).toBe(404);
      const { data: rows } = await admin.from("event_request_attachments").select("id").eq("event_id", a.id);
      expect(rows).toHaveLength(1);
      const { data: file } = await admin.storage.from(BUCKET).download(res!.body.storage_path as string);
      expect(file).not.toBeNull();
    });

    it("keeps the attachment once the request is submitted (409, DR002) and the file stays", async () => {
      const draft = await newDraft(who.organiser, "IT-51-AC4-submitted");
      const { res } = await attach(who.organiser, draft.id);
      await markSubmitted(draft.id);

      const late = await request(app).delete(`/events/drafts/${draft.id}/attachments/${res!.body.id}`).set("Cookie", cookie(who.organiser));
      const direct = await who.organiser.client.rpc("remove_event_attachment", { p_event_id: draft.id, p_attachment_id: res!.body.id });
      const storage = await who.organiser.client.storage.from(BUCKET).remove([res!.body.storage_path]);

      expect(late.status).toBe(409);
      expect(direct.error?.code).toBe("DR002");
      expect(storage.data ?? []).toEqual([]);
      const { data: file } = await admin.storage.from(BUCKET).download(res!.body.storage_path);
      expect(file).not.toBeNull();
      const { data: rows } = await admin.from("event_request_attachments").select("id").eq("event_id", draft.id);
      expect(rows).toHaveLength(1);
    });

    it("lets nobody but the organiser call remove_event_attachment (a coordinator gets 42501)", async () => {
      const draft = await newDraft(who.organiser, "IT-51-AC4-role");
      const { res } = await attach(who.organiser, draft.id);

      const refused = await who.coordinator.client.rpc("remove_event_attachment", { p_event_id: draft.id, p_attachment_id: res!.body.id });

      expect(refused.error?.code).toBe(DENIED);
    });
  });
});
