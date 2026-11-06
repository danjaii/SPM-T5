import { EVENT_URL, type ApiResult } from "./api";

/** SCRUM-51: a supporting document attached to an event request, as event-service lists it. */
export interface RequestAttachment {
  id: string;
  file_name: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

const UNREACHABLE = "We couldn't reach the server. Please try again.";

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${EVENT_URL}${path}`, {
      method,
      credentials: "include",
      ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: UNREACHABLE } as ApiResult<T>["data"] };
  }
}

const draftPath = (eventId: string) => `/events/drafts/${encodeURIComponent(eventId)}/attachments`;

/** SCRUM-51/AC1: what is attached to the request, oldest first. */
export const listRequestAttachments = (eventId: string) =>
  call<{ attachments: RequestAttachment[] }>("GET", `/events/${encodeURIComponent(eventId)}/request-attachments`);

/** SCRUM-51/AC1: a one-time URL to send one file to, and the path it will be stored at. */
export const requestAttachmentUpload = (eventId: string, file: File) =>
  call<{ upload_url: string; storage_path: string }>("POST", `${draftPath(eventId)}/upload-url`, {
    file_name: file.name,
    content_type: file.type,
    size: file.size,
  });

/** SCRUM-51/AC1: attach the file that was sent to storage, so it is listed with the request. */
export const registerRequestAttachment = (eventId: string, file: File, storagePath: string) =>
  call<RequestAttachment>("POST", draftPath(eventId), {
    file_name: file.name,
    storage_path: storagePath,
    content_type: file.type,
    size: file.size,
  });

/** SCRUM-51/AC4: take a document off a request that has not been submitted. */
export const removeRequestAttachment = (eventId: string, attachmentId: string) =>
  call<{ removed: boolean }>("DELETE", `${draftPath(eventId)}/${encodeURIComponent(attachmentId)}`);
