import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// Fake Supabase (in memory) so tests never touch the real database
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function createFake() {
  const sessions = new Map<string, string>(); // login token -> user id
  const tables: Record<string, Row[]> = { users: [], events: [], event_request_attachments: [] };
  const rpcCalls: { fn: string; args: Row }[] = [];
  const storage = { uploadPaths: [] as string[], removed: [] as string[][], bucket: [] as string[] };
  const failure = { rpcCode: undefined as string | undefined, signedUrl: false, remove: false };

  // reads behave like RLS: an organiser sees their own events and attachments, a coordinator sees all
  const visible = (table: string, row: Row, callerId: string | undefined) => {
    const caller = tables.users.find((u) => u.id === callerId);
    if (table === "users") return true;
    if (caller?.role === "event_coordinator") return true;
    if (table === "events") return row.organiser_id === callerId;
    if (table === "event_request_attachments") {
      return tables.events.some((e) => e.id === row.event_id && e.organiser_id === callerId);
    }
    return false;
  };

  const query = (table: string, callerId: string | undefined) => {
    const filters: [string, unknown][] = [];
    let ordered: string | undefined;
    const rows = () => {
      const found = tables[table].filter((r) => visible(table, r, callerId) && filters.every(([c, v]) => r[c] === v));
      return ordered ? [...found].sort((a, b) => String(a[ordered!]).localeCompare(String(b[ordered!]))) : found;
    };
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      order: (col: string) => {
        ordered = col;
        return builder;
      },
      maybeSingle: async () => ({ data: rows()[0] ? { ...rows()[0] } : null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows().map((r) => ({ ...r })), error: null }),
    };
    return builder;
  };

  /** Pretends to be add_event_attachment (migration 86, security definer): the organiser's own draft only. */
  const addEventAttachment = (callerId: string | undefined, args: Row) => {
    if (failure.rpcCode) return { data: null, error: { message: "refused", code: failure.rpcCode } };
    const event = tables.events.find((e) => e.id === args.p_event_id && e.organiser_id === callerId);
    if (!event) return { data: null, error: { message: "not found", code: "DR001" } };
    if (event.status !== "draft") return { data: null, error: { message: "not a draft", code: "DR002" } };
    if (!String(args.p_storage_path).startsWith(`${args.p_event_id}/`)) {
      return { data: null, error: { message: "wrong folder", code: "AT001" } };
    }
    const row = {
      id: crypto.randomUUID(), event_id: args.p_event_id, file_name: args.p_file_name, storage_path: args.p_storage_path,
      content_type: args.p_content_type, size_bytes: args.p_size_bytes, uploaded_by: callerId,
      created_at: new Date(2031, 0, 1, 0, 0, tables.event_request_attachments.length).toISOString(),
    };
    tables.event_request_attachments.push(row);
    return { data: { ...row }, error: null };
  };

  /** Pretends to be remove_event_attachment (migration 86): the organiser's own draft's attachment only. */
  const removeEventAttachment = (callerId: string | undefined, args: Row) => {
    if (failure.rpcCode) return { data: null, error: { message: "refused", code: failure.rpcCode } };
    const event = tables.events.find((e) => e.id === args.p_event_id && e.organiser_id === callerId);
    if (!event) return { data: null, error: { message: "not found", code: "DR001" } };
    if (event.status !== "draft") return { data: null, error: { message: "not a draft", code: "DR002" } };
    const at = tables.event_request_attachments.findIndex((a) => a.id === args.p_attachment_id && a.event_id === args.p_event_id);
    if (at < 0) return { data: null, error: { message: "no such attachment", code: "AT004" } };
    const [row] = tables.event_request_attachments.splice(at, 1);
    return { data: { ...row }, error: null };
  };

  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) => {
          const id = sessions.get(token);
          return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: "bad token" } };
        },
      },
    },
    forUser: (token: string) => ({
      from: (table: string) => query(table, sessions.get(token)),
      rpc: (fn: string, args: Row) => {
        const run = async () => {
          rpcCalls.push({ fn, args });
          if (fn === "add_event_attachment") return addEventAttachment(sessions.get(token), args);
          if (fn === "remove_event_attachment") return removeEventAttachment(sessions.get(token), args);
          throw new Error(`fake has no function ${fn}`);
        };
        return { single: run };
      },
      storage: {
        from: (bucket: string) => {
          storage.bucket.push(bucket);
          return {
            createSignedUploadUrl: async (path: string) => {
              storage.uploadPaths.push(path);
              return failure.signedUrl ? { data: null, error: { message: "no" } } : { data: { signedUrl: `https://storage.test/${path}` }, error: null };
            },
            remove: async (paths: string[]) => {
              storage.removed.push(paths);
              return failure.remove ? { data: null, error: { message: "no" } } : { data: [], error: null };
            },
          };
        },
      },
    }),
  } as unknown as SupabaseDeps;

  const signIn = (role: string) => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role });
    sessions.set(`token-${id}`, id);
    return { id, cookie: `cs_session=token-${id}` };
  };
  const addEvent = (organiserId: string, extra: Row = {}) => {
    const event: Row = { id: crypto.randomUUID(), organiser_id: organiserId, status: "draft", is_draft: true, name: "Draft", ...extra };
    tables.events.push(event);
    return event;
  };
  return { deps, tables, rpcCalls, storage, failure, signIn, addEvent };
}
// end of fake Supabase

const PDF = { file_name: "floor plan.pdf", content_type: "application/pdf", size: 1024 };
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("SCRUM-51/AC1 upload an attachment to a draft (POST /events/drafts/:id/attachments/upload-url)", () => {
  it("answers an upload URL and a storage path inside the draft's own folder, asked of storage as the caller", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);

    const res = await request(createApp(fake.deps)).post(`/events/drafts/${draft.id}/attachments/upload-url`)
      .set("Cookie", organiser.cookie).send(PDF);

    expect(res.status).toBe(200);
    expect(res.body.storage_path).toMatch(new RegExp(`^${draft.id}/[0-9a-f-]{36}/floor_plan\\.pdf$`));
    expect(res.body.upload_url).toBe(`https://storage.test/${res.body.storage_path}`);
    expect(fake.storage.bucket).toEqual(["event-attachments"]);
  });

  it("answers 401 without a session", async () => {
    const fake = createFake();
    const res = await request(createApp(fake.deps)).post(`/events/drafts/${MISSING_ID}/attachments/upload-url`).send(PDF);
    expect(res.status).toBe(401);
  });

  it("answers 403 to a role that cannot create event requests", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);
    const coordinator = fake.signIn("event_coordinator");

    const res = await request(createApp(fake.deps)).post(`/events/drafts/${draft.id}/attachments/upload-url`)
      .set("Cookie", coordinator.cookie).send(PDF);

    expect(res.status).toBe(403);
    expect(fake.storage.uploadPaths).toEqual([]);
  });

  it("answers 404 for another organiser's draft, an unknown draft and an id that is not a uuid", async () => {
    const fake = createFake();
    const owner = fake.signIn("event_organiser");
    const other = fake.signIn("event_organiser");
    const draft = fake.addEvent(owner.id);
    const app = createApp(fake.deps);

    for (const id of [draft.id, MISSING_ID, "not-a-uuid"]) {
      const res = await request(app).post(`/events/drafts/${id}/attachments/upload-url`).set("Cookie", other.cookie).send(PDF);
      expect(res.status).toBe(404);
    }
    expect(fake.storage.uploadPaths).toEqual([]);
  });

  it("answers 409 NOT_A_DRAFT once the request is submitted", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const submitted = fake.addEvent(organiser.id, { status: "submitted", is_draft: false });

    const res = await request(createApp(fake.deps)).post(`/events/drafts/${submitted.id}/attachments/upload-url`)
      .set("Cookie", organiser.cookie).send(PDF);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_A_DRAFT");
  });

  it("answers 400 when the file name, type or size is missing", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);
    const app = createApp(fake.deps);

    for (const body of [{}, { ...PDF, file_name: " " }, { ...PDF, size: "big" }, { ...PDF, size: -1 }, { ...PDF, content_type: undefined }]) {
      const res = await request(app).post(`/events/drafts/${draft.id}/attachments/upload-url`).set("Cookie", organiser.cookie).send(body);
      expect(res.status).toBe(400);
    }
  });

  it("answers 400 when no body is sent at all", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);

    const res = await request(createApp(fake.deps)).post(`/events/drafts/${draft.id}/attachments/upload-url`).set("Cookie", organiser.cookie);

    expect(res.status).toBe(400);
  });

  it("answers 500 when storage cannot prepare the upload", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);
    fake.failure.signedUrl = true;

    const res = await request(createApp(fake.deps)).post(`/events/drafts/${draft.id}/attachments/upload-url`)
      .set("Cookie", organiser.cookie).send(PDF);

    expect(res.status).toBe(500);
  });
});

describe("SCRUM-51/AC1 attach the uploaded file (POST /events/drafts/:id/attachments)", () => {
  const registration = (eventId: string) => ({
    file_name: "floor plan.pdf", storage_path: `${eventId}/abc/floor_plan.pdf`, content_type: "application/pdf", size: 1024,
  });

  it("registers the file through add_event_attachment and answers 201 with the stored row", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);

    const res = await request(createApp(fake.deps)).post(`/events/drafts/${draft.id}/attachments`)
      .set("Cookie", organiser.cookie).send(registration(draft.id as string));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ event_id: draft.id, file_name: "floor plan.pdf", size_bytes: 1024, content_type: "application/pdf" });
    expect(fake.rpcCalls).toEqual([{
      fn: "add_event_attachment",
      args: {
        p_event_id: draft.id, p_file_name: "floor plan.pdf", p_storage_path: `${draft.id}/abc/floor_plan.pdf`,
        p_content_type: "application/pdf", p_size_bytes: 1024,
      },
    }]);
  });

  it("answers 400 when a field is missing, without calling the database", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);
    const app = createApp(fake.deps);

    for (const patch of [{ file_name: "" }, { storage_path: 5 }, { content_type: undefined }, { size: "1" }]) {
      const res = await request(app).post(`/events/drafts/${draft.id}/attachments`).set("Cookie", organiser.cookie)
        .send({ ...registration(draft.id as string), ...patch });
      expect(res.status).toBe(400);
    }
    expect(fake.rpcCalls).toEqual([]);
  });

  it("answers 400 when no body is sent at all", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);

    const res = await request(createApp(fake.deps)).post(`/events/drafts/${draft.id}/attachments`).set("Cookie", organiser.cookie);

    expect(res.status).toBe(400);
  });

  it("answers 401, 403 and 404 like the upload URL", async () => {
    const fake = createFake();
    const owner = fake.signIn("event_organiser");
    const other = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");
    const draft = fake.addEvent(owner.id);
    const app = createApp(fake.deps);
    const body = registration(draft.id as string);

    expect((await request(app).post(`/events/drafts/${draft.id}/attachments`).send(body)).status).toBe(401);
    expect((await request(app).post(`/events/drafts/${draft.id}/attachments`).set("Cookie", coordinator.cookie).send(body)).status).toBe(403);
    expect((await request(app).post(`/events/drafts/${draft.id}/attachments`).set("Cookie", other.cookie).send(body)).status).toBe(404);
    expect((await request(app).post(`/events/drafts/not-a-uuid/attachments`).set("Cookie", owner.cookie).send(body)).status).toBe(404);
    expect(fake.tables.event_request_attachments).toEqual([]);
  });

  it("answers 409 NOT_A_DRAFT for a submitted request and maps the database's DR001, DR002 and AT001 refusals", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);
    const submitted = fake.addEvent(organiser.id, { status: "submitted", is_draft: false });
    const app = createApp(fake.deps);

    const closed = await request(app).post(`/events/drafts/${submitted.id}/attachments`).set("Cookie", organiser.cookie)
      .send(registration(submitted.id as string));
    expect(closed.status).toBe(409);

    for (const [code, status] of [["DR001", 404], ["DR002", 409], ["AT001", 400], ["XX000", 500]] as const) {
      fake.failure.rpcCode = code;
      const res = await request(app).post(`/events/drafts/${draft.id}/attachments`).set("Cookie", organiser.cookie)
        .send(registration(draft.id as string));
      expect(res.status).toBe(status);
    }
  });

  it("refuses a path outside the draft's own folder (400)", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);

    const res = await request(createApp(fake.deps)).post(`/events/drafts/${draft.id}/attachments`).set("Cookie", organiser.cookie)
      .send({ ...registration(draft.id as string), storage_path: `${MISSING_ID}/abc/x.pdf` });

    expect(res.status).toBe(400);
    expect(fake.tables.event_request_attachments).toEqual([]);
  });
});

describe("SCRUM-51/AC1 list a request's attachments (GET /events/:id/request-attachments)", () => {
  it("lists the organiser's attachments oldest first, and the coordinator sees them too", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");
    const draft = fake.addEvent(organiser.id);
    const app = createApp(fake.deps);
    for (const name of ["a.pdf", "b.pdf"]) {
      await request(app).post(`/events/drafts/${draft.id}/attachments`).set("Cookie", organiser.cookie)
        .send({ file_name: name, storage_path: `${draft.id}/x/${name}`, content_type: "application/pdf", size: 10 });
    }

    for (const who of [organiser, coordinator]) {
      const res = await request(app).get(`/events/${draft.id}/request-attachments`).set("Cookie", who.cookie);
      expect(res.status).toBe(200);
      expect(res.body.attachments.map((a: Row) => a.file_name)).toEqual(["a.pdf", "b.pdf"]);
    }
  });

  it("shows another organiser nothing, answers 404 for an id that is not a uuid and 401 without a session", async () => {
    const fake = createFake();
    const owner = fake.signIn("event_organiser");
    const other = fake.signIn("event_organiser");
    const draft = fake.addEvent(owner.id);
    const app = createApp(fake.deps);
    await request(app).post(`/events/drafts/${draft.id}/attachments`).set("Cookie", owner.cookie)
      .send({ file_name: "a.pdf", storage_path: `${draft.id}/x/a.pdf`, content_type: "application/pdf", size: 10 });

    const res = await request(app).get(`/events/${draft.id}/request-attachments`).set("Cookie", other.cookie);
    expect(res.body).toEqual({ attachments: [] });
    expect((await request(app).get(`/events/not-a-uuid/request-attachments`).set("Cookie", owner.cookie)).status).toBe(404);
    expect((await request(app).get(`/events/${draft.id}/request-attachments`)).status).toBe(401);
  });
});

describe("SCRUM-51/AC2 a file of an unsupported type is rejected with the accepted types", () => {
  const ZIP = { file_name: "all.zip", content_type: "application/zip", size: 1024 };

  it("refuses the upload URL with FILE_TYPE_NOT_ACCEPTED and the accepted types, preparing nothing", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);

    const res = await request(createApp(fake.deps)).post(`/events/drafts/${draft.id}/attachments/upload-url`)
      .set("Cookie", organiser.cookie).send(ZIP);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "FILE_TYPE_NOT_ACCEPTED", acceptedTypes: expect.stringContaining("PDF") });
    expect(res.body.error).toContain("Accepted:");
    expect(fake.storage.uploadPaths).toEqual([]);
  });

  it("refuses to attach a file of an unsupported type, without calling the database", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);

    const res = await request(createApp(fake.deps)).post(`/events/drafts/${draft.id}/attachments`).set("Cookie", organiser.cookie)
      .send({ file_name: "all.zip", storage_path: `${draft.id}/a/all.zip`, content_type: "application/zip", size: 1024 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_TYPE_NOT_ACCEPTED");
    expect(fake.rpcCalls).toEqual([]);
  });

  it("maps the database's own AT002 refusal to the same answer", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);
    fake.failure.rpcCode = "AT002";

    const res = await request(createApp(fake.deps)).post(`/events/drafts/${draft.id}/attachments`).set("Cookie", organiser.cookie)
      .send({ file_name: "a.pdf", storage_path: `${draft.id}/a/a.pdf`, content_type: "application/pdf", size: 1 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_TYPE_NOT_ACCEPTED");
  });
});

describe("SCRUM-51/AC3 a file over the size limit is rejected with the maximum size", () => {
  const TEN_MB = 10 * 1024 * 1024;

  it("refuses an upload URL for a file over 10 MB with FILE_TOO_LARGE and maxBytes, preparing nothing", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);

    const res = await request(createApp(fake.deps)).post(`/events/drafts/${draft.id}/attachments/upload-url`)
      .set("Cookie", organiser.cookie).send({ ...PDF, size: TEN_MB + 1 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "FILE_TOO_LARGE", maxBytes: TEN_MB });
    expect(res.body.error).toContain("10 MB");
    expect(fake.storage.uploadPaths).toEqual([]);
  });

  it("accepts a file of exactly 10 MB", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);

    const res = await request(createApp(fake.deps)).post(`/events/drafts/${draft.id}/attachments/upload-url`)
      .set("Cookie", organiser.cookie).send({ ...PDF, size: TEN_MB });

    expect(res.status).toBe(200);
  });

  it("refuses to attach an oversized file without calling the database, and maps the database's AT003", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);
    const app = createApp(fake.deps);
    const body = { file_name: "a.pdf", storage_path: `${draft.id}/a/a.pdf`, content_type: "application/pdf", size: TEN_MB + 1 };

    const big = await request(app).post(`/events/drafts/${draft.id}/attachments`).set("Cookie", organiser.cookie).send(body);
    expect(big.status).toBe(400);
    expect(big.body.code).toBe("FILE_TOO_LARGE");
    expect(fake.rpcCalls).toEqual([]);

    fake.failure.rpcCode = "AT003";
    const db = await request(app).post(`/events/drafts/${draft.id}/attachments`).set("Cookie", organiser.cookie).send({ ...body, size: 1 });
    expect(db.status).toBe(400);
    expect(db.body).toMatchObject({ code: "FILE_TOO_LARGE", maxBytes: TEN_MB });
  });
});

describe("SCRUM-51/AC4 remove an attachment from a draft (DELETE /events/drafts/:id/attachments/:attachmentId)", () => {
  function draftWithFile(fake: ReturnType<typeof createFake>) {
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);
    const row = {
      id: crypto.randomUUID(), event_id: draft.id, file_name: "a.pdf", storage_path: `${draft.id}/x/a.pdf`,
      content_type: "application/pdf", size_bytes: 10, uploaded_by: organiser.id, created_at: "2031-01-01T00:00:00.000Z",
    };
    fake.tables.event_request_attachments.push(row);
    return { organiser, draft, row };
  }

  it("deletes the attachment and its stored file, and it is no longer listed", async () => {
    const fake = createFake();
    const { organiser, draft, row } = draftWithFile(fake);
    const app = createApp(fake.deps);

    const res = await request(app).delete(`/events/drafts/${draft.id}/attachments/${row.id}`).set("Cookie", organiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: true, fileRemoved: true });
    expect(fake.rpcCalls).toEqual([{ fn: "remove_event_attachment", args: { p_event_id: draft.id, p_attachment_id: row.id } }]);
    expect(fake.storage.removed).toEqual([[row.storage_path]]);
    const list = await request(app).get(`/events/${draft.id}/request-attachments`).set("Cookie", organiser.cookie);
    expect(list.body).toEqual({ attachments: [] });
  });

  it("keeps the attachment of a submitted request (409 NOT_A_DRAFT) and touches no file", async () => {
    const fake = createFake();
    const { organiser, draft, row } = draftWithFile(fake);
    draft.status = "submitted";
    draft.is_draft = false;

    const res = await request(createApp(fake.deps)).delete(`/events/drafts/${draft.id}/attachments/${row.id}`).set("Cookie", organiser.cookie);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_A_DRAFT");
    expect(fake.tables.event_request_attachments).toHaveLength(1);
    expect(fake.storage.removed).toEqual([]);
  });

  it("answers 401 without a session, 403 to a coordinator and 404 to another organiser, removing nothing", async () => {
    const fake = createFake();
    const { draft, row } = draftWithFile(fake);
    const other = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");
    const app = createApp(fake.deps);
    const url = `/events/drafts/${draft.id}/attachments/${row.id}`;

    expect((await request(app).delete(url)).status).toBe(401);
    expect((await request(app).delete(url).set("Cookie", coordinator.cookie)).status).toBe(403);
    expect((await request(app).delete(url).set("Cookie", other.cookie)).status).toBe(404);
    expect(fake.tables.event_request_attachments).toHaveLength(1);
    expect(fake.storage.removed).toEqual([]);
  });

  it("answers 404 for an unknown attachment or an id that is not a uuid, and 500 for any other database error", async () => {
    const fake = createFake();
    const { organiser, draft, row } = draftWithFile(fake);
    const app = createApp(fake.deps);

    expect((await request(app).delete(`/events/drafts/${draft.id}/attachments/${MISSING_ID}`).set("Cookie", organiser.cookie)).status).toBe(404);
    expect((await request(app).delete(`/events/drafts/${draft.id}/attachments/not-a-uuid`).set("Cookie", organiser.cookie)).status).toBe(404);
    fake.failure.rpcCode = "XX000";
    expect((await request(app).delete(`/events/drafts/${draft.id}/attachments/${row.id}`).set("Cookie", organiser.cookie)).status).toBe(500);
    for (const [code, status] of [["DR001", 404], ["DR002", 409]] as const) {
      fake.failure.rpcCode = code;
      expect((await request(app).delete(`/events/drafts/${draft.id}/attachments/${row.id}`).set("Cookie", organiser.cookie)).status).toBe(status);
    }
  });

  it("still answers 200 when the stored file could not be deleted, saying so", async () => {
    const fake = createFake();
    const { organiser, draft, row } = draftWithFile(fake);
    fake.failure.remove = true;

    const res = await request(createApp(fake.deps)).delete(`/events/drafts/${draft.id}/attachments/${row.id}`).set("Cookie", organiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: true, fileRemoved: false });
    expect(fake.tables.event_request_attachments).toEqual([]);
  });
});
