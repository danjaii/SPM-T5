// SCRUM-124/AC1: Save as draft creates or updates the right draft, with what was typed, and says so honestly when it fails

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const api = vi.hoisted(() => ({ submit: vi.fn(), save: vi.fn(), update: vi.fn(), submitDraft: vi.fn() }));
vi.mock("@/lib/eventRequests", () => ({
  submitEventRequest: api.submit, saveEventDraft: api.save, updateEventDraft: api.update, submitEventDraft: api.submitDraft,
}));

import { EventRequestForm } from "@/components/event-request/EventRequestForm";
import { draftToValues } from "@/lib/eventRequestForm";
import { click, layouts, stored, type } from "./draftFixtures";

beforeEach(() => { for (const fn of Object.values(api)) fn.mockReset(); });

describe("SCRUM-124/AC1 which draft Save as draft writes", () => {
  it("SCRUM-124/AC1 creates a new draft with what was typed, and the next save updates that draft instead of creating another", async () => {
    api.save.mockResolvedValue({ ok: true, data: { id: "new-1", updated_at: "2026-10-30T06:00:00Z" } });
    api.update.mockResolvedValue({ ok: true, data: { id: "new-1", updated_at: "2026-10-30T06:05:00Z" } });
    render(<EventRequestForm layouts={layouts} />);

    type(/Event name/, "Summit");
    click("Save as draft");
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Draft saved/));
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save.mock.calls[0][0]).toMatchObject({ name: "Summit" });

    type(/Event name/, "Summit 2");
    click("Save as draft");
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0][0]).toBe("new-1");
    expect(api.update.mock.calls[0][1]).toMatchObject({ name: "Summit 2" });
    expect(api.save).toHaveBeenCalledTimes(1);
  });

  it("SCRUM-124/AC1 saves a form with only a name: the missing required answers do not block a draft", async () => {
    api.save.mockResolvedValue({ ok: true, data: { id: "new-1", updated_at: "2026-10-30T06:00:00Z" } });
    render(<EventRequestForm layouts={layouts} />);

    type(/Event name/, "Only a name");
    click("Save as draft");

    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save.mock.calls[0][0]).toMatchObject({ name: "Only a name" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("SCRUM-124/AC1 shows the reason, and no confirmation, when the save fails", async () => {
    api.update.mockResolvedValue({ ok: false, data: { error: "Could not save right now." } });
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored) }} />);

    click("Save as draft");

    expect((await screen.findByRole("alert")).textContent).toContain("Could not save right now.");
    expect(screen.queryByText(/Draft saved/)).toBeNull();
  });

  it("SCRUM-124/AC1 falls back to a plain message when the failure has no reason", async () => {
    api.update.mockResolvedValue({ ok: false, data: {} });
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored) }} />);
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    expect((await screen.findByRole("alert")).textContent).toContain("We couldn't save the draft");
  });

  it("SCRUM-124/AC1 shows the reason, and no confirmation, when creating a new draft fails, and the button works again", async () => {
    api.save.mockResolvedValue({ ok: false, data: { error: "Could not create the draft." } });
    render(<EventRequestForm layouts={layouts} />);
    type(/Event name/, "Tech Summit");

    click("Save as draft");

    expect((await screen.findByRole("alert")).textContent).toContain("Could not create the draft.");
    expect(screen.queryByText(/Draft saved/)).toBeNull();
    expect((screen.getByRole("button", { name: "Save as draft" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
