import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));
const api = vi.hoisted(() => ({ submit: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/eventRequests", () => ({ submitEventRequest: api.submit, saveEventDraft: api.save }));

import { EventRequestForm } from "@/components/event-request/EventRequestForm";
import { EMPTY_VALUES, toDraftBody } from "@/lib/eventRequestForm";

const layouts = [{ id: "a685c8bf-c57d-5cb4-be30-49dedce9a02b", name: "Theatre" }];
const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const saveDraft = () => fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

beforeEach(() => {
  nav.push.mockClear();
  api.submit.mockReset();
  api.save.mockReset();
  api.save.mockResolvedValue({ ok: true, data: { id: "d1", updated_at: "2026-10-29T06:00:00.000Z" } });
});

describe("SCRUM-53/AC1 Save as draft button", () => {
  it("is on the first step and works with every field empty, without asking for anything", async () => {
    render(<EventRequestForm layouts={layouts} />);
    saveDraft();
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Enter the event name.")).toBeNull();
    expect(screen.getByText(/Step 1 of 6/)).toBeTruthy();
    expect(api.submit).not.toHaveBeenCalled();
  });

  it("sends what has been typed so far and tells the organiser the draft is saved", async () => {
    render(<EventRequestForm layouts={layouts} />);
    type(/Event name/, "Half-planned summit");
    saveDraft();
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect(api.save.mock.calls[0][0]).toMatchObject({ name: "Half-planned summit" });
    expect((await screen.findByRole("status")).textContent).toMatch(/Draft saved/);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("is available on a later step and on the Review step", async () => {
    render(<EventRequestForm layouts={layouts} />);
    type(/Event name/, "A");
    type(/^Purpose/, "B");
    type(/^Description/, "C");
    fireEvent.click(screen.getByRole("button", { name: /^Continue to/ }));
    expect(screen.getByRole("button", { name: "Save as draft" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Review & submit/ }));
    expect(screen.getByRole("button", { name: "Save as draft" })).toBeTruthy();
  });

  it("shows the server's message and lets the organiser try again when the save fails", async () => {
    api.save.mockResolvedValueOnce({ ok: false, data: { error: "Check the highlighted fields.", fieldErrors: { expected_attendance: "Enter a whole number, 0 or more." } } });
    render(<EventRequestForm layouts={layouts} />);
    saveDraft();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Check the highlighted fields/);
    expect(screen.queryByText(/Draft saved/)).toBeNull();
    const button = screen.getByRole("button", { name: "Save as draft" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("is disabled while the save is in flight, so a double click saves once", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<EventRequestForm layouts={layouts} />);
    saveDraft();
    const saving = screen.getByRole("button", { name: /Saving/ }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    fireEvent.click(saving);
    expect(api.save).toHaveBeenCalledTimes(1);
    finish({ ok: true, data: { id: "d1" } });
    await screen.findByRole("status");
  });
});

describe("SCRUM-53/AC1 toDraftBody", () => {
  it("leaves an untouched form entirely empty, including the accessibility answer", () => {
    expect(toDraftBody(EMPTY_VALUES)).toEqual({ registration_required: undefined, accessibility_requirements: undefined });
  });

  it("keeps what was filled in, as the API takes it", () => {
    const body = toDraftBody({ ...EMPTY_VALUES, name: "X", attendance: "40", start: "2026-12-01T09:00", accessibility: ["Hearing loop"], registrationRequired: "yes", registrationCapacity: "10" });
    expect(body).toMatchObject({
      name: "X", expected_attendance: 40, preferred_start_datetime: "2026-12-01T01:00:00.000Z",
      accessibility_requirements: "Hearing loop", registration_required: true, registration_capacity: 10,
    });
  });
});
