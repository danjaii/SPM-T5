import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createFake } from "../support/fakeSupabase";

let fake: ReturnType<typeof createFake>;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  fake = createFake();
  app = createApp(fake.deps);
});

/** Logs in and returns the Cookie header to send on later requests. */
async function signInAs(email: string, role: string) {
  const res = await request(app).post("/auth/login").send({ email, password: "Passw0rd!", role });
  expect(res.status).toBe(200);
  return (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

// ---------------------------------------------------------------------------
// SCRUM-68 — View and update the signed-in user's own profile (docs/specs/user-profile.md)
// ---------------------------------------------------------------------------
describe("SCRUM-68/AC1 view profile", () => {
  // Anyone who is signed in can open their own profile and see their name, contact details, preferences and role.
  it("68-S1: shows the signed-in user's name, contact email, phone, preferences and role", async () => {
    
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    Object.assign(fake.tables.users.find((u) => u.id === id)!, {
      full_name: "Rachel Tan",
      phone: "+65 8100 2000",
      communication_preferences: { email: true, sms: false },
    });

    const res = await request(app).get("/profile").set("Cookie", await signInAs("rachel@example.com", "event_coordinator"));

    expect(res.status).toBe(200);
    // we want a successful reply of the information
    expect(res.body).toEqual({
      fullName: "Rachel Tan",
      email: "rachel@example.com",
      loginEmail: "rachel@example.com",
      phone: "+65 8100 2000",
      communicationPreferences: { email: true, sms: false },
      role: "event_coordinator",
      organisation: null,
    });
  });
  // An Event Organiser also sees which organisation they belong to (by name, as plain information).
  it("68-S2: also shows an Event Organiser's organisation", async () => {
    const id = fake.seedUser("jason@techconnect.example.com", "event_organiser");
    fake.tables.organisations.push({ id: "org-1", name: "TechConnect Pte Ltd" });
    Object.assign(fake.tables.users.find((u) => u.id === id)!, { organisation_id: "org-1" });

    const res = await request(app).get("/profile").set("Cookie", await signInAs("jason@techconnect.example.com", "event_organiser"));

    expect(res.status).toBe(200);
    expect(res.body.organisation).toEqual({ name: "TechConnect Pte Ltd" });
  });
  // Only Event Organisers belong to an organisation. For anyone else it is not shown, even if the stored data has one by mistake.
  it("68-S3: shows no organisation to anyone who is not an Event Organiser", async () => {
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    fake.tables.organisations.push({ id: "org-1", name: "TechConnect Pte Ltd" });
    Object.assign(fake.tables.users.find((u) => u.id === id)!, { organisation_id: "org-1" });

    const res = await request(app).get("/profile").set("Cookie", await signInAs("rachel@example.com", "event_coordinator"));

    expect(res.status).toBe(200);
    expect(res.body.organisation).toBeNull();
  });
  // end of view profile
});
describe("SCRUM-68/AC3 update profile", () => {
  // Editing the name, phone and preferences with valid values saves them, and the answer shows the profile as it is now.
  it("68-S4: saves a valid new name, phone and preferences, and returns the updated profile", async () => {
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    const cookie = await signInAs("rachel@example.com", "event_coordinator");

    const res = await request(app)
      .patch("/profile")
      .set("Cookie", cookie)
      .send({ fullName: "Rachel Lim", phone: "+65 9123 4567", communicationPreferences: { email: false, sms: true } });

    expect(res.status).toBe(200);
    // we want a 200 response because the changes is reasonable 
    expect(res.body).toMatchObject({
      fullName: "Rachel Lim",
      phone: "+65 9123 4567",
      communicationPreferences: { email: false, sms: true },
    });
    expect(fake.tables.users.find((u) => u.id === id)).toMatchObject({
      full_name: "Rachel Lim",
      phone: "+65 9123 4567",
      communication_preferences: { email: false, sms: true },
    });
  });
  // If anything submitted is empty where it must not be, or in the wrong format, nothing at all is saved and the person
  // gets a message for each wrong field. The details already stored are left exactly as they were.
  it.each([
    ["an empty name", { fullName: "" }, { fullName: "Name is required." }],
    ["an empty email", { email: "" }, { email: "Email is required." }],
    ["an email that is not valid", { email: "not-an-email" }, { email: "Enter a valid email address." }],
    ["a phone number that is not valid", { phone: "abc" }, { phone: "Enter a valid contact number." }],
    [
      "a good name next to a bad email (the good name is not saved either)",
      { fullName: "Rachel Lim", email: "not-an-email" },
      { email: "Enter a valid email address." },
    ],
  ])("68-S13: refuses %s, saves nothing and keeps the previous details", async (_name, body, fieldErrors) => {
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    const before = { ...fake.tables.users.find((u) => u.id === id)! };

    const res = await request(app).patch("/profile").set("Cookie", await signInAs("rachel@example.com", "event_coordinator")).send(body);

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ fieldErrors });
    expect(fake.tables.users.find((u) => u.id === id)).toEqual(before);
  });
  // The contact email must be unique. If another profile already has it, nothing is saved and the person is told so.
  it("68-S7: refuses an email that another profile already has, and saves nothing", async () => {
    fake.seedUser("priya@example.com", "event_coordinator");
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    const before = { ...fake.tables.users.find((u) => u.id === id)! };

    const res = await request(app)
      .patch("/profile")
      .set("Cookie", await signInAs("rachel@example.com", "event_coordinator"))
      .send({ fullName: "Rachel Lim", email: "priya@example.com" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: "That email address is already in use.",
      fieldErrors: { email: "That email address is already in use." },
    });
    expect(fake.tables.users.find((u) => u.id === id)).toEqual(before);
  });
  // If the database cannot save for some other reason, the person is told it did not work (not shown a "saved" answer), and the
  // details already stored are left as they were.
  it("68-S13: says the save failed, instead of reporting success, when the database cannot save", async () => {
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    const cookie = await signInAs("rachel@example.com", "event_coordinator");
    const before = { ...fake.tables.users.find((u) => u.id === id)! };
    fake.failUpdates.value = true;

    const res = await request(app).patch("/profile").set("Cookie", cookie).send({ fullName: "Rachel Lim" });

    expect(res.status).toBe(500);
    // we want to return error 500 if we can't save their profile 
    expect(res.body).toEqual({ error: "We couldn't save your profile. Please try again." });
    expect(fake.tables.users.find((u) => u.id === id)).toEqual(before);
  });
  // The email on the profile is only the contact email. Changing it never changes how the person signs in.
  it("68-S5: saves a new contact email (tidied up) and leaves the login email unchanged", async () => {
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    const cookie = await signInAs("rachel@example.com", "event_coordinator");

    const res = await request(app).patch("/profile").set("Cookie", cookie).send({ email: " Rachel.New@Example.com " });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: "rachel.new@example.com", loginEmail: "rachel@example.com" });
    expect(fake.tables.users.find((u) => u.id === id)).toMatchObject({ email: "rachel.new@example.com" });
    expect(fake.authUsers.find((u) => u.id === id)!.email).toBe("rachel@example.com");
    await signInAs("rachel@example.com", "event_coordinator"); // the old address still signs in
  });

  // Only the fields that are sent change. The rest keep what they had.
  it("68-S19: changes only the fields that were sent", async () => {
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    Object.assign(fake.tables.users.find((u) => u.id === id)!, {
      phone: "+65 8100 2000",
      communication_preferences: { email: true, sms: true },
    });

    const res = await request(app)
      .patch("/profile")
      .set("Cookie", await signInAs("rachel@example.com", "event_coordinator"))
      .send({ fullName: "Rachel Lim" });

    expect(res.status).toBe(200);
    expect(fake.tables.users.find((u) => u.id === id)).toMatchObject({
      full_name: "Rachel Lim",
      phone: "+65 8100 2000",
      communication_preferences: { email: true, sms: true },
    });
  });

  // Clearing the phone box removes the phone. It is optional, so this is allowed.
  it("68-S6: clears the phone when the box is emptied", async () => {
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    Object.assign(fake.tables.users.find((u) => u.id === id)!, { phone: "+65 8100 2000" });

    const res = await request(app)
      .patch("/profile")
      .set("Cookie", await signInAs("rachel@example.com", "event_coordinator"))
      .send({ phone: "" });

    expect(res.status).toBe(200);
    expect(res.body.phone).toBeNull();
    expect(fake.tables.users.find((u) => u.id === id)!.phone).toBeNull();
  });

  // Nobody can promote themselves or move to another organisation through the profile. The request is refused outright,
  // and even a good change sent in the same request is not saved.
  it.each([
    ["role", "event_organiser"],
    ["organisation", "org-other"],
  ])("68-S14/S16: refuses a request that tries to change %s, and saves nothing", async (field, value) => {
    const id = fake.seedUser("rachel@example.com", "event_coordinator");
    const before = { ...fake.tables.users.find((u) => u.id === id)! };

    const res = await request(app)
      .patch("/profile")
      .set("Cookie", await signInAs("rachel@example.com", "event_coordinator"))
      .send({ fullName: "Rachel Lim", [field]: value });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ fieldErrors: { [field]: "This can't be changed." } });
    expect(fake.tables.users.find((u) => u.id === id)).toEqual(before);
  });

  // Someone who is not signed in cannot change any profile.
  it("68-S18: refuses a visitor who is not signed in from saving", async () => {
    const res = await request(app).patch("/profile").send({ fullName: "Rachel Lim" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not signed in." });
  });
  // end of update profile
});

describe("SCRUM-68 profile access", () => {
  // Someone who is not signed in gets nothing: no profile is shown. (This already works through the sign-in check every
  // service uses, so this test locks it in rather than driving new code.)
  it("68-S18: refuses a visitor who is not signed in", async () => {
    const res = await request(app).get("/profile");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not signed in." });
  });
  // end of access
});
// end of SCRUM-68
