// SCRUM-28: which comment attachments are accepted, shared by event-service and apps/web so both check the same
// way. Mirrors the event-attachments bucket in migration 08, which enforces the same limits on upload.

/** SCRUM-28/AC6: the largest file, 10 MB (the bucket's file_size_limit). */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** SCRUM-28/AC4: images, video and common documents (the bucket's allowed_mime_types). */
export const ATTACHMENT_TYPES = [
  "image/*",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
] as const;

export const ATTACHMENT_TYPE_REFUSED = "This file type is not supported. Attach an image, video or document.";
export const ATTACHMENT_TOO_LARGE = "This file is larger than the 10 MB limit.";

const typeAllowed = (type: string) =>
  ATTACHMENT_TYPES.some((allowed) =>
    allowed.endsWith("/*") ? type.startsWith(allowed.slice(0, -1)) && type.length > allowed.length - 1 : type === allowed,
  );

/** SCRUM-28/AC5, AC6: why a file can't be attached, or undefined when it can. */
export function attachmentProblem(file: { type: string; size: number }): string | undefined {
  if (!typeAllowed(file.type.toLowerCase())) return ATTACHMENT_TYPE_REFUSED;
  if (file.size > ATTACHMENT_MAX_BYTES) return ATTACHMENT_TOO_LARGE;
  return undefined;
}

/** SCRUM-51/AC2: the accepted types in words, for the message a refused file is shown. */
export const ATTACHMENT_ACCEPTED_TEXT = "images, video (MP4, MOV, WebM), PDF, Word, Excel, PowerPoint, plain text and CSV";

export type AttachmentRefusal =
  | { code: "FILE_TYPE_NOT_ACCEPTED"; error: string; acceptedTypes: string }
  | { code: "FILE_TOO_LARGE"; error: string; maxBytes: number };

/**
 * SCRUM-51/AC2: why a file can't be attached, with the accepted types, or undefined when it can.
 * SCRUM-51/AC3: or, for a file over the limit, with the maximum size. The type is judged first.
 */
export function attachmentRefusal(file: { type: string; size: number }): AttachmentRefusal | undefined {
  if (!typeAllowed(file.type.toLowerCase())) {
    return {
      code: "FILE_TYPE_NOT_ACCEPTED",
      error: `${ATTACHMENT_TYPE_REFUSED} Accepted: ${ATTACHMENT_ACCEPTED_TEXT}.`,
      acceptedTypes: ATTACHMENT_ACCEPTED_TEXT,
    };
  }
  if (file.size > ATTACHMENT_MAX_BYTES) return { code: "FILE_TOO_LARGE", error: ATTACHMENT_TOO_LARGE, maxBytes: ATTACHMENT_MAX_BYTES };
  return undefined;
}
