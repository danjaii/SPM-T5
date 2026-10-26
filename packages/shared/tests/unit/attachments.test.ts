import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_ACCEPTED_TEXT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TOO_LARGE,
  ATTACHMENT_TYPE_REFUSED,
  attachmentProblem,
  attachmentRefusal,
} from "../../src/attachments";

describe("SCRUM-51/AC2 a file of an unsupported type is refused, naming the accepted types", () => {
  it("refuses an executable, an archive and an empty type with FILE_TYPE_NOT_ACCEPTED and the accepted types", () => {
    for (const type of ["application/x-msdownload", "application/zip", ""]) {
      expect(attachmentRefusal({ type, size: 10 })).toEqual({
        code: "FILE_TYPE_NOT_ACCEPTED",
        error: `${ATTACHMENT_TYPE_REFUSED} Accepted: ${ATTACHMENT_ACCEPTED_TEXT}.`,
        acceptedTypes: ATTACHMENT_ACCEPTED_TEXT,
      });
    }
  });

  it("names images, video and the document types", () => {
    for (const word of ["images", "MP4", "PDF", "Word", "Excel", "PowerPoint", "CSV"]) {
      expect(ATTACHMENT_ACCEPTED_TEXT).toContain(word);
    }
  });

  it("accepts images, video and documents, whatever the case of the type", () => {
    for (const type of ["image/png", "IMAGE/JPEG", "video/mp4", "application/pdf", "text/csv"]) {
      expect(attachmentRefusal({ type, size: 10 })).toBeUndefined();
      expect(attachmentProblem({ type, size: 10 })).toBeUndefined();
    }
  });

  it("does not accept a bare image/ prefix or a video type that is not listed", () => {
    expect(attachmentProblem({ type: "image/", size: 1 })).toBe(ATTACHMENT_TYPE_REFUSED);
    expect(attachmentProblem({ type: "video/x-flv", size: 1 })).toBe(ATTACHMENT_TYPE_REFUSED);
  });
});

describe("SCRUM-51/AC3 a file over the limit is refused, naming the maximum size", () => {
  it("refuses one byte over 10 MB with FILE_TOO_LARGE and the limit, and accepts exactly 10 MB", () => {
    expect(attachmentRefusal({ type: "application/pdf", size: ATTACHMENT_MAX_BYTES + 1 })).toEqual({
      code: "FILE_TOO_LARGE",
      error: ATTACHMENT_TOO_LARGE,
      maxBytes: ATTACHMENT_MAX_BYTES,
    });
    expect(ATTACHMENT_TOO_LARGE).toContain("10 MB");
    expect(attachmentRefusal({ type: "application/pdf", size: ATTACHMENT_MAX_BYTES })).toBeUndefined();
  });

  it("checks the type before the size", () => {
    expect(attachmentRefusal({ type: "application/zip", size: ATTACHMENT_MAX_BYTES + 1 })?.code).toBe("FILE_TYPE_NOT_ACCEPTED");
  });
});
