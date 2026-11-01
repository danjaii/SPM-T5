import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));
const api = vi.hoisted(() => ({ submit: vi.fn(), save: vi.fn(), update: vi.fn(), submitDraft: vi.fn() }));
vi.mock("@/lib/eventRequests", () => ({
  submitEventRequest: api.submit, saveEventDraft: api.save, updateEventDraft: api.update, submitEventDraft: api.submitDraft,
}));

import { EventRequestForm } from "@/components/event-request/EventRequestForm";
import { draftToValues, toRequestBody } from "@/lib/eventRequestForm";
import { click, layouts, stored, toReview } from "./draftFixtures";

beforeEach(() => {
  nav.push.mockClear();
  for (const fn of Object.values(api)) fn.mockReset();
  api.save.mockResolvedValue({ ok: true, data: { id: "new-1" } });
  api.update.mockResolvedValue({ ok: true, data: { id: "draft-1" } });
  api.submitDraft.mockResolvedValue({ ok: true, data: { id: "draft-1" } });
});

describe("SCRUM-54/AC3 Submit works from the draft", () => {
  it("submits the draft that is open, with the whole form, and lands on the event page", async () => {
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored) }} />);
    toReview();
    click("Submit request");
    await waitFor(() => expect(api.submitDraft).toHaveBeenCalledTimes(1));
    expect(api.submitDraft.mock.calls[0][0]).toBe("draft-1");
    expect(api.submitDraft.mock.calls[0][1]).toEqual(toRequestBody(draftToValues(stored)));
    expect(api.submit).not.toHaveBeenCalled();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/events/draft-1?submitted=1"));
  });

  it("keeps the draft and shows the server's field errors when submission is refused", async () => {
    api.submitDraft.mockResolvedValueOnce({ ok: false, data: { error: "Check the highlighted fields.", fieldErrors: { name: "Enter the event name." } } });
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored) }} />);
    toReview();
    click("Submit request");
    expect(await screen.findByText("Enter the event name.")).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByText(/Step 1 of 6/)).toBeTruthy();
  });
});
