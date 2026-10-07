import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TOO_LARGE,
  ATTACHMENT_TYPE_REFUSED,
  attachmentProblem,
} from "../src/attachments";

describe("SCRUM-28/AC4 supported file types", () => {
  it.each([
    "image/png",
    "image/jpeg",
    "IMAGE/GIF",
    "video/mp4",
    "video/quicktime",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "text/csv",
    "text/plain",
  ])("accepts %s", (type) => {
    expect(attachmentProblem({ type, size: 1024 })).toBeUndefined();
  });
});

describe("SCRUM-28/AC5 unsupported file types", () => {
  it.each(["application/zip", "application/x-msdownload", "text/html", "video/x-msvideo", "image/", "image", ""])(
    "refuses %j",
    (type) => {
      expect(attachmentProblem({ type, size: 1024 })).toBe(ATTACHMENT_TYPE_REFUSED);
    },
  );
});

describe("SCRUM-28/AC6 file size", () => {
  it("accepts a file of exactly 10 MB", () => {
    expect(attachmentProblem({ type: "application/pdf", size: ATTACHMENT_MAX_BYTES })).toBeUndefined();
  });

  it("refuses anything larger", () => {
    expect(attachmentProblem({ type: "application/pdf", size: ATTACHMENT_MAX_BYTES + 1 })).toBe(ATTACHMENT_TOO_LARGE);
  });
});
