import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("SCRUM-49/AC3 field flagged when the organiser moves away from it", () => {
  const blur = (label: RegExp | string) => fireEvent.blur(screen.getByLabelText(label));

  it("shows the inline error beside an empty required field on blur, before Continue is pressed", () => {
    render(<EventRequestForm layouts={layouts} />);
    expect(screen.queryByText("Enter the event name.")).toBeNull();

    blur(/Event name/);

    expect(screen.getByText("Enter the event name.")).toBeTruthy();
    expect(screen.getByLabelText(/Event name/).getAttribute("aria-invalid")).toBe("true");
  });

  it("flags a textarea the same way", () => {
    render(<EventRequestForm layouts={layouts} />);
    blur(/^Purpose/);
    expect(screen.getByText("Enter the purpose.")).toBeTruthy();
  });

  it("does not flag fields the organiser has not touched", () => {
    render(<EventRequestForm layouts={layouts} />);
    blur(/Event name/);
    expect(screen.queryByText("Enter the purpose.")).toBeNull();
    expect(screen.queryByText("Enter the description.")).toBeNull();
    expect(screen.getByLabelText(/^Purpose/).getAttribute("aria-invalid")).toBeNull();
  });

  it("does not flag a field that has been filled in", () => {
    render(<EventRequestForm layouts={layouts} />);
    type(/Event name/, "Tech Summit");
    blur(/Event name/);
    expect(screen.queryByText("Enter the event name.")).toBeNull();
    expect(screen.getByText("The name attendees will see.")).toBeTruthy();
  });

  it("clears the error once the field is filled in and left again", () => {
    render(<EventRequestForm layouts={layouts} />);
    blur(/Event name/);
    expect(screen.getByText("Enter the event name.")).toBeTruthy();

    type(/Event name/, "Tech Summit");
    blur(/Event name/);

    expect(screen.queryByText("Enter the event name.")).toBeNull();
  });

  it("flags fields on later steps too, using the shared rules (a start in the past)", () => {
    render(<EventRequestForm layouts={layouts} />);
    type(/Event name/, "Tech Summit");
    type(/^Purpose/, "Showcase");
    type(/^Description/, "A day of demos");
    next();

    blur(/Expected attendance/);
    expect(screen.getByText("Enter the expected attendance.")).toBeTruthy();
    expect(screen.getByLabelText(/Starts/).getAttribute("aria-invalid")).toBeNull(); // untouched

    type(/Starts/, future(-2, 9));
    blur(/Starts/);
    expect(screen.getByText("The preferred start must be in the future.")).toBeTruthy();
    expect(screen.getByLabelText(/Ends/).getAttribute("aria-invalid")).toBeNull(); // untouched
  });

  it("keeps Continue blocking on every empty field of the step, touched or not", () => {
    render(<EventRequestForm layouts={layouts} />);
    blur(/Event name/);
    next();
    expect(screen.getByText("Enter the event name.")).toBeTruthy();
    expect(screen.getByText("Enter the purpose.")).toBeTruthy();
    expect(screen.getByText("Enter the description.")).toBeTruthy();
    expect(screen.getByText(/Step 1 of 6/)).toBeTruthy();
  });
});

describe("SCRUM-49/AC3 room layout flagged when its select closes with nothing chosen", () => {
  const MESSAGE = "Choose a room layout.";

  function toVenueStep() {
    render(<EventRequestForm layouts={layouts} />);
    type(/Event name/, complete.name);
    type(/^Purpose/, complete.purpose);
    type(/^Description/, complete.description);
    next();
    type(/Starts/, complete.start);
    type(/Ends/, complete.end);
    type(/Expected attendance/, complete.attendance);
    next();
    expect(screen.getByText(/Step 3 of 6/)).toBeTruthy();
  }
  const openSelect = () => fireEvent.click(screen.getByRole("combobox"));
  const closeSelect = async () => {
    fireEvent.keyDown(await screen.findByRole("listbox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  };

  it("does not flag the layout while the select is open", async () => {
    toVenueStep();
    openSelect();
    await screen.findByRole("listbox");
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it("flags the layout when the select closes with no value chosen", async () => {
    toVenueStep();
    openSelect();
    await closeSelect();

    expect(screen.getByText(MESSAGE)).toBeTruthy();
    expect(screen.getByRole("combobox").getAttribute("aria-invalid")).toBe("true");
  });

  it("does not flag the other fields of the step that were not touched", async () => {
    toVenueStep();
    openSelect();
    await closeSelect();
    expect(screen.queryByText("Enter the venue requirements.")).toBeNull();
  });

  it("does not flag the layout when an option is chosen and the select closes", async () => {
    toVenueStep();
    openSelect();
    fireEvent.click(await screen.findByRole("option", { name: "Theatre" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());

    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it("clears the flag once an option is chosen", async () => {
    toVenueStep();
    openSelect();
    await closeSelect();
    expect(screen.getByText(MESSAGE)).toBeTruthy();

    openSelect();
    fireEvent.click(await screen.findByRole("option", { name: "Theatre" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());

    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it("keeps Continue blocking when the layout is still empty", async () => {
    toVenueStep();
    type(/Venue requirements/, complete.venueRequirements);
    next();
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    expect(screen.getByText(/Step 3 of 6/)).toBeTruthy();
  });
});

describe("SCRUM-49/AC3 registration details flagged on blur", () => {
  async function toRegistrationYes() {
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
    fireEvent.click(screen.getByRole("button", { name: "Yes, registration needed" }));
    expect(screen.getByText(/Step 5 of 6/)).toBeTruthy();
  }
  const blur = (label: RegExp) => fireEvent.blur(screen.getByLabelText(label));

  it.each([
    [/Registration capacity/, "Enter the registration capacity."],
    [/Registration opens/, "Enter the registration opening date and time."],
    [/Registration closes/, "Enter the registration closing date and time."],
  ])("flags an empty %s when it is left, and not the other two", async (label, message) => {
    await toRegistrationYes();
    for (const other of ["Enter the registration capacity.", "Enter the registration opening date and time.", "Enter the registration closing date and time."]) {
      expect(screen.queryByText(other)).toBeNull();
    }

    blur(label);

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getAllByText(/^Enter the registration/)).toHaveLength(1);
  });

  it("flags a registration that closes after the event starts, on the closing box only", async () => {
    await toRegistrationYes();
    type(/Registration closes/, future(61, 9)); // after the start (60 days out, 09:00)
    blur(/Registration closes/);

    expect(screen.getByLabelText(/Registration closes/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Registration opens/).getAttribute("aria-invalid")).toBeNull();
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

  it("shows each section as an accordion item that opens and closes, all open to start with", async () => {
    await toReview();
    const triggers = screen.getAllByRole("button", { expanded: true }).filter((b) => b.getAttribute("data-slot") === "accordion-trigger");
    expect(triggers.length).toBe(5);

    fireEvent.click(screen.getByRole("button", { name: "Equipment" }));
    await waitFor(() => expect(screen.queryByText("Equipment requirements")).toBeNull());
    expect(screen.getByText("Tech Summit")).toBeTruthy(); // the other sections stay open

    fireEvent.click(screen.getByRole("button", { name: "Equipment" }));
    expect(await screen.findByText("Equipment requirements")).toBeTruthy();
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

// ---------------------------------------------------------------------------
// SCRUM-49 follow-up: the paths a mouse-and-keyboard walk through the form does not reach on its own
// ---------------------------------------------------------------------------

/** Fills in the steps before `target` (0 = Basics ... 4 = Registration, 5 = Review) and stops on it. Registration is "No". */
async function toStep(target: number) {
  render(<EventRequestForm layouts={layouts} />);
  if (target > 0) {
    type(/Event name/, complete.name);
    type(/^Purpose/, complete.purpose);
    type(/^Description/, complete.description);
    next();
  }
  if (target > 1) {
    type(/Starts/, complete.start);
    type(/Ends/, complete.end);
    type(/Expected attendance/, complete.attendance);
    next();
  }
  if (target > 2) {
    type(/Venue requirements/, complete.venueRequirements);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Theatre" }));
    next();
  }
  if (target > 3) {
    type(/Equipment requirements/, complete.equipment);
    next();
  }
  if (target > 4) {
    fireEvent.click(screen.getByRole("button", { name: "No registration" }));
    next();
  }
  expect(screen.getByText(new RegExp(`Step ${target + 1} of 6`))).toBeTruthy();
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

// walks several steps of the form, which is slow when the whole repo runs under coverage
describe("SCRUM-49/AC5 a request that stopped being valid is blocked on Submit and flagged", { timeout: 20_000 }, () => {
  afterEach(() => vi.useRealTimers());

  it("blocks Submit, goes back to the step with the problem and flags it, when the start time passes while the form is open", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); // only the clock, so Testing Library's waiting still works
    await toStep(5);
    vi.setSystemTime(Date.now() + 61 * 86_400_000); // the event's start (60 days out) is now in the past

    submit();

    expect(api.submit).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByText(/Step 2 of 6: Date & attendance/)).toBeTruthy();
    expect(screen.getByText("The preferred start must be in the future.")).toBeTruthy();
    expect(screen.getByLabelText(/Starts/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Ends/).getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Some details are missing or need correcting. We took you to the first one.");
  });
});

// walks several steps of the form, which is slow when the whole repo runs under coverage
describe("SCRUM-49/AC5 the API's 422 fieldErrors are shown beside their fields", { timeout: 20_000 }, () => {
  const refuse = (fieldErrors: Record<string, string>) =>
    api.submit.mockResolvedValue({ ok: false, data: { code: "VALIDATION_FAILED", error: "Check the highlighted fields.", fieldErrors } });

  it("jumps to the step with the problem and shows each error beside its own field", async () => {
    await toStep(5);
    refuse({ preferred_start_datetime: "The preferred start must be in the future.", expected_attendance: "Enter the expected attendance." });

    submit();

    expect((await screen.findByRole("alert")).textContent).toContain("Check the highlighted fields.");
    expect(screen.getByText(/Step 2 of 6: Date & attendance/)).toBeTruthy();
    expect(screen.getByText("The preferred start must be in the future.")).toBeTruthy();
    expect(screen.getByLabelText(/Starts/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter the expected attendance.")).toBeTruthy();
    expect(screen.getByLabelText(/Expected attendance/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Ends/).getAttribute("aria-invalid")).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("goes to the first step that has an error when the errors are on different steps", async () => {
    await toStep(5);
    refuse({ equipment_requirements_notes: "Enter the equipment requirements.", name: "Enter the event name." });

    submit();

    await waitFor(() => expect(screen.getByText(/Step 1 of 6: Basics/)).toBeTruthy());
    expect(screen.getByText("Enter the event name.")).toBeTruthy();
    expect(screen.getByLabelText(/Event name/).getAttribute("aria-invalid")).toBe("true");
  });

  it("falls back to a general message when the refusal gives no reason", async () => {
    await toStep(5);
    api.submit.mockResolvedValue({ ok: false, data: {} });

    submit();

    expect((await screen.findByRole("alert")).textContent).toContain("We couldn't submit the request. Please try again.");
    expect(screen.getByText(/Step 6 of 6/)).toBeTruthy(); // nothing to point at, so it stays on Review
    expect((screen.getByRole("button", { name: "Submit request" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not leave the form stuck in its submitting state", async () => {
    await toStep(5);
    refuse({ expected_attendance: "Enter the expected attendance." });
    submit();
    await screen.findByText("Enter the expected attendance.");

    expect((screen.getByRole("button", { name: /^Continue to/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("SCRUM-123/AC1 Back button", () => {
  it("is off on the first step", () => {
    render(<EventRequestForm layouts={layouts} />);
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("goes to the previous step and keeps what was typed", async () => {
    await toStep(1);
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByText(/Step 1 of 6: Basics/)).toBeTruthy();
    expect((screen.getByLabelText(/Event name/) as HTMLInputElement).value).toBe(complete.name);
  });
});

// walks several steps of the form, which is slow when the whole repo runs under coverage
describe("SCRUM-123/AC2 choices that can be turned off again", { timeout: 20_000 }, () => {
  const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

  it("turns an accessibility chip on and off", async () => {
    await toStep(2);
    expect(pressed("Hearing loop")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Hearing loop" }));
    expect(pressed("Hearing loop")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Hearing loop" }));
    expect(pressed("Hearing loop")).toBe("false");
  });

  it("turning registration 'Yes' off again hides the capacity and window boxes", async () => {
    await toStep(4);
    fireEvent.click(screen.getByRole("button", { name: "Yes, registration needed" }));
    expect(screen.getByLabelText(/Registration capacity/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Yes, registration needed" }));

    expect(pressed("Yes, registration needed")).toBe("false");
    expect(screen.queryByLabelText(/Registration capacity/)).toBeNull();
  });

  it("turning 'No registration' off again leaves the question unanswered, so Continue asks for an answer", async () => {
    await toStep(4);
    fireEvent.click(screen.getByRole("button", { name: "No registration" }));
    fireEvent.click(screen.getByRole("button", { name: "No registration" }));
    expect(pressed("No registration")).toBe("false");

    next();

    expect(screen.getByText("Say whether attendee registration is needed.")).toBeTruthy();
    expect(screen.getByText(/Step 5 of 6/)).toBeTruthy();
  });
});
