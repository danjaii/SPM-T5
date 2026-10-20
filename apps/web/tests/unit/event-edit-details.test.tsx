import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), redirect: vi.fn() }));

const { getEventEditForm } = vi.hoisted(() => ({ getEventEditForm: vi.fn() }));
vi.mock("@/lib/getEvent", () => ({ getEventEditForm }));

import EditEventPage from "@/app/events/[id]/edit/page";
import { changeValue, EventChangeHistory } from "@/components/EventChangeHistory";
import { EventDetailsForm } from "@/components/EventDetailsForm";
import { EventRequestDetails } from "@/components/EventRequestDetails";
import type { EventChangeHistoryEntry, EventDetailView, EventEditForm } from "@/lib/events";

// ----------------------------------------------------------------------------
// Test setup: "Tech Summit" on Sat 12 Dec 2099, 9am-5pm, 120 people (docs/specs/edit-event-details.md)
// ----------------------------------------------------------------------------

const form: EventEditForm = {
  values: {
    name: "Tech Summit",
    description: "Annual summit",
    purpose: "",
    categoryId: "cat-conference",
    date: "2099-12-12",
    startTime: "09:00",
    endDate: "2099-12-12",
    endTime: "17:00",
    expectedAttendance: 120,
    roomLayoutId: "layout-theatre",
    accessibilityRequirements: "",
    venueRequirements: "Stage",
    equipmentRequirements: "",
  },
  categories: [
    { id: "cat-conference", name: "Conference" },
    { id: "cat-workshop", name: "Workshop" },
  ],
  roomLayouts: [
    { id: "layout-banquet", name: "Banquet" },
    { id: "layout-theatre", name: "Theatre" },
  ],
  importantFields: ["date", "startTime", "endDate", "endTime", "expectedAttendance", "roomLayoutId", "accessibilityRequirements", "venueRequirements", "equipmentRequirements"],
};

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
const IMPORTANT = "Important: may affect venue or equipment arrangements";

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-111/AC2 the form shows ordinary and important fields apart
// ----------------------------------------------------------------------------

describe("SCRUM-111/AC2 the edit form (111-S4, 111-S5)", () => {
  it("111-S4 starts with the event's current values", () => {
    render(<EventDetailsForm eventId="evt-1" form={form} />);

    expect(box("Event name").value).toBe("Tech Summit");
    expect(box("Date").value).toBe("2099-12-12");
    expect(box("Start time").value).toBe("09:00");
    expect(box("Expected attendance").value).toBe("120");
    expect(screen.getByLabelText("Category").textContent).toContain("Conference");
    expect(screen.getByLabelText("Room layout").textContent).toContain("Theatre");
    expect(box("Venue requirements").value).toBe("Stage");
  });

  it("111-S5 shows ordinary and important fields in two groups", () => {
    render(<EventDetailsForm eventId="evt-1" form={form} />);

    const ordinary = screen.getByRole("region", { name: "Event details" });
    const important = screen.getByRole("region", { name: "Important details" });
    for (const label of ["Event name", "Description", "Purpose", "Category"]) expect(within(ordinary).getByLabelText(label)).toBeTruthy();
    for (const label of ["Date", "Start time", "End date", "End time", "Expected attendance", "Room layout", "Accessibility needs", "Venue requirements", "Equipment requirements"]) {
      expect(within(important).getByLabelText(label)).toBeTruthy();
    }
  });

  // each important field says so, and screen readers hear it with the box
  it("111-S5 marks each important field, and no ordinary one", () => {
    render(<EventDetailsForm eventId="evt-1" form={form} />);

    expect(screen.getAllByText(IMPORTANT)).toHaveLength(9);
    expect(box("Expected attendance").getAttribute("aria-describedby")).toBe("expectedAttendance-message");
    expect(document.getElementById("expectedAttendance-message")?.textContent).toBe(IMPORTANT);
    expect(box("Event name").getAttribute("aria-describedby")).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// SCRUM-111/AC1, AC3, AC5 saving
// ----------------------------------------------------------------------------

describe("SCRUM-111/AC1, AC3, AC5 saving the form (111-S1, 111-S10, 111-S15)", () => {
  it("111-S1 saves the edited values and goes back to the event, which says they were saved", async () => {
    const fetchMock = mockServer(200, { changes: {}, important: true, message: "Event details saved." });
    render(<EventDetailsForm eventId="evt 1" form={form} />);
    fireEvent.change(box("Event name"), { target: { value: "Tech Summit 2099" } });
    fireEvent.change(box("Expected attendance"), { target: { value: "150" } });

    save();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/evt 1?saved=1"));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt%201");
    expect(options).toMatchObject({ method: "PATCH", credentials: "include" });
    expect(JSON.parse(options.body)).toEqual({ ...form.values, name: "Tech Summit 2099", expectedAttendance: "150" });
  });

  it.each([
    ["Event name", "", "Enter the event name."],
    ["Expected attendance", "0", "Enter the expected attendance as a whole number of 1 or more."],
    ["End time", "08:00", "End time must be after the start time."],
  ])("111-S10 %s set to %j shows the shared message and sends nothing", (label, value, message) => {
    const fetchMock = mockServer(200, {});
    render(<EventDetailsForm eventId="evt-1" form={form} />);
    fireEvent.change(box(label), { target: { value } });

    save();

    expect(screen.getByText(message)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("111-S12 saving with nothing changed says so and sends nothing", () => {
    const fetchMock = mockServer(200, {});
    render(<EventDetailsForm eventId="evt-1" form={form} />);

    save();

    expect(screen.getByRole("alert").textContent).toBe("Nothing was changed.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows event-service's refusal and its field errors, and the button works again", async () => {
    mockServer(422, { code: "VALIDATION_FAILED", error: "Some fields need attention.", fieldErrors: { categoryId: "Choose a category from the list." } });
    render(<EventDetailsForm eventId="evt-1" form={form} />);
    fireEvent.change(box("Purpose"), { target: { value: "Learning" } });

    save();

    expect((await screen.findByRole("alert")).textContent).toBe("Some fields need attention.");
    expect(screen.getByText("Choose a category from the list.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("falls back to a general message when the server gives none", async () => {
    mockServer(500, {});
    render(<EventDetailsForm eventId="evt-1" form={form} />);
    fireEvent.change(box("Purpose"), { target: { value: "Learning" } });

    save();

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't save the event details. Please try again.");
  });
});

describe("SCRUM-111 the edit page (/events/[id]/edit)", () => {
  const open = async () => render(await EditEventPage({ params: Promise.resolve({ id: "evt-1" }) }));

  it("111-S4 shows the form with a way back to the event", async () => {
    getEventEditForm.mockResolvedValue({ form });

    await open();

    expect(getEventEditForm).toHaveBeenCalledWith("evt-1");
    expect(screen.getByRole("heading", { name: "Edit event details" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "← Back to event" }).getAttribute("href")).toBe("/events/evt-1");
  });

  // event-service refuses anyone but the assigned coordinator, and a finished event (111-S16, S17)
  it("111-S16 shows event-service's refusal instead of the form", async () => {
    getEventEditForm.mockResolvedValue({ error: "A completed, cancelled or rejected event can't be edited." });

    await open();

    expect(screen.getByRole("alert").textContent).toBe("A completed, cancelled or rejected event can't be edited.");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// SCRUM-111/AC4 the change history; AC5 the latest details
// ----------------------------------------------------------------------------

describe("SCRUM-111/AC4 the change history on the event page (111-S13)", () => {
  const entries: EventChangeHistoryEntry[] = [
    {
      id: "h-2",
      changedAt: "2099-10-05T03:00:00+00:00",
      changedBy: "Rachel Tan",
      important: true,
      changes: [
        { field: "expected_attendance", label: "Expected attendance", from: 100, to: 120 },
        { field: "preferred_start_datetime", label: "Start", from: "2099-12-12T01:00:00+00:00", to: "2099-12-12T02:00:00+00:00" },
        { field: "description", label: "Description", from: null, to: "Annual summit" },
      ],
    },
    { id: "h-1", changedAt: "2099-10-02T03:00:00+00:00", changedBy: "Rachel Tan", important: false, changes: [{ field: "name", label: "Event name", from: "Summit", to: "Tech Summit" }] },
  ];

  it("111-S13 lists each save, newest first: when, who, Important or not, and each field's old and new value", () => {
    render(<EventChangeHistory entries={entries} />);

    const [newest, oldest] = screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("Rachel Tan"));
    expect(newest.textContent).toContain("Rachel Tan");
    expect(within(newest).getByText("Important")).toBeTruthy();
    expect(newest.textContent).toContain("Expected attendance: 100 → 120");
    expect(newest.textContent).toContain("Description: (none) → Annual summit");
    expect(newest.textContent).toMatch(/Start: 12 Dec 2099, 9:00\s?am → 12 Dec 2099, 10:00\s?am/i);
    expect(within(oldest).queryByText("Important")).toBeNull();
    expect(oldest.textContent).toContain("Event name: Summit → Tech Summit");
  });

  it("111-S13 an event never edited says so", () => {
    render(<EventChangeHistory entries={[]} />);

    expect(screen.getByText("The event's details have not been changed.")).toBeTruthy();
  });

  it("111-S14 shows nothing to someone who may not see it", () => {
    const { container } = render(<EventChangeHistory entries={null} />);

    expect(container.innerHTML).toBe("");
  });

  it("changeValue shows empty values as (none), times in Singapore time, and anything else as it is", () => {
    expect(changeValue("purpose", "")).toBe("(none)");
    expect(changeValue("purpose", undefined)).toBe("(none)");
    expect(changeValue("preferred_end_datetime", "2099-12-12T09:00:00Z")).toMatch(/12 Dec 2099, 5:00\s?pm/i);
    expect(changeValue("expected_attendance", 0)).toBe("0");
  });
});

describe("SCRUM-111/AC5 the event's details (111-S15)", () => {
  it("111-S15 shows the description, category and venue requirements", () => {
    const event = {
      id: "evt-1", name: "Tech Summit", status: "planning", canChangeStatus: true, canReview: false, purpose: null,
      preferred_start_datetime: null, preferred_end_datetime: null, expected_attendance: null, preferred_layout_name: null,
      accessibility_requirements: null, equipment_requirements_notes: null, submitted_at: null, organiser_name: "Jason Chua",
      point_of_contact_name: null, description: "Annual summit", category_name: "Conference", venue_requirements: "Stage and lift",
    } satisfies EventDetailView;

    const { container } = render(<EventRequestDetails event={event} />);

    const value = (label: string) => [...container.querySelectorAll("dt")].find((dt) => dt.textContent === label)?.nextElementSibling?.textContent;
    expect(value("Description")).toBe("Annual summit");
    expect(value("Category")).toBe("Conference");
    expect(value("Venue requirements")).toBe("Stage and lift");
  });
});
// end of SCRUM-111
