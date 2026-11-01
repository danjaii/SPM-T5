import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));
const api = vi.hoisted(() => ({ submit: vi.fn(), save: vi.fn(), update: vi.fn(), submitDraft: vi.fn() }));
vi.mock("@/lib/eventRequests", () => ({
  submitEventRequest: api.submit, saveEventDraft: api.save, updateEventDraft: api.update, submitEventDraft: api.submitDraft,
}));

import { EventRequestForm } from "@/components/event-request/EventRequestForm";
import { draftToValues, toDraftBody } from "@/lib/eventRequestForm";
import { click, layouts, stored, type } from "./draftFixtures";

beforeEach(() => {
  nav.push.mockClear();
  for (const fn of Object.values(api)) fn.mockReset();
  api.save.mockResolvedValue({ ok: true, data: { id: "new-1" } });
  api.update.mockResolvedValue({ ok: true, data: { id: "draft-1" } });
  api.submitDraft.mockResolvedValue({ ok: true, data: { id: "draft-1" } });
});

describe("SCRUM-54/AC2 Save as draft updates the draft being edited", () => {
  it("sends the whole form to that draft, not a new one", async () => {
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored) }} />);
    type(/Event name/, "Tech Summit 2027");
    click("Save as draft");
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    const [id, body] = api.update.mock.calls[0];
    expect(id).toBe("draft-1");
    expect(body).toEqual({ ...toDraftBody(draftToValues(stored)), name: "Tech Summit 2027" });
    expect(api.save).not.toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toMatch(/Draft saved/);
  });

  it("sends a cleared box as empty, so it is cleared in the draft too", async () => {
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored) }} />);
    type(/Event name/, "");
    click("Save as draft");
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0][1]).not.toHaveProperty("name");
    expect(api.update.mock.calls[0][1]).toHaveProperty("purpose", "Showcase");
  });

  it("a form started from scratch creates the draft once and then keeps updating that same one", async () => {
    render(<EventRequestForm layouts={layouts} />);
    type(/Event name/, "First");
    click("Save as draft");
    await screen.findByRole("status");
    type(/Event name/, "Second");
    click("Save as draft");
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.update.mock.calls[0][0]).toBe("new-1");
    expect(api.update.mock.calls[0][1]).toMatchObject({ name: "Second" });
  });

  it("says why when the draft cannot be saved any more", async () => {
    api.update.mockResolvedValueOnce({ ok: false, data: { code: "NOT_A_DRAFT", error: "This request has been submitted and can no longer be edited as a draft." } });
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored) }} />);
    click("Save as draft");
    expect((await screen.findByRole("alert")).textContent).toMatch(/can no longer be edited/);
  });
});

