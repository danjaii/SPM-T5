// SCRUM-51: where the supporting documents appear. AC1/AC4: on the request form once it is a saved draft (and a nudge before that);
// on the event page the list is read-only unless the viewer is the organiser of a draft.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));
const api = vi.hoisted(() => ({ submit: vi.fn(), save: vi.fn(), update: vi.fn(), submitDraft: vi.fn() }));
vi.mock("@/lib/eventRequests", () => ({
  submitEventRequest: api.submit, saveEventDraft: api.save, updateEventDraft: api.update, submitEventDraft: api.submitDraft,
}));
const docs = vi.hoisted(() => vi.fn());
vi.mock("@/components/event-request/SupportingDocuments", () => ({
  SupportingDocuments: (props: { eventId: string; readOnly?: boolean }) => {
    docs(props);
    return <div data-testid="documents" data-event={props.eventId} data-readonly={String(props.readOnly ?? false)} />;
  },
}));

import { EventRequestForm } from "@/components/event-request/EventRequestForm";
import { EventSupportingDocuments } from "@/components/event-request/EventSupportingDocuments";
import { draftToValues } from "@/lib/eventRequestForm";
import { layouts, stored } from "./draftFixtures";

beforeEach(() => {
  docs.mockClear();
  for (const fn of Object.values(api)) fn.mockReset();
  api.save.mockResolvedValue({ ok: true, data: { id: "new-1" } });
});

describe("SCRUM-51/AC1 the form offers documents once there is a draft to attach them to", () => {
  it("says to save as a draft first on a brand-new form, and shows no upload panel", () => {
    render(<EventRequestForm layouts={layouts} />);
    expect(screen.getByText("Save as draft to attach files.")).toBeTruthy();
    expect(screen.queryByTestId("documents")).toBeNull();
  });

  it("shows the panel for the draft the form was opened from", () => {
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored) }} />);
    expect(screen.getByTestId("documents").getAttribute("data-event")).toBe("draft-1");
    expect(screen.getByTestId("documents").getAttribute("data-readonly")).toBe("false");
    expect(screen.queryByText("Save as draft to attach files.")).toBeNull();
  });

  it("swaps the nudge for the panel as soon as Save as draft has created the draft", async () => {
    render(<EventRequestForm layouts={layouts} />);
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(screen.getByTestId("documents").getAttribute("data-event")).toBe("new-1"));
    expect(screen.queryByText("Save as draft to attach files.")).toBeNull();
  });
});

describe("SCRUM-51/AC4 documents on the event page", () => {
  it("lets the organiser of a draft add and remove", () => {
    render(<EventSupportingDocuments event={{ id: "e1", status: "draft", isOrganiser: true }} />);
    expect(screen.getByTestId("documents").getAttribute("data-readonly")).toBe("false");
  });

  it.each(["submitted", "under_review", "approved", "rejected"])("is read-only once the request is %s", (status) => {
    render(<EventSupportingDocuments event={{ id: "e1", status, isOrganiser: true }} />);
    expect(screen.getByTestId("documents").getAttribute("data-readonly")).toBe("true");
  });

  it("is read-only for anyone but the organiser, even on a draft", () => {
    render(<EventSupportingDocuments event={{ id: "e1", status: "draft", isOrganiser: false }} />);
    expect(screen.getByTestId("documents").getAttribute("data-readonly")).toBe("true");
  });
});
