// SCRUM-124: the Figma 02 and 03 details that belong to drafts: "Continue editing" on a draft row, and a Draft badge on the form

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ submit: vi.fn(), save: vi.fn(), update: vi.fn(), submitDraft: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/eventRequests", () => ({
  submitEventRequest: api.submit, saveEventDraft: api.save, updateEventDraft: api.update, submitEventDraft: api.submitDraft,
}));

import { EventRequestForm } from "@/components/event-request/EventRequestForm";
import { MyEventRequestsTable } from "@/components/MyEventRequestsTable";
import { draftToValues } from "@/lib/eventRequestForm";
import { layouts, stored } from "./draftFixtures";

const row = (id: string, name: string, status: string) => ({
  id, name, status, preferred_start_datetime: null, expected_attendance: null, submitted_at: null, updated_at: "2026-10-30T02:00:00Z",
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.save.mockResolvedValue({ ok: true, data: { id: "new-1", updated_at: "2026-10-30T06:00:00Z" } });
});

describe("SCRUM-124/AC2 draft rows follow Figma frame 02", () => {
  it("SCRUM-124/AC2 a draft row shows Continue editing and the row opens the draft; a submitted row has none", () => {
    render(<MyEventRequestsTable requests={[row("d1", "Alpha", "draft"), row("s1", "Beta", "submitted")]} />);

    const draft = screen.getByRole("row", { name: /Alpha/ });
    expect(within(draft).getByTestId("continue-editing").textContent).toContain("Continue editing");
    // the cue sits in a row that opens the draft, and the name stays the one link to it
    expect(within(draft).getByRole("link", { name: "Alpha" }).getAttribute("href")).toBe("/events/new?draft=d1");
    expect(within(draft).getAllByRole("link")).toHaveLength(1);
    expect(within(screen.getByRole("row", { name: /Beta/ })).queryByTestId("continue-editing")).toBeNull();
  });
});

describe("SCRUM-124/AC1 the form says it is a draft (Figma frame 03)", () => {
  it("SCRUM-124/AC1 shows a Draft badge on a reopened draft", () => {
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored) }} />);
    expect(screen.getByTestId("draft-badge").textContent).toContain("Draft");
  });

  it("SCRUM-124/AC1 shows no badge on a new request until Save as draft has made one", async () => {
    render(<EventRequestForm layouts={layouts} />);
    expect(screen.queryByTestId("draft-badge")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

    await waitFor(() => expect(screen.getByTestId("draft-badge")).toBeTruthy());
  });
});
