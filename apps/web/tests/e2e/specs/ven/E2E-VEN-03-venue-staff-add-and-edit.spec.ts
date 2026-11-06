import { waitForHydration } from "../../fixtures/hydration";
import { DAY } from "../../fixtures/scenarios";
import { tc } from "../../fixtures/tc";
import { expect, test } from "../../fixtures/test";

// SCRUM-57 (add a venue), SCRUM-58 (edit one) and SCRUM-155 (only Venue Staff write the catalogue): Venue Staff are told what is
// missing and then add a venue that shows in the catalogue; they edit it, cannot clear a required field, and are asked before
// cutting the capacity below a booked event's attendance. A coordinator sees the venues but is offered neither action and is
// told why on the page.
const t = tc("E2E-VEN-03");

test(t.title, { annotation: t.annotation }, async ({ as, data }) => {
  const name = data.name("Orchid");
  data.trackWhere("venues", `name=eq.${encodeURIComponent(name)}`); // the one the form creates, removed with its layouts and facilities
  const staff = await as("venueStaff");

  await test.step("57-S2: only a location is given, so the missing fields are named and nothing is created", async () => {
    await staff.goto("/venues");
    await staff.getByRole("link", { name: "Add venue" }).click();
    await expect(staff).toHaveURL(/\/venues\/new$/);
    await waitForHydration(staff, "#name");
    await staff.getByLabel(/^Location/).fill("Level 3, 1 Raffles Place");
    await staff.getByRole("button", { name: "Add venue" }).click();
    await expect(staff.getByText("Enter the venue's name.")).toBeVisible();
    await expect(staff.getByText(/Capacity must be a whole number/)).toBeVisible();
    await expect(staff.getByText("Choose at least one supported layout.")).toBeVisible();
    await expect(staff.getByLabel(/^Location/)).toHaveValue("Level 3, 1 Raffles Place");
    expect(await data.rest<unknown[]>(`venues?select=id&name=eq.${encodeURIComponent(name)}`), "nothing was created").toEqual([]);
  });

  await test.step("57-S1: a complete venue is added, opens on its page and is in the catalogue", async () => {
    await staff.getByLabel(/^Name/).fill(name);
    await staff.getByLabel(/^Capacity/).fill("150");
    await staff.getByLabel("Opening time").fill("08:00");
    await staff.getByLabel("Closing time").fill("22:00");
    await staff.getByRole("checkbox", { name: "Accessible venue" }).click();
    await staff.getByLabel("Accessibility notes").fill("Step-free entrance, hearing loop");
    await staff.getByRole("checkbox", { name: "Theatre" }).click();
    await staff.getByRole("checkbox", { name: "Projector & Screen" }).click();
    await staff.getByRole("button", { name: "Add venue" }).click();

    await expect(staff).toHaveURL(/\/venues\/[0-9a-f-]{36}$/);
    await expect(staff.getByRole("heading", { name })).toBeVisible();
    await expect(staff.getByText("150 people")).toBeVisible();
    await expect(staff.getByText("Projector & Screen")).toBeVisible();
    await expect(staff.getByText("Theatre")).toBeVisible();
    const [created] = await data.rest<{ id: string }[]>(`venues?select=id&name=eq.${encodeURIComponent(name)}`);
    data.trackWhere("activity_log", `entity_id=eq.${created.id}`); // registered after the venue, so it is removed first
    await staff.goto("/venues");
    await expect(staff.getByRole("link", { name })).toBeVisible();
  });

  // a venue for 150 people with the Theatre layout and a projector, and an approved booking at it for 120 people
  const venue = await data.venue({ capacity: 150, hours: ["08:00", "22:00"], layout: "Theatre", label: "Edit venue" });
  const [projector] = await data.rest<{ id: string }[]>("facilities?select=id&name=eq.Projector%20%26%20Screen");
  await data.rest("venue_facilities", { method: "POST", body: JSON.stringify({ venue_id: venue.id, facility_id: projector.id }) });
  const event = await data.event({ coordinator: "coordinator", attendance: 120, label: "Summit" });
  await data.booking({ event, venue, requestedBy: "coordinator", day: DAY, start: "09:00", end: "17:00", attendance: 120 });
  const renamed = `${venue.name} East`;

  await test.step("58-S1, S2: the form is filled in; a required field cannot be cleared; a new name is saved", async () => {
    await staff.goto(`/venues/${venue.id}`);
    await staff.getByRole("link", { name: "Edit venue" }).click();
    await expect(staff).toHaveURL(new RegExp(`/venues/${venue.id}/edit$`));
    await waitForHydration(staff, "#name");
    await expect(staff.getByLabel(/^Name/)).toHaveValue(venue.name);
    await expect(staff.getByLabel("Capacity (required)")).toHaveValue("150");
    await expect(staff.getByRole("checkbox", { name: "Theatre" })).toBeChecked();
    await expect(staff.getByRole("checkbox", { name: "Projector & Screen" })).toBeChecked();

    await staff.getByLabel(/^Name/).fill("");
    await staff.getByRole("button", { name: "Save changes" }).click();
    await expect(staff.getByText("Enter the venue's name.")).toBeVisible();
    await expect(staff).toHaveURL(new RegExp(`/venues/${venue.id}/edit$`));
    const [unchanged] = await data.rest<{ name: string }[]>(`venues?select=name&id=eq.${venue.id}`);
    expect(unchanged.name, "the saved venue is not changed").toBe(venue.name);

    await staff.getByLabel(/^Name/).fill(renamed);
    await staff.getByLabel("Description").fill("Now with a stage.");
    await staff.getByRole("button", { name: "Save changes" }).click();
    await expect(staff).toHaveURL(new RegExp(`/venues/${venue.id}$`));
    await expect(staff.getByRole("heading", { name: renamed })).toBeVisible();
    await expect(staff.getByText("Now with a stage.")).toBeVisible();
  });

  await test.step("58-S4: cutting the capacity below the booking's 120 people lists the event and saves nothing until confirmed", async () => {
    await staff.goto(`/venues/${venue.id}/edit`);
    await waitForHydration(staff, "#name");
    await staff.getByLabel("Capacity (required)").fill("100");
    await staff.getByLabel("Capacity for Theatre").fill("100");
    await staff.getByRole("button", { name: "Save changes" }).click();
    const panel = staff.getByRole("alert").filter({ hasText: "expect more people than the venue would hold" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(event.name)).toBeVisible();
    await expect(panel).toContainText("120 people");
    await expect(panel).toContainText("Approved");
    const [before] = await data.rest<{ max_capacity: number }[]>(`venues?select=max_capacity&id=eq.${venue.id}`);
    expect(before.max_capacity, "nothing is saved while the warning is open").toBe(150);

    await staff.getByRole("button", { name: "Keep editing" }).click();
    await expect(panel).toHaveCount(0);
    await staff.getByRole("button", { name: "Save changes" }).click();
    await staff.getByRole("button", { name: "Save anyway" }).click();
    await expect(staff).toHaveURL(new RegExp(`/venues/${venue.id}$`));
    await expect(staff.getByText("100 people").first()).toBeVisible();
  });

  await test.step("57-AC3, 58-AC3: a coordinator sees the venues, is offered neither action, and is told why", async () => {
    const coordinator = await as("coordinator");
    await coordinator.goto("/venues");
    await expect(coordinator.getByRole("link", { name })).toBeVisible();
    await expect(coordinator.getByRole("link", { name: "Add venue" })).toHaveCount(0);
    await coordinator.goto("/venues/new");
    // Next.js keeps its own empty role="alert" route announcer on every page, so pick ours by its text
    await expect(coordinator.getByRole("alert").filter({ hasText: "Only venue staff" })).toHaveText("Only venue staff can add a venue.");
    await expect(coordinator.getByRole("button", { name: "Add venue" })).toHaveCount(0);

    await coordinator.goto(`/venues/${venue.id}`);
    await expect(coordinator.getByRole("heading", { name: renamed })).toBeVisible();
    await expect(coordinator.getByRole("link", { name: "Edit venue" })).toHaveCount(0);
    await expect(coordinator.getByRole("button", { name: "Edit times" })).toHaveCount(0);
    await coordinator.goto(`/venues/${venue.id}/edit`);
    await expect(coordinator.getByRole("alert").filter({ hasText: "Only venue staff" })).toHaveText("Only venue staff can edit a venue.");
    await expect(coordinator.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  });
});
