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

const dataOf = (body: unknown) => {
  const result = parseEventRequestDraft(body);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.fieldErrors)}`);
  return result.data;
};
const errorsOf = (body: unknown) => {
  const result = parseEventRequestDraft(body);
  return result.ok ? {} : result.fieldErrors;
};

describe("SCRUM-53/AC2 parseEventRequestDraft does not block on empty fields", () => {
  it("accepts an empty object and treats an absent body like one", () => {
    expect(dataOf({}).name).toBeNull();
    expect(dataOf(undefined).purpose).toBeNull();
    expect(dataOf(null).purpose).toBeNull();
  });

  it("turns empty, blank and null values into null", () => {
    const data = dataOf({
      name: "   ",
      purpose: "",
      description: null,
      preferred_start_datetime: "",
      expected_attendance: "",
      preferred_room_layout_id: "",
      registration_capacity: null,
    });
    for (const field of ["name", "purpose", "description", "preferred_start_datetime", "expected_attendance", "preferred_room_layout_id", "registration_capacity"] as const) {
      expect(data[field]).toBeNull();
    }
  });

  it("trims text and keeps it", () => {
    expect(dataOf({ name: "  Summit  ", venue_requirements: " a stage " })).toMatchObject({ name: "Summit", venue_requirements: "a stage" });
  });

  it("does not apply the submission rules (a past date, registration needed but no window, empty accessibility text)", () => {
    expect(
      dataOf({
        preferred_start_datetime: "2001-01-01T09:00:00.000Z",
        preferred_end_datetime: "2001-01-01T17:00:00.000Z",
        registration_required: true,
        accessibility_requirements: "",
      }),
    ).toMatchObject({ registration_required: true, registration_capacity: null, accessibility_requirements: null });
  });

  it("allows registration to close after the event starts and zero attendance", () => {
    expect(
      dataOf({
        preferred_start_datetime: "2031-05-01T09:00:00.000Z",
        registration_opens_at: "2031-05-01T08:00:00.000Z",
        registration_closes_at: "2031-05-02T08:00:00.000Z",
        expected_attendance: 0,
      }),
    ).toMatchObject({ expected_attendance: 0 });
  });

  it("defaults registration_required to false and keeps the registration fields as typed", () => {
    expect(dataOf({}).registration_required).toBe(false);
    expect(dataOf({ registration_required: false, registration_capacity: 40 }).registration_capacity).toBe(40);
  });
});

describe("SCRUM-53/AC2 parseEventRequestDraft still refuses what the database refuses", () => {
  it("refuses a body that is not an object", () => {
    expect(errorsOf([])).toHaveProperty("body");
    expect(errorsOf("text")).toHaveProperty("body");
    expect(errorsOf(5)).toHaveProperty("body");
  });

  it("refuses a text field that is not text", () => {
    expect(errorsOf({ name: 5 })).toHaveProperty("name");
    expect(errorsOf({ purpose: { a: 1 } })).toHaveProperty("purpose");
  });

  it.each([-1, 1.5, "ten", true])("refuses expected_attendance %j", (value) => {
    expect(errorsOf({ expected_attendance: value })).toHaveProperty("expected_attendance");
  });

  it.each([-1, 2.5])("refuses registration_capacity %j", (value) => {
    expect(errorsOf({ registration_capacity: value })).toHaveProperty("registration_capacity");
  });

  it.each(["preferred_start_datetime", "preferred_end_datetime", "registration_opens_at", "registration_closes_at"])(
    "refuses a malformed %s",
    (field) => {
      expect(errorsOf({ [field]: "not a date" })).toHaveProperty(field);
      expect(errorsOf({ [field]: 12 })).toHaveProperty(field);
    },
  );

  it("refuses a room layout that is not a uuid", () => {
    expect(errorsOf({ preferred_room_layout_id: "theatre" })).toHaveProperty("preferred_room_layout_id");
  });

  it("refuses registration_required that is not a boolean", () => {
    expect(errorsOf({ registration_required: "yes" })).toHaveProperty("registration_required");
  });

  it("refuses an end that is not after the start, only when both are given", () => {
    const start = "2031-05-01T09:00:00.000Z";
    expect(errorsOf({ preferred_start_datetime: start, preferred_end_datetime: start })).toHaveProperty("preferred_end_datetime");
    expect(errorsOf({ preferred_start_datetime: start, preferred_end_datetime: "2031-05-01T08:00:00.000Z" })).toHaveProperty("preferred_end_datetime");
    expect(errorsOf({ preferred_end_datetime: "2031-05-01T08:00:00.000Z" })).toEqual({});
  });

  it("refuses registration closing at or before it opens, only when both are given", () => {
    const opens = "2031-04-01T09:00:00.000Z";
    expect(errorsOf({ registration_opens_at: opens, registration_closes_at: opens })).toHaveProperty("registration_closes_at");
    expect(errorsOf({ registration_closes_at: "2031-03-01T09:00:00.000Z" })).toEqual({});
  });

  it("lists every bad field at once", () => {
    expect(Object.keys(errorsOf({ expected_attendance: -1, preferred_room_layout_id: "x", name: 1 })).sort()).toEqual([
      "expected_attendance",
      "name",
      "preferred_room_layout_id",
    ]);
  });

  it("does not compare a date that is itself invalid", () => {
    expect(Object.keys(errorsOf({ preferred_start_datetime: "bad", preferred_end_datetime: "2031-05-01T08:00:00.000Z" }))).toEqual(["preferred_start_datetime"]);
  });
});
