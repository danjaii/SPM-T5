import { EQUIPMENT_REQUEST_EDIT_MESSAGES, EQUIPMENT_REQUEST_MESSAGES } from "@spm-t5/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { EquipmentRequestInfo } from "../../src/readers/equipmentRequestReader";
import type { EventInfo } from "../../src/readers/eventReader";
import type { VenueBookingInfo } from "../../src/readers/venueBookingReader";
import type { ChangeOutcome } from "../../src/writers/equipmentRequestWriter";
import {
  FakeEquipmentReader,
  FakeEquipmentRequestReader,
  FakeEquipmentRequestReviewer,
  FakeEquipmentRequestWriter,
  FakeEventReader,
  FakeReservationReader,
  FakeReservationWriter,
  FakeVenueBookingReader,
  aVenueBooking,
  anEquipment,
  anEquipmentRequest,
  anEvent,
  fakeDeps,
  fakeRoles,
} from "../support/fakes";

// ----------------------------------------------------------------------------
// SCRUM-88: the assigned coordinator (coord-1, see fakes.ts) changes an equipment request. The fake writer changes
// the stored row as update_equipment_request() (migration 38) does; the real function is tested in tests/integration.
// ----------------------------------------------------------------------------

const EVENT = "evt-devops";
const mic = anEquipment({ id: "eq-mic", name: "Wireless Microphone Set", type: "Audio" });
const retired = anEquipment({ id: "eq-old", name: "Old Projector", operationalStatus: "retired" });
const hall = aVenueBooking();
const annex = aVenueBooking({
  id: "vb-annex",
  venueName: "Annex",
  start: new Date("2026-10-16T01:00:00Z"),
  end: new Date("2026-10-16T05:00:00Z"),
});

function setup({
  events = [anEvent()],
  bookings = [hall, annex],
  stored = [anEquipmentRequest()],
  outcome = "updated" as ChangeOutcome,
}: { events?: EventInfo[]; bookings?: VenueBookingInfo[]; stored?: EquipmentRequestInfo[]; outcome?: ChangeOutcome } = {}) {
  const writer = new FakeEquipmentRequestWriter(outcome, stored);
  const app = createApp(fakeDeps, {
    ports: () => ({
      events: new FakeEventReader(events),
      equipment: new FakeEquipmentReader([anEquipment(), mic, retired]),
      reservations: new FakeReservationReader(),
      roles: fakeRoles(),
      writer: new FakeReservationWriter(),
      venueBookings: new FakeVenueBookingReader(bookings),
      requests: new FakeEquipmentRequestReader(stored),
      requestWriter: writer,
      reviewer: new FakeEquipmentRequestReviewer(),
    }),
  });
  const as = (user: string | null, req: request.Test) => (user ? req.set("Cookie", `cs_session=tok-${user}`) : req);
  return {
    writer,
    stored,
    editForm: (id = "req-1", user: string | null = "coord-1") =>
      as(user, request(app).get(`/events/${EVENT}/equipment-requests/${id}/edit-form`)),
    change: (body: Record<string, unknown>, id = "req-1", user: string | null = "coord-1") =>
      as(user, request(app).patch(`/events/${EVENT}/equipment-requests/${id}`).send(body)),
    list: (user: string | null = "coord-1") => as(user, request(app).get(`/events/${EVENT}/equipment-requests`)),
    queue: (user = "tech-1") => as(user, request(app).get("/equipment-requests")),
    detail: (id = "req-1", user = "tech-1") => as(user, request(app).get(`/equipment-requests/${id}`)),
  };
}

/** The new details; each test changes only the field it is about. */
const changed = { equipmentId: "eq-mic", quantity: "6", venueBookingId: "vb-annex", notes: "Two more on stage" };

// end of test setup

describe("SCRUM-88/AC1 edit a request", () => {
  it("the change form starts on the request's current details", async () => {
    const { editForm } = setup({ stored: [anEquipmentRequest({ notes: "Front row" })] });
    const res = await editForm();

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.request).toEqual({
      id: "req-1",
      equipmentId: "eq-projector",
      quantity: 2,
      venueBookingId: "vb-hall",
      notes: "Front row",
      status: "SUBMITTED",
      statusLabel: "Submitted",
    });
    // the same lists as the request form: items that are not retired, and the event's approved venues
    expect(res.body.equipment.map((o: { id: string }) => o.id)).toEqual(["eq-mic", "eq-projector"]);
    expect(res.body.venues.map((v: { id: string }) => v.id)).toEqual(["vb-hall", "vb-annex"]);
  });

  it("saves the new item, quantity, venue and notes, for the new venue's period", async () => {
    const { change, writer } = setup();
    const res = await change(changed);

    expect(res.status).toBe(200);
    expect(writer.changed).toEqual([
      {
        requestId: "req-1",
        equipmentId: "eq-mic",
        quantity: 6,
        venueBookingId: "vb-annex",
        notes: "Two more on stage",
        start: annex.start,
        end: annex.end,
      },
    ]);
    // the new details replace the old ones for the coordinator...
    expect(res.body).toMatchObject({
      id: "req-1",
      equipmentId: "eq-mic",
      quantity: 6,
      venueBookingId: "vb-annex",
      notes: "Two more on stage",
      status: "SUBMITTED",
      canEdit: true,
    });
  });

  it("...and for Technical Support Staff", async () => {
    const { change, detail } = setup();
    await change(changed);
    const res = await detail();
    expect(res.body).toMatchObject({ quantity: 6, notes: "Two more on stage", status: "SUBMITTED" });
  });

  it("the event page offers Change on each request the coordinator may edit", async () => {
    const { list } = setup({
      stored: [
        anEquipmentRequest({ id: "a", status: "requested" }),
        anEquipmentRequest({ id: "b", status: "under_review" }),
        anEquipmentRequest({ id: "c", status: "approved" }),
        anEquipmentRequest({ id: "d", status: "rejected" }),
        anEquipmentRequest({ id: "e", status: "cancelled" }),
      ],
    });
    const res = await list();
    expect(res.body.requests.map((r: { id: string; canEdit: boolean }) => [r.id, r.canEdit])).toEqual([
      ["a", true],
      ["b", true],
      ["c", true],
      ["d", true],
      // decision: Released equipment belongs to a cancelled venue booking
      ["e", false],
    ]);
  });
});

describe("SCRUM-88/AC2 send it back for review", () => {
  it.each(["under_review", "approved", "rejected"])("a %s request goes back to Submitted when changed", async (dbStatus) => {
    const { change, list } = setup({ stored: [anEquipmentRequest({ status: dbStatus, reviewReason: dbStatus === "rejected" ? "All out" : null })] });
    expect((await change(changed)).body).toMatchObject({ status: "SUBMITTED", statusLabel: "Submitted", reason: null });
    expect((await list()).body.requests[0]).toMatchObject({ status: "SUBMITTED" });
  });

  it("open question 6 (decision): a change to the notes alone sends it back too", async () => {
    const { change } = setup({ stored: [anEquipmentRequest({ status: "approved" })] });
    const res = await change({ equipmentId: "eq-projector", quantity: "2", venueBookingId: "vb-hall", notes: "Use the HDMI one" });
    expect(res.body.status).toBe("SUBMITTED");
  });

  it("Technical Support Staff see it in the queue marked Updated", async () => {
    const { change, queue } = setup({
      stored: [anEquipmentRequest({ status: "approved" }), anEquipmentRequest({ id: "req-2", status: "requested" })],
    });
    await change(changed);
    const res = await queue();
    expect(res.body.map((r: { id: string; updated: boolean }) => [r.id, r.updated])).toEqual([
      ["req-1", true],
      ["req-2", false],
    ]);
  });

  it("the Updated mark goes once staff change the status again", async () => {
    const { queue } = setup({
      stored: [anEquipmentRequest({ status: "under_review", lastChangedBy: "Rachel Tan", lastChangedAt: new Date("2026-10-15T09:40:00Z") })],
    });
    expect((await queue()).body[0].updated).toBe(false);
  });
});

describe("SCRUM-88/AC3 wrong information", () => {
  it.each([
    [{ ...changed, equipmentId: "" }, "equipmentId", EQUIPMENT_REQUEST_MESSAGES.equipmentMissing],
    [{ ...changed, quantity: "0" }, "quantity", EQUIPMENT_REQUEST_MESSAGES.quantityInvalid],
    [{ ...changed, quantity: "1.5" }, "quantity", EQUIPMENT_REQUEST_MESSAGES.quantityInvalid],
    [{ ...changed, quantity: "abc" }, "quantity", EQUIPMENT_REQUEST_MESSAGES.quantityInvalid],
    [{ ...changed, quantity: "" }, "quantity", EQUIPMENT_REQUEST_MESSAGES.quantityMissing],
    // a retired item is not offered, so it counts as none chosen
    [{ ...changed, equipmentId: "eq-old" }, "equipmentId", EQUIPMENT_REQUEST_MESSAGES.equipmentMissing],
    [{ ...changed, venueBookingId: "vb-elsewhere" }, "venueBookingId", EQUIPMENT_REQUEST_MESSAGES.venueMissing],
  ])("%o: nothing is saved, the old details are kept, and the field says what to fix", async (body, field, message) => {
    const { change, writer, stored } = setup();
    const res = await change(body);

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors[field]).toBe(message);
    expect(writer.changed).toEqual([]);
    expect(stored[0]).toMatchObject({ equipmentId: "eq-projector", quantity: 2, status: "requested" });
  });

  it("a save with no body at all is treated as every field left empty", async () => {
    const { writer } = setup();
    const app = createApp(fakeDeps, {
      ports: () => ({
        events: new FakeEventReader([anEvent()]),
        equipment: new FakeEquipmentReader([anEquipment()]),
        reservations: new FakeReservationReader(),
        roles: fakeRoles(),
        writer: new FakeReservationWriter(),
        venueBookings: new FakeVenueBookingReader([hall]),
        requests: new FakeEquipmentRequestReader([anEquipmentRequest()]),
        requestWriter: writer,
        reviewer: new FakeEquipmentRequestReviewer(),
      }),
    });
    // no JSON body: express.json() gives an empty one
    const res = await request(app).patch(`/events/${EVENT}/equipment-requests/req-1`).set("Cookie", "cs_session=tok-coord-1");
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["equipmentId", "quantity", "venueBookingId"]);
  });

  it("a venue the database no longer accepts is reported on the venue field", async () => {
    const { change } = setup({ outcome: "venue_invalid" });
    const res = await change(changed);
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ venueBookingId: EQUIPMENT_REQUEST_MESSAGES.venueMissing });
  });
});

describe("SCRUM-88/AC4 finished events", () => {
  it.each(["completed", "cancelled", "rejected"])("a %s event: no Change, no form, nothing saved", async (status) => {
    const { list, editForm, change, writer } = setup({ events: [anEvent({ status })] });

    expect((await list()).body.requests[0].canEdit).toBe(false);
    const form = await editForm();
    expect(form.status).toBe(409);
    expect(form.body.error).toBe(EQUIPMENT_REQUEST_EDIT_MESSAGES.eventLocked);
    expect((await change(changed)).status).toBe(409);
    expect(writer.changed).toEqual([]);
  });

  it("an event finished between loading and saving is refused by the database", async () => {
    const { change } = setup({ outcome: "event_locked" });
    const res = await change(changed);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "EVENT_LOCKED", error: EQUIPMENT_REQUEST_EDIT_MESSAGES.eventLocked });
  });
});

describe("SCRUM-88/AC5, AC6 only the assigned coordinator", () => {
  it("AC5: after the Lead moves the event to coord-2, coord-2 can change its requests and coord-1 cannot", async () => {
    const { list, change } = setup({ events: [anEvent({ assignedCoordinatorId: "coord-2" })] });

    expect((await list("coord-2")).body.requests[0].canEdit).toBe(true);
    expect((await change(changed, "req-1", "coord-2")).status).toBe(200);
    expect((await list("coord-1")).status).toBe(403);
    expect((await change(changed, "req-1", "coord-1")).status).toBe(403);
  });

  it.each(["coord-2", "tech-1", "event_organiser-user", "event_coordinator_lead-user", "safety_officer-user"])(
    "AC6: %s cannot change a request",
    async (user) => {
      const { change, editForm, writer } = setup();
      expect((await editForm("req-1", user)).status).toBe(403);
      expect((await change(changed, "req-1", user)).status).toBe(403);
      expect(writer.changed).toEqual([]);
    },
  );

  it("a row with a status this code does not know is left out of the list", async () => {
    const { list } = setup({ stored: [anEquipmentRequest(), anEquipmentRequest({ id: "odd", status: "some_future_status" })] });
    expect((await list()).body.requests.map((r: { id: string }) => r.id)).toEqual(["req-1"]);
  });

  it("Technical Support Staff see the requests but no Change", async () => {
    const { list } = setup();
    expect((await list("tech-1")).body.requests[0].canEdit).toBe(false);
  });

  it("no session is a 401", async () => {
    const { change } = setup();
    expect((await change(changed, "req-1", null)).status).toBe(401);
  });
});

describe("SCRUM-88/AC8 who changed it", () => {
  it("the coordinator and Technical Support Staff see who last changed it, and when (Singapore time)", async () => {
    const { change, list, detail } = setup();
    await change(changed);

    expect((await list()).body.requests[0]).toMatchObject({ lastChangedBy: "Rachel Tan", lastChangedAt: "2026-10-15 17:40" });
    expect((await detail()).body).toMatchObject({ lastChangedBy: "Rachel Tan", lastChangedAt: "2026-10-15 17:40" });
  });

  it("a request never changed shows no one", async () => {
    const { list, detail } = setup();
    expect((await list()).body.requests[0]).toMatchObject({ lastChangedBy: null, lastChangedAt: null });
    expect((await detail()).body).toMatchObject({ lastChangedBy: null, lastChangedAt: null });
  });
});

describe("SCRUM-88 requests that cannot be changed", () => {
  it("decision: Released equipment cannot be changed", async () => {
    const { editForm, change, writer } = setup({ stored: [anEquipmentRequest({ status: "cancelled" })] });
    const form = await editForm();
    expect(form.status).toBe(409);
    expect(form.body).toEqual({ code: "NOT_EDITABLE", error: EQUIPMENT_REQUEST_EDIT_MESSAGES.notEditable });
    expect((await change(changed)).status).toBe(409);
    expect(writer.changed).toEqual([]);
  });

  it("the database's answers for a request gone or Released in the meantime", async () => {
    expect((await setup({ outcome: "not_found" }).change(changed)).status).toBe(404);
    expect((await setup({ outcome: "not_editable" }).change(changed)).body.code).toBe("NOT_EDITABLE");
  });

  it("a request that does not exist, or belongs to another event, is a 404", async () => {
    const { editForm, change } = setup({ stored: [anEquipmentRequest({ id: "other", eventId: "evt-other" })] });
    expect((await editForm("missing")).status).toBe(404);
    expect((await editForm("other")).status).toBe(404);
    expect((await change(changed, "other")).status).toBe(404);
  });

  it("a request removed between saving and reading it back is a 404", async () => {
    const stored = [anEquipmentRequest()];
    const { change, writer } = setup({ stored });
    // the save succeeds, then the row is gone (for example, its event was deleted) before it is read back
    const update = writer.update.bind(writer);
    writer.update = async (c) => {
      const outcome = await update(c);
      stored.length = 0;
      return outcome;
    };
    expect((await change(changed)).status).toBe(404);
  });
});
