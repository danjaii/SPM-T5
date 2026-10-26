import { describe, expect, it } from "vitest";
import { parseEventRequestDraft } from "../../src/eventDraft";

describe("SCRUM-53/AC1 parseEventRequestDraft keeps what was sent", () => {
  it("returns the fields that were sent and null for the others", () => {
    const result = parseEventRequestDraft({ name: "Summit", expected_attendance: 50 });
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ name: "Summit", expected_attendance: 50, purpose: null, preferred_start_datetime: null }),
    });
  });

  it("drops keys that are not part of the request", () => {
    const result = parseEventRequestDraft({ name: "Summit", organiser_id: "x", status: "approved" });
    expect(result.ok && Object.keys(result.data)).not.toContain("organiser_id");
    expect(result.ok && Object.keys(result.data)).not.toContain("status");
  });
});
