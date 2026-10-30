import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));
const api = vi.hoisted(() => ({ submit: vi.fn(), save: vi.fn(), update: vi.fn(), submitDraft: vi.fn() }));
vi.mock("@/lib/eventRequests", () => ({
  submitEventRequest: api.submit, saveEventDraft: api.save, updateEventDraft: api.update, submitEventDraft: api.submitDraft,
}));

import { EventRequestForm } from "@/components/event-request/EventRequestForm";
import { EMPTY_VALUES, draftToValues, toDraftBody } from "@/lib/eventRequestForm";
import { LAYOUT, layouts, stored, toReview } from "./draftFixtures";

beforeEach(() => {
  nav.push.mockClear();
  for (const fn of Object.values(api)) fn.mockReset();
  api.save.mockResolvedValue({ ok: true, data: { id: "new-1" } });
  api.update.mockResolvedValue({ ok: true, data: { id: "draft-1" } });
  api.submitDraft.mockResolvedValue({ ok: true, data: { id: "draft-1" } });
});

describe("SCRUM-54/AC1 a saved draft opens pre-filled", () => {
  it("turns every stored field back into a form value, so saving it again changes nothing", () => {
    const values = draftToValues(stored);
    expect(values).toMatchObject({
      name: "Tech Summit", attendance: "250", layoutId: LAYOUT, venueRequirements: "Near an MRT", equipment: "Two mics",
      accessibility: ["Hearing loop", "Quiet room"], accessibilityNotes: "Seat near the exit",
      registrationRequired: "yes", registrationCapacity: "100",
    });
    const { id, status, organiser_id, updated_at, ...fields } = stored;
    void id; void status; void organiser_id; void updated_at;
    expect(toDraftBody(values)).toEqual(fields);
  });

  it("shows empty boxes for what was never filled in, not the placeholder name or a guessed answer", () => {
    const values = draftToValues({
      ...Object.fromEntries(Object.keys(stored).map((k) => [k, null])), id: "d", status: "draft", name: "Untitled draft", registration_required: false,
    } as never);
    expect(values).toEqual(EMPTY_VALUES);
  });

  it("opens the form with the boxes filled in, on the first step", () => {
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored) }} />);
    expect((screen.getByLabelText(/Event name/) as HTMLInputElement).value).toBe("Tech Summit");
    expect((screen.getByLabelText(/^Purpose/) as HTMLInputElement).value).toBe("Showcase");
    expect(screen.getByText(/Step 1 of 6/)).toBeTruthy();
  });

  it("keeps the stored values through the Review step", () => {
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored) }} />);
    toReview();
    expect(screen.getByText("Tech Summit")).toBeTruthy();
    expect(screen.getByText("Theatre")).toBeTruthy();
  });
});

