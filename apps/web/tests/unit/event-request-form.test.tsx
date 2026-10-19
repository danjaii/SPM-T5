import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));
const api = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("@/lib/eventRequests", () => ({ submitEventRequest: api.submit }));

import { EventRequestForm } from "@/components/event-request/EventRequestForm";
import { EMPTY_VALUES, accessibilityText, toRequestBody, validateStep } from "@/lib/eventRequestForm";

const LAYOUT = "a685c8bf-c57d-5cb4-be30-49dedce9a02b";
const layouts = [{ id: LAYOUT, name: "Theatre" }];

const future = (days: number, hour: number) => {
  const d = new Date(Date.now() + days * 86_400_000 + 8 * 3_600_000); // Singapore wall time
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString().slice(0, 16);
};
const complete = {
  ...EMPTY_VALUES,
  name: "Tech Summit",
  purpose: "Showcase",
  description: "A day of demos",
  start: future(60, 9),
  end: future(60, 17),
  attendance: "250",
  venueRequirements: "Near an MRT",
  layoutId: LAYOUT,
  equipment: "None required",
  registrationRequired: "no" as const,
};

const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const next = () => fireEvent.click(screen.getByRole("button", { name: /^Continue to/ }));

beforeEach(() => {
  nav.push.mockClear();
  api.submit.mockReset();
});

describe("SCRUM-123/AC1 progress bar", () => {
  it("shows the current step and the steps left, and moves on Continue", () => {
    render(<EventRequestForm layouts={layouts} />);
    expect(screen.getByText(/Step 1 of 6: Basics/).textContent).toContain("5 left");
    expect(screen.getByRole("progressbar", { name: "Request progress" })).toBeTruthy();

    type(/Event name/, "Tech Summit");
    type(/^Purpose/, "Showcase");
    type(/^Description/, "A day of demos");
    next();
    expect(screen.getByText(/Step 2 of 6: Date & attendance/).textContent).toContain("4 left");
  });
});

describe("SCRUM-123/AC2 required field validation", () => {
  it("shows an inline error and helper text beside an empty field and stays on the step", () => {
    render(<EventRequestForm layouts={layouts} />);
    next();

    const name = screen.getByLabelText(/Event name/);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter the event name.")).toBeTruthy();
    expect(screen.getByText(/Step 1 of 6/)).toBeTruthy();
    // a field that has helper text and no error keeps its helper
    expect(screen.queryByText("The name attendees will see.")).toBeNull();
  });

  it("keeps the helper text on a field with no error", () => {
    render(<EventRequestForm layouts={layouts} />);
    type(/Event name/, "Tech Summit");
    next();
    expect(screen.queryByText("The name attendees will see.")).toBeTruthy();
    expect(screen.getByText("Enter the purpose.")).toBeTruthy();
  });

  it("only blocks on the current step's own fields", () => {
    expect(validateStep(0, { ...complete, name: "" })).toEqual({ name: "Enter the event name." });
    expect(validateStep(0, { ...EMPTY_VALUES, name: "A", purpose: "B", description: "C" })).toEqual({});
    expect(Object.keys(validateStep(4, EMPTY_VALUES))).toEqual(["registration_required"]);
  });

  it("asks for the registration details only when registration is needed", () => {
    expect(Object.keys(validateStep(4, { ...complete, registrationRequired: "yes" })).sort()).toEqual([
      "registration_capacity", "registration_closes_at", "registration_opens_at",
    ]);
    expect(validateStep(4, complete)).toEqual({});
  });

  it("treats no ticked accessibility needs as 'None required'", () => {
    expect(accessibilityText({ accessibility: [], accessibilityNotes: "" })).toBe("None required");
    expect(accessibilityText({ accessibility: ["Hearing loop"], accessibilityNotes: " ramp " })).toBe("Hearing loop, ramp");
    expect(toRequestBody(complete).accessibility_requirements).toBe("None required");
  });
});

describe("SCRUM-123/AC3 review step", () => {
  async function toReview() {
    render(<EventRequestForm layouts={layouts} />);
    // walk the steps with a complete request by editing each box in turn
    type(/Event name/, complete.name);
    type(/^Purpose/, complete.purpose);
    type(/^Description/, complete.description);
    next();
    type(/Starts/, complete.start);
    type(/Ends/, complete.end);
    type(/Expected attendance/, complete.attendance);
    next();
    type(/Venue requirements/, complete.venueRequirements);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Theatre" }));
    fireEvent.click(screen.getByRole("button", { name: "Hearing loop" }));
    next();
    type(/Equipment requirements/, complete.equipment);
    next();
    fireEvent.click(screen.getByRole("button", { name: "No registration" }));
    next();
  }

  it("shows everything entered, with an Edit link per section that goes back to that step", async () => {
    await toReview();
    expect(screen.getByText(/Step 6 of 6: Review & submit/)).toBeTruthy();

    const venue = screen.getByRole("region", { name: "Venue needs" });
    expect(within(venue).getByText("Near an MRT")).toBeTruthy();
    expect(within(venue).getByText("Theatre")).toBeTruthy();
    expect(within(venue).getByText("Hearing loop")).toBeTruthy();
    expect(screen.getByText("Tech Summit")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Edit / }).length).toBe(5);

    fireEvent.click(screen.getByRole("button", { name: "Edit Basics" }));
    expect(screen.getByText(/Step 1 of 6: Basics/)).toBeTruthy();
    expect((screen.getByLabelText(/Event name/) as HTMLInputElement).value).toBe("Tech Summit");
  });

  it("is where Submit is", async () => {
    await toReview();
    expect(screen.getByRole("button", { name: "Submit request" })).toBeTruthy();
  });
});

describe("SCRUM-123/AC4 submit", () => {
  async function submitComplete() {
    render(<EventRequestForm layouts={layouts} />);
    type(/Event name/, complete.name);
    type(/^Purpose/, complete.purpose);
    type(/^Description/, complete.description);
    next();
    type(/Starts/, complete.start);
    type(/Ends/, complete.end);
    type(/Expected attendance/, complete.attendance);
    next();
    type(/Venue requirements/, complete.venueRequirements);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Theatre" }));
    next();
    type(/Equipment requirements/, complete.equipment);
    next();
    fireEvent.click(screen.getByRole("button", { name: "No registration" }));
    next();
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  }

  it("sends the request and lands on the event page", async () => {
    api.submit.mockResolvedValue({ ok: true, data: { id: "evt-1" } });
    await submitComplete();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/events/evt-1?submitted=1"));
    expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({ name: "Tech Summit", preferred_room_layout_id: LAYOUT, registration_required: false }));
  });

  it("stays on the form with the reason when event-service refuses", async () => {
    api.submit.mockResolvedValue({ ok: false, data: { error: "You are not allowed to create event requests." } });
    await submitComplete();
    expect((await screen.findByRole("alert")).textContent).toContain("You are not allowed to create event requests.");
    expect(nav.push).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Submit request" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
