import { Router } from "express";
import { ATTACHMENT_ACCEPTED_TEXT, ATTACHMENT_MAX_BYTES, ATTACHMENT_TOO_LARGE, ATTACHMENT_TYPE_REFUSED, attachmentRefusal, canCreateEventRequests } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";
import { lookUpRole } from "./events";
import { findOwnDraft } from "./eventDrafts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "event-attachments";
const COLUMNS = "id, event_id, file_name, storage_path, content_type, size_bytes, uploaded_by, created_at";

/** SCRUM-51: supporting documents on an event request, attached to the organiser's own draft. */
export function eventAttachmentRoutes(deps: SupabaseDeps) {
  const router = Router();

  /** The organiser's own draft, or the response that refuses it (403 role, 404 not theirs, 409 submitted). */
  async function ownDraft(res: import("express").Response, id: string) {
    const user = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, user);
    if (role === undefined || !canCreateEventRequests(role)) {
      res.status(403).json({ error: "You are not allowed to attach files to event requests." });
      return undefined;
    }
    const found = await findOwnDraft(deps, user.token, id);
    if ("refusal" in found) {
      res.status(found.refusal.status).json(found.refusal.body);
      return undefined;
    }
    return user;
  }

  // SCRUM-51/AC1: a one-time URL the browser sends the file to. The URL is made as the caller, so the bucket's insert policy applies.
  router.post("/drafts/:id/attachments/upload-url", requireSession(deps), async (req, res) => {
    const id = String(req.params.id);
    const user = await ownDraft(res, id);
    if (!user) return;

    const fileName = typeof req.body.file_name === "string" ? req.body.file_name.trim() : "";
    const contentType = typeof req.body.content_type === "string" ? req.body.content_type : "";
    const size = typeof req.body.size === "number" ? req.body.size : NaN;
    if (!fileName || !contentType || !Number.isFinite(size) || size < 0) {
      return res.status(400).json({ error: "file_name, content_type and size are required." });
    }

    // SCRUM-51/AC2, AC3: a type that is not accepted, or a file over 10 MB, is turned away before anything is prepared
    const refusal = attachmentRefusal({ type: contentType, size });
    if (refusal) return res.status(400).json(refusal);

    // <event id>/<random>/<name>: the event folder is what the storage policy checks; the random folder keeps same-named files apart
    const safeName = fileName.replace(/[^\w.-]+/g, "_").slice(-100);
    const storagePath = `${id}/${crypto.randomUUID()}/${safeName}`;
    const { data } = await deps.forUser(user.token).storage.from(BUCKET).createSignedUploadUrl(storagePath);
    if (!data?.signedUrl) return res.status(500).json({ error: "Could not prepare the upload. Please try again." });
    res.json({ upload_url: data.signedUrl, storage_path: storagePath });
  });

  // SCRUM-51/AC1: attach the file that was uploaded, so it is listed with the request
  router.post("/drafts/:id/attachments", requireSession(deps), async (req, res) => {
    const id = String(req.params.id);
    const user = await ownDraft(res, id);
    if (!user) return;

    const { file_name: fileName, storage_path: storagePath, content_type: contentType, size } = req.body ?? {};
    if (
      typeof fileName !== "string" || fileName.trim() === "" || typeof storagePath !== "string" || storagePath === "" ||
      typeof contentType !== "string" || contentType === "" || typeof size !== "number" || !Number.isFinite(size) || size < 0
    ) {
      return res.status(400).json({ error: "file_name, storage_path, content_type and size are required." });
    }

    const refusal = attachmentRefusal({ type: contentType, size });
    if (refusal) return res.status(400).json(refusal);

    const { data, error } = await deps.forUser(user.token).rpc("add_event_attachment", {
      p_event_id: id, p_file_name: fileName, p_storage_path: storagePath, p_content_type: contentType, p_size_bytes: size,
    }).single();
    if (error?.code === "DR001") return res.status(404).json({ error: "Draft not found." });
    if (error?.code === "DR002") {
      return res.status(409).json({ code: "NOT_A_DRAFT", error: "This request has been submitted, so files can no longer be attached." });
    }
    if (error?.code === "AT002") {
      return res.status(400).json({
        code: "FILE_TYPE_NOT_ACCEPTED", error: `${ATTACHMENT_TYPE_REFUSED} Accepted: ${ATTACHMENT_ACCEPTED_TEXT}.`,
        acceptedTypes: ATTACHMENT_ACCEPTED_TEXT,
      });
    }
    if (error?.code === "AT003") {
      return res.status(400).json({ code: "FILE_TOO_LARGE", error: ATTACHMENT_TOO_LARGE, maxBytes: ATTACHMENT_MAX_BYTES });
    }
    if (error?.code === "AT001") return res.status(400).json({ error: "The file was not uploaded for this request." });
    if (error || !data) return res.status(500).json({ error: "Could not attach the file." });
    res.status(201).json(data);
  });

  // SCRUM-51/AC1: what is attached to a request. Read as the caller, so RLS shows the organiser's own and a coordinator's.
  router.get("/:id/request-attachments", requireSession(deps), async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(404).json({ error: "Event not found." });
    const { token } = res.locals.user as SessionUser;
    const { data } = await deps.forUser(token).from("event_request_attachments").select(COLUMNS).eq("event_id", id).order("created_at");
    res.json({ attachments: data ?? [] });
  });

  // SCRUM-51/AC4: remove an attachment from a request not yet submitted. The row goes first, in one definer function that checks
  // the caller; then the stored file, as the caller (the bucket's delete policy allows the organiser's own draft only).
  router.delete("/drafts/:id/attachments/:attachmentId", requireSession(deps), async (req, res) => {
    const id = String(req.params.id);
    const attachmentId = String(req.params.attachmentId);
    const user = await ownDraft(res, id);
    if (!user) return;
    if (!UUID.test(attachmentId)) return res.status(404).json({ error: "Attachment not found." });

    const db = deps.forUser(user.token);
    const { data, error } = await db.rpc("remove_event_attachment", { p_event_id: id, p_attachment_id: attachmentId }).single();
    if (error?.code === "DR001" || error?.code === "AT004") return res.status(404).json({ error: "Attachment not found." });
    if (error?.code === "DR002") {
      return res.status(409).json({ code: "NOT_A_DRAFT", error: "This request has been submitted, so files can no longer be removed." });
    }
    if (error || !data) return res.status(500).json({ error: "Could not remove the file." });

    const { error: storageError } = await db.storage.from(BUCKET).remove([(data as { storage_path: string }).storage_path]);
    res.json({ removed: true, fileRemoved: !storageError });
  });

  return router;
}
