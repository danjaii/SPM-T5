import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ROLES, type EquipmentCatalogueItem, type EquipmentInput } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import { notFound, validationFailed } from "../../src/domain/errors";
import type { EquipmentCatalogueStore } from "../../src/repositories/equipmentCatalogueStore";
import {
  FakeEquipmentReader,
  FakeEquipmentRequestReader,
  FakeEquipmentRequestReviewer,
  FakeEquipmentRequestWriter,
  FakeEventReader,
  FakeReservationReader,
  FakeReservationWriter,
  FakeVenueBookingReader,
  fakeDeps,
  fakeRoles,
} from "../support/fakes";

/**
 * SCRUM-182 (docs/specs/equipment-catalogue-maintenance.md): Technical Support Staff add and edit equipment and change an item's
 * operational status. The database functions check it all again (migration 78; tests/integration/equipmentCatalogue.test.ts);
 * these cover the routes, with a store that behaves the way those functions do.
 */

const PROJECTOR = "2cde28cc-997e-58d3-8b9a-21b6938a81d4";
const MISSING = "00000000-0000-4000-8000-000000000000";

const projector = (extra: Partial<EquipmentCatalogueItem> = {}): EquipmentCatalogueItem => ({
  id: PROJECTOR,
  name: "Projector Unit",
  type: "AV",
  description: "1080p ceiling projector.",
  totalQuantity: 10,
  location: "Central Equipment Store",
  operationalStatus: "available",
  ...extra,
});

/** An in-memory catalogue that acts like create_equipment and update_equipment, with a record of every call. */
function createStore(initial: EquipmentCatalogueItem[] = [projector()]) {
  const items = initial.map((i) => ({ ...i }));
  let next = 1;
  const store = {
    list: vi.fn(async () => [...items].sort((a, b) => a.name.localeCompare(b.name))),
    create: vi.fn(async (input: EquipmentInput) => {
      const id = `new-${next++}`;
      items.push({ id, ...input });
      return { id };
    }),
    update: vi.fn(async (id: string, input: EquipmentInput) => {
      const item = items.find((i) => i.id === id);
      if (!item) throw notFound("Equipment not found.");
      Object.assign(item, input);
      return { id };
    }),
  } satisfies EquipmentCatalogueStore;
  return { store, items, factory: () => store };
}

function setup(initial?: EquipmentCatalogueItem[]) {
  const s = createStore(initial);
  const app = createApp(fakeDeps, {
    ports: () => ({
      events: new FakeEventReader([]),
      equipment: new FakeEquipmentReader(),
      reservations: new FakeReservationReader(),
      roles: fakeRoles(),
      writer: new FakeReservationWriter(),
      venueBookings: new FakeVenueBookingReader([]),
      requests: new FakeEquipmentRequestReader(),
      requestWriter: new FakeEquipmentRequestWriter(),
      reviewer: new FakeEquipmentRequestReviewer(),
    }),
    catalogue: s.factory,
  });
  const as = (user: string | null, req: request.Test) => (user ? req.set("Cookie", `cs_session=tok-${user}`) : req);
  return {
    ...s,
    app,
    list: (user: string | null = "tech-1") => as(user, request(app).get("/equipment-catalogue")),
    add: (body: object, user: string | null = "tech-1") => as(user, request(app).post("/equipment-catalogue").send(body)),
    edit: (body: object, id = PROJECTOR, user: string | null = "tech-1") => as(user, request(app).put(`/equipment-catalogue/${id}`).send(body)),
  };
}

const newItem = (extra: Record<string, unknown> = {}) => ({
  name: "Wireless Microphone",
  type: "Audio",
  description: "Handheld.",
  totalQuantity: "6",
  location: "Store B",
  ...extra,
});
const changed = (extra: Record<string, unknown> = {}) => ({
  name: "Projector Unit",
  type: "AV",
  description: "1080p ceiling projector.",
  totalQuantity: 10,
  location: "Central Equipment Store",
  operationalStatus: "available",
  ...extra,
});

const OTHER_ROLES = ROLES.filter((r) => r !== "technical_support_staff").map((r) => `${r}-user`);

describe("SCRUM-182/AC1 technical support staff add an item (182-S1)", () => {
  it("182-S1: 201 with the new id; the store gets the cleaned values and the item starts available", async () => {
    const t = setup();

    const res = await t.add(newItem({ name: "  Wireless   Microphone ", totalQuantity: " 6 " }));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "new-1" });
    expect(t.store.create).toHaveBeenCalledWith({
      name: "Wireless Microphone",
      type: "Audio",
      description: "Handheld.",
      totalQuantity: 6,
      location: "Store B",
      operationalStatus: "available",
    });
  });

  it("182-S1: a status in an add request is ignored: a new item is always available", async () => {
    const t = setup();

    await t.add(newItem({ operationalStatus: "retired" }));

    expect(t.store.create).toHaveBeenCalledWith(expect.objectContaining({ operationalStatus: "available" }));
  });

  it("182-S1: only the required fields are enough, and the optional ones are stored as null", async () => {
    const t = setup();

    const res = await t.add({ name: "Cable Reel", totalQuantity: 25 });

    expect(res.status).toBe(201);
    expect(t.store.create).toHaveBeenCalledWith({
      name: "Cable Reel",
      type: null,
      description: null,
      totalQuantity: 25,
      location: null,
      operationalStatus: "available",
    });
  });

  it("182-S1: the new item is then in the catalogue list, by name, never cached", async () => {
    const t = setup();
    await t.add(newItem());

    const list = await t.list();

    expect(list.status).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.body.map((i: EquipmentCatalogueItem) => i.name)).toEqual(["Projector Unit", "Wireless Microphone"]);
    expect(list.body[0]).toEqual(projector());
  });
});

describe("SCRUM-182/AC2 technical support staff edit an item (182-S2)", () => {
  it("182-S2: 200 with the id; the store gets the cleaned values and the item shows them", async () => {
    const t = setup();

    const res = await t.edit(changed({ name: " Projector  Unit 2 ", totalQuantity: "12", location: "  " }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: PROJECTOR });
    expect(t.store.update).toHaveBeenCalledWith(PROJECTOR, {
      name: "Projector Unit 2",
      type: "AV",
      description: "1080p ceiling projector.",
      totalQuantity: 12,
      location: null,
      operationalStatus: "available",
    });
    expect(t.items[0]).toMatchObject({ name: "Projector Unit 2", totalQuantity: 12, location: null });
  });

  it("182-S2: an unknown id is 404, and a malformed id is 404 too, once the role is known", async () => {
    const t = setup();

    const unknown = await t.edit(changed(), MISSING);
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe("NOT_FOUND");

    const malformed = await t.edit(changed(), "not-an-id");
    expect(malformed.status).toBe(404);
    expect(t.store.update).toHaveBeenCalledTimes(1); // only the well-formed id reached the store
  });
});

describe("SCRUM-182/AC3 technical support staff change an item's status (182-S3)", () => {
  it.each(["available", "damaged", "under_maintenance", "retired"] as const)("182-S3: an edit to %s is saved", async (status) => {
    const t = setup();

    const res = await t.edit(changed({ operationalStatus: status }));

    expect(res.status).toBe(200);
    expect(t.items[0].operationalStatus).toBe(status);
  });

  it("182-S3: an edit that leaves the status out is refused, so it cannot put a damaged item back in service by accident", async () => {
    const t = setup([projector({ operationalStatus: "damaged" })]);
    const { operationalStatus: _left, ...withoutStatus } = changed();

    const res = await t.edit(withoutStatus);

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ operationalStatus: "Choose one of the listed statuses." });
    expect(t.items[0].operationalStatus).toBe("damaged");
    expect(t.store.update).not.toHaveBeenCalled();
  });

  it("182-S3: a status that is not one of the four is a 422 on its field", async () => {
    const t = setup();

    const res = await t.edit(changed({ operationalStatus: "broken" }));

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["operationalStatus"]);
  });
});

describe("SCRUM-182/AC4 required and invalid fields (182-S4)", () => {
  it("182-S4: an empty body names every required field on add, and nothing is created", async () => {
    const t = setup();

    const res = await t.add({});

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["name", "totalQuantity"]);
    expect(t.store.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a blank name", { name: "   " }, "name"],
    ["a name over 120 characters", { name: "x".repeat(121) }, "name"],
    ["a quantity of zero", { totalQuantity: 0 }, "totalQuantity"],
    ["a quantity that is not a whole number", { totalQuantity: "2.5" }, "totalQuantity"],
    ["a quantity over the limit", { totalQuantity: 100001 }, "totalQuantity"],
    ["a type over 60 characters", { type: "x".repeat(61) }, "type"],
    ["a description over 500 characters", { description: "x".repeat(501) }, "description"],
    ["a location over 120 characters", { location: "x".repeat(121) }, "location"],
  ])("182-S4: %s is a 422 on the %s field, on add and on edit, and the store is not called", async (_label, extra, field) => {
    const t = setup();

    const add = await t.add(newItem(extra));
    const edit = await t.edit(changed(extra));

    for (const res of [add, edit]) {
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.fieldErrors)).toEqual([field]);
    }
    expect(t.store.create).not.toHaveBeenCalled();
    expect(t.store.update).not.toHaveBeenCalled();
  });

  it("182-S4: a refusal the database makes on a field is shown on that field", async () => {
    const t = setup();
    t.store.create.mockRejectedValueOnce(validationFailed({ name: "Enter the equipment's name." }));

    const res = await t.add(newItem());

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ name: "Enter the equipment's name." });
  });
});

describe("SCRUM-182/AC5 only technical support staff (182-S5)", () => {
  const calls = [
    ["GET", (t: ReturnType<typeof setup>, user: string | null) => t.list(user)],
    ["POST", (t: ReturnType<typeof setup>, user: string | null) => t.add({}, user)],
    ["PUT", (t: ReturnType<typeof setup>, user: string | null) => t.edit({}, PROJECTOR, user)],
  ] as const;

  it.each(OTHER_ROLES)("182-S5: %s gets 403 on all three routes, even with an invalid body, and nothing is written", async (user) => {
    const t = setup();

    for (const [, call] of calls) {
      const res = await call(t, user);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
    expect(t.store.list).not.toHaveBeenCalled();
    expect(t.store.create).not.toHaveBeenCalled();
    expect(t.store.update).not.toHaveBeenCalled();
  });

  it("182-S5: the coordinators and organisers of the other tests are refused too", async () => {
    const t = setup();

    for (const user of ["coord-1", "coord-2", "org-1", "org-2"]) {
      expect((await t.list(user)).status).toBe(403);
    }
  });

  it("182-S5: with no session every route is 401", async () => {
    const t = setup();

    for (const [, call] of calls) {
      expect((await call(t, null)).status).toBe(401);
    }
  });

  it("182-S5: the web app's preflight for PUT is answered, so the browser may send it", async () => {
    const t = setup();

    const res = await request(t.app).options(`/equipment-catalogue/${PROJECTOR}`).set("Origin", "http://localhost:3000");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("PUT");
  });
});
