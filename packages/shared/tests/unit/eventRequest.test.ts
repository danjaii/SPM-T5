import { describe, expect, it } from "vitest";
import { eventRequestSchema, parseEventRequest } from "../../src/eventRequest";

// SCRUM-49/AC5: one validation, shared by event-service (400) and apps/web (AC3 field flags)
const NOW = new Date("2026-10-19T02:00:00.000Z");
const at = (iso: string) => iso;

const THEATRE_LAYOUT_ID = "a685c8bf-c57d-5cb4-be30-49dedce9a02b";

function valid(): Record<string, unknown> {
  return {
    name: "Tech Summit 2026",
    purpose: "Annual showcase of member companies' products",
    description: "A one-day summit with keynotes and product demos.",
    preferred_start_datetime: at("2026-12-19T01:00:00.000Z"),
    preferred_end_datetime: at("2026-12-19T09:00:00.000Z"),
    expected_attendance: 250,
    venue_requirements: "Central location near an MRT station, with a stage",
    preferred_room_layout_id: THEATRE_LAYOUT_ID,
    accessibility_requirements: "Wheelchair access to the stage",
    equipment_requirements_notes: "2 wireless microphones, 1 projector",
    registration_required: true,
    registration_capacity: 250,
    registration_opens_at: at("2026-11-01T01:00:00.000Z"),
    registration_closes_at: at("2026-12-10T01:00:00.000Z"),
  };
}

const errorsOf = (body: unknown) => {
  const result = parseEventRequest(body, NOW);
  if (result.ok) throw new Error("expected a refusal");
  return result.fieldErrors;
};

describe("SCRUM-49/AC5 eventRequestSchema accepts a complete request", () => {
  it("accepts a request with every AC1 field filled in", () => {
    const result = parseEventRequest(valid(), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toMatchObject(valid());
  });

  it('accepts "None required" for accessibility needs and equipment requirements', () => {
    const body = { ...valid(), accessibility_requirements: "None required", equipment_requirements_notes: "None required" };
    expect(parseEventRequest(body, NOW).ok).toBe(true);
  });

  it("accepts a request with no registration, and no capacity or window", () => {
    const { registration_capacity, registration_opens_at, registration_closes_at, ...rest } = valid();
    expect(parseEventRequest({ ...rest, registration_required: false }, NOW).ok).toBe(true);
  });

  it("exposes the zod schema for apps/web to reuse", () => {
    expect(eventRequestSchema.safeParse(valid()).success).toBe(true);
  });

  it("ignores fields that are not part of the request, like organiser_id", () => {
    const result = parseEventRequest({ ...valid(), organiser_id: "someone-else" }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).not.toHaveProperty("organiser_id");
  });
});

describe("SCRUM-49/AC5 every AC1 field is mandatory", () => {
  const MANDATORY = [
    "name",
    "purpose",
    "description",
    "preferred_start_datetime",
    "preferred_end_datetime",
    "expected_attendance",
    "venue_requirements",
    "preferred_room_layout_id",
    "accessibility_requirements",
    "equipment_requirements_notes",
    "registration_required",
  ];

  it.each(MANDATORY)("flags %s when it is missing", (field) => {
    const body = valid();
    delete body[field];
    expect(Object.keys(errorsOf(body))).toEqual([field]);
  });

  it.each(["name", "purpose", "description", "venue_requirements", "accessibility_requirements", "equipment_requirements_notes"])(
    "flags %s when it is blank",
    (field) => {
      expect(Object.keys(errorsOf({ ...valid(), [field]: "   " }))).toEqual([field]);
    },
  );

  it("flags a request body that is not an object", () => {
    const result = parseEventRequest(undefined, NOW);
    expect(result.ok).toBe(false);
  });

  it("flags a room layout that is not an id", () => {
    expect(Object.keys(errorsOf({ ...valid(), preferred_room_layout_id: "theatre" }))).toEqual(["preferred_room_layout_id"]);
  });

  it("flags registration_required that is not true or false", () => {
    expect(Object.keys(errorsOf({ ...valid(), registration_required: "yes" }))).toEqual(["registration_required"]);
  });
});

describe("SCRUM-49/AC5 dates", () => {
  it("flags a start that is not in the future", () => {
    const body = { ...valid(), preferred_start_datetime: at("2026-10-18T01:00:00.000Z"), preferred_end_datetime: at("2026-10-18T09:00:00.000Z") };
    expect(Object.keys(errorsOf({ ...body, registration_required: false }))).toEqual(["preferred_start_datetime"]);
  });

  it("flags an end that is not after the start", () => {
    const body = { ...valid(), preferred_end_datetime: valid().preferred_start_datetime };
    expect(Object.keys(errorsOf(body))).toEqual(["preferred_end_datetime"]);
  });

  it("flags an end before the start", () => {
    const body = { ...valid(), preferred_end_datetime: at("2026-12-18T09:00:00.000Z") };
    expect(Object.keys(errorsOf(body))).toEqual(["preferred_end_datetime"]);
  });

  it("flags a date that is not a date", () => {
    expect(Object.keys(errorsOf({ ...valid(), preferred_start_datetime: "next friday" }))).toContain("preferred_start_datetime");
  });
});

describe("SCRUM-49/AC5 numbers", () => {
  it.each([0, -5, 1.5, "250", null])("flags expected_attendance of %s", (value) => {
    expect(Object.keys(errorsOf({ ...valid(), expected_attendance: value }))).toEqual(["expected_attendance"]);
  });

  it("accepts an expected_attendance of 1", () => {
    expect(parseEventRequest({ ...valid(), expected_attendance: 1, registration_capacity: 1 }, NOW).ok).toBe(true);
  });
});

describe("SCRUM-49/AC5 registration setup", () => {
  it.each(["registration_capacity", "registration_opens_at", "registration_closes_at"])(
    "flags %s when registration is needed and it is missing",
    (field) => {
      const body = valid();
      delete body[field];
      expect(Object.keys(errorsOf(body))).toEqual([field]);
    },
  );

  it.each([0, -1, 2.5])("flags a registration_capacity of %s", (value) => {
    expect(Object.keys(errorsOf({ ...valid(), registration_capacity: value }))).toEqual(["registration_capacity"]);
  });

  it("flags a window that opens at or after it closes", () => {
    const body = { ...valid(), registration_opens_at: valid().registration_closes_at };
    expect(Object.keys(errorsOf(body))).toEqual(["registration_closes_at"]);
  });

  it("flags a window that closes after the event starts", () => {
    const body = { ...valid(), registration_closes_at: at("2026-12-19T02:00:00.000Z") };
    expect(Object.keys(errorsOf(body))).toEqual(["registration_closes_at"]);
  });

  it("accepts a window that closes exactly when the event starts", () => {
    const body = { ...valid(), registration_closes_at: valid().preferred_start_datetime };
    expect(parseEventRequest(body, NOW).ok).toBe(true);
  });

  it("does not ask for capacity or a window when registration is not needed", () => {
    const { registration_capacity, registration_opens_at, registration_closes_at, ...rest } = valid();
    expect(parseEventRequest({ ...rest, registration_required: false }, NOW).ok).toBe(true);
  });
});

describe("SCRUM-49/AC5 all bad fields are reported together", () => {
  it("lists every bad field in one go, not just the first", () => {
    const fieldErrors = errorsOf({ ...valid(), name: "", expected_attendance: 0, venue_requirements: "" });
    expect(Object.keys(fieldErrors).sort()).toEqual(["expected_attendance", "name", "venue_requirements"]);
  });

  it("gives each bad field a message a person can read", () => {
    const fieldErrors = errorsOf({ ...valid(), name: "" });
    expect(fieldErrors.name).toEqual(expect.any(String));
    expect(fieldErrors.name.length).toBeGreaterThan(0);
  });
});
