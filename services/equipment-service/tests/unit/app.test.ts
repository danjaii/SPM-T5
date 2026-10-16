import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { FakeEquipmentReader, FakeReservationReader, anEquipment, fakeDeps, fakeRoles, FakeReservationWriter, FakeEventReader, noRequestPorts } from "../support/fakes";

// ----------------------------------------------------------------------------
// Browser access (CORS): the web app on localhost:3000 calls equipment-service on localhost:4004 straight
// from the browser, so the service has to say it trusts that address, and only that one.
// ----------------------------------------------------------------------------


// only our website is allowed to read equipment data in the browser, any other website is blocked
const app = createApp(fakeDeps, {
  ports: () => ({
    equipment: new FakeEquipmentReader([anEquipment()]),
    reservations: new FakeReservationReader(),
    roles: fakeRoles(),
    writer: new FakeReservationWriter(),
    ...noRequestPorts(),
    events: new FakeEventReader(),
  }),
});

describe("SCRUM-18 browser access to equipment-service", () => {
  it("tells the browser the web app (localhost:3000) may read the reply, with its login cookie", async () => {
    const res = await request(app)
      .get("/equipment")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", "cs_session=tok-tech-1");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("answers the browser's 'may I?' check (OPTIONS) before the real request, without needing a login", async () => {
    // SCRUM-19: reserving is a POST, so the browser must be told POST is allowed too.
    const res = await request(app).options("/equipment-reservations").set("Origin", "http://localhost:3000");
    // the browser asks which methods the service allows; it must now say POST is allowed too, not just GET
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toBe("GET,POST,PATCH,OPTIONS");
  });

  it("gives any other website no permission", async () => {
    const res = await request(app)
      .get("/equipment")
      .set("Origin", "http://evil.example")
      .set("Cookie", "cs_session=tok-tech-1");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
// end of browser access

// ----------------------------------------------------------------------------
// Unexpected failures: if the database breaks, the user gets a plain "Something went wrong." and none of the
// internal details (which could reveal how the system works).
// ----------------------------------------------------------------------------
describe("SCRUM-18 unexpected failures", () => {
  it("answers 500 with a plain message, without leaking the error, when reading the database fails", async () => {
    const broken = createApp(fakeDeps, {
      ports: () => ({
        equipment: { list: () => Promise.reject(new Error("database down: secret detail")) },
        reservations: new FakeReservationReader(),
        roles: fakeRoles(),
        writer: new FakeReservationWriter(),
        ...noRequestPorts(),
        events: new FakeEventReader(),
      }),
    });

    const res = await request(broken).get("/equipment").set("Cookie", "cs_session=tok-tech-1");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong." });
  });
});
// end of unexpected failures
