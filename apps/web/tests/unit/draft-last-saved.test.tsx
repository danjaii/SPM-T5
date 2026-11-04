// SCRUM-53/AC3: the organiser can see when a draft was last saved: on the event page, in My event requests and in the save confirmation

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));
const api = vi.hoisted(() => ({ submit: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/eventRequests", () => ({ submitEventRequest: api.submit, saveEventDraft: api.save }));

import { EventRequestDetails } from "@/components/EventRequestDetails";
import { EventRequestForm } from "@/components/event-request/EventRequestForm";
import { MyEventRequestsTable } from "@/components/MyEventRequestsTable";
import type { EventDetailView } from "@/lib/events";
import { formatLastSaved } from "@/lib/formatLastSaved";

const SAVED_AT = "2031-03-04T05:06:07.000Z"; // 1:06 pm in Singapore
const SAVED_TEXT = "4 Mar 2031, 1:06 pm";

const DRAFT: EventDetailView = {
  id: "evt-1",
  name: "SMUX Council Meeting",
  status: "draft",
  canChangeStatus: false,
  canReview: false,
  purpose: null,
  preferred_start_datetime: null,
  preferred_end_datetime: null,
  expected_attendance: null,
  preferred_layout_name: null,
  accessibility_requirements: null,
  equipment_requirements_notes: null,
  submitted_at: null,
  updated_at: SAVED_AT,
  organiser_name: "Jason Chua",
  point_of_contact_name: null,
  description: "Meeting of the 6 SMUX Clubs",
};

/** The <dd> shown under a given <dt> label. */
const valueOf = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;

describe("SCRUM-53/AC3 formatLastSaved", () => {
  it("shows the Singapore date and time, in the format of the Submitted row", () => {
    expect(formatLastSaved(SAVED_AT)).toBe(SAVED_TEXT);
  });

  it("uses the Singapore date, which can be the next day in UTC", () => {
    expect(formatLastSaved("2031-03-04T17:30:00.000Z")).toBe("5 Mar 2031, 1:30 am");
  });
});

describe("SCRUM-53/AC3 Request details shows when a draft was last saved", () => {
  it("shows Last saved with the date and time, and leaves Submitted as Not provided", () => {
    render(<EventRequestDetails event={DRAFT} />);

    expect(valueOf("Last saved").textContent).toBe(SAVED_TEXT);
    expect(valueOf("Submitted").textContent).toBe("Not provided");
  });

  it("shows no Last saved row once the request is submitted", () => {
    render(<EventRequestDetails event={{ ...DRAFT, status: "submitted", submitted_at: "2031-03-05T02:00:00.000Z" }} />);

    expect(screen.queryByText("Last saved", { selector: "dt" })).toBeNull();
    expect(valueOf("Submitted").textContent).toBe("5 Mar 2031, 10:00 am");
  });

  it("says Not provided, not an invalid date, when the time is missing", () => {
    render(<EventRequestDetails event={{ ...DRAFT, updated_at: undefined }} />);

    expect(valueOf("Last saved").textContent).toBe("Not provided");
  });
});

describe("SCRUM-53/AC3 My event requests shows when each draft was last saved", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "evt-1", name: "SMUX Council Meeting", status: "draft", preferred_start_datetime: null, expected_attendance: null,
    submitted_at: null, updated_at: SAVED_AT, ...over,
  });

  it("shows Last saved with the date and time in a draft's Submitted column", () => {
    render(<MyEventRequestsTable requests={[row({})]} />);

    const draftRow = screen.getByRole("row", { name: /SMUX Council Meeting/ });
    expect(within(draftRow).getByText(`Last saved ${SAVED_TEXT}`)).toBeTruthy();
  });

  it("keeps a submitted request's date, with no Last saved", () => {
    render(<MyEventRequestsTable requests={[row({ id: "evt-2", name: "Career Fair", status: "submitted", submitted_at: "2031-03-05T02:00:00.000Z" })]} />);

    const submittedRow = screen.getByRole("row", { name: /Career Fair/ });
    expect(submittedRow.textContent).toMatch(/5 Mar 2031/);
    expect(submittedRow.textContent).not.toMatch(/Last saved/);
  });

  it("shows each draft's own time", () => {
    render(<MyEventRequestsTable requests={[row({}), row({ id: "evt-3", name: "Quiz night", updated_at: "2031-03-08T01:00:00.000Z" })]} />);

    expect(within(screen.getByRole("row", { name: /SMUX Council Meeting/ })).getByText(`Last saved ${SAVED_TEXT}`)).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /Quiz night/ })).getByText("Last saved 8 Mar 2031, 9:00 am")).toBeTruthy();
  });

  it("shows a dash for a draft with no time", () => {
    render(<MyEventRequestsTable requests={[row({ updated_at: undefined })]} />);

    expect(screen.getByRole("row", { name: /SMUX Council Meeting/ }).textContent).not.toMatch(/Last saved/);
  });
});

describe("SCRUM-53/AC3 the Draft saved confirmation shows the time", () => {
  beforeEach(() => {
    api.save.mockReset();
    api.submit.mockReset();
  });

  it("says when the draft was saved, using the time the server returned", async () => {
    api.save.mockResolvedValue({ ok: true, data: { id: "d1", updated_at: SAVED_AT } });
    render(<EventRequestForm layouts={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain(`Draft saved. Last saved ${SAVED_TEXT}.`));
    expect(screen.getByRole("status").textContent).toContain("You can find it in My event requests.");
  });

  it("still confirms the save when the server sends no time", async () => {
    api.save.mockResolvedValue({ ok: true, data: { id: "d1" } });
    render(<EventRequestForm layouts={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

    expect((await screen.findByRole("status")).textContent).toBe("Draft saved. You can find it in My event requests.");
  });
});
