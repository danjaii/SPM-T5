// SCRUM-124: Save draft is on every step with a confirmation (AC1); an opened draft resumes at the last step that has something in it (AC3)

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));
const api = vi.hoisted(() => ({ submit: vi.fn(), save: vi.fn(), update: vi.fn(), submitDraft: vi.fn() }));
vi.mock("@/lib/eventRequests", () => ({
  submitEventRequest: api.submit, saveEventDraft: api.save, updateEventDraft: api.update, submitEventDraft: api.submitDraft,
}));

import { EventRequestForm } from "@/components/event-request/EventRequestForm";
import { EMPTY_VALUES, STEPS, draftToValues, lastEditedStep } from "@/lib/eventRequestForm";
import { click, layouts, stored, toReview } from "./draftFixtures";

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.save.mockResolvedValue({ ok: true, data: { id: "new-1", updated_at: "2026-10-30T06:00:00Z" } });
});

describe("SCRUM-124/AC1 Save draft on every step", () => {
  it("offers Save as draft on all six steps and confirms the save on each", async () => {
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored) }} />);
    api.update.mockResolvedValue({ ok: true, data: { id: "draft-1", updated_at: "2026-10-30T06:00:00Z" } });
    for (let step = 0; step < STEPS.length; step++) {
      expect(screen.getByText(new RegExp(`Step ${step + 1} of 6`))).toBeTruthy();
      click("Save as draft");
      await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Draft saved/));
      if (step < STEPS.length - 1) click(/^Continue to/);
    }
    expect(api.update).toHaveBeenCalledTimes(STEPS.length);
  });
});

describe("SCRUM-124/AC3 an opened draft resumes at the last step edited", () => {
  const withValues = (patch: Partial<typeof EMPTY_VALUES>) => ({ ...EMPTY_VALUES, ...patch });

  it("is the first step for a draft with nothing in it", () => {
    expect(lastEditedStep(EMPTY_VALUES)).toBe(0);
  });

  it.each([
    ["the basics", { name: "Summit" }, 0],
    ["date and attendance", { name: "Summit", attendance: "50" }, 1],
    ["venue needs: requirements", { venueRequirements: "A stage" }, 2],
    ["venue needs: a layout", { layoutId: "x" }, 2],
    ["venue needs: an accessibility tick", { accessibility: ["Hearing loop"] }, 2],
    ["equipment", { equipment: "Two mics" }, 3],
    ["registration", { registrationRequired: "no" as const }, 4],
    ["purpose", { purpose: "Showcase" }, 0],
    ["description", { description: "A day" }, 0],
    ["start", { start: "2031-05-01T09:00" }, 1],
    ["end", { end: "2031-05-01T17:00" }, 1],
    ["accessibility notes", { accessibilityNotes: "Seat near the exit" }, 2],
    ["registration capacity", { registrationCapacity: "50" }, 4],
    ["registration opens", { registrationOpens: "2031-04-01T09:00" }, 4],
    ["registration closes", { registrationCloses: "2031-04-20T09:00" }, 4],
    ["basics and equipment, nothing between", { name: "Summit", equipment: "Two mics" }, 3],
    ["every step", { name: "Summit", attendance: "5", venueRequirements: "x", equipment: "y", registrationRequired: "yes" as const }, 4],
  ])("is the step of the last thing filled in: %s", (_label, patch, expected) => {
    expect(lastEditedStep(withValues(patch))).toBe(expected);
  });

  it("is the last step with anything in it, even when an earlier step is empty", () => {
    expect(lastEditedStep(withValues({ equipment: "Two mics" }))).toBe(3);
  });

  it("never lands on the Review step", () => {
    expect(lastEditedStep(draftToValues(stored))).toBe(4);
  });

  it("opens the form on that step when the page passes it", () => {
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored), step: 3 }} />);
    expect(screen.getByText(/Step 4 of 6/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Equipment" })).toBeTruthy();
  });

  it("shows what was saved on the step it resumes at", () => {
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored), step: 3 }} />);
    expect((screen.getByLabelText(/Equipment/) as HTMLTextAreaElement).value).toBe("Two mics");
  });

  it("stays on the resumed step, with what is typed there, after Save as draft", async () => {
    api.update.mockResolvedValue({ ok: true, data: { id: "draft-1", updated_at: "2026-10-30T06:00:00Z" } });
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored), step: 3 }} />);
    click("Save as draft");
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Draft saved/));
    expect(screen.getByText(/Step 4 of 6/)).toBeTruthy();
    expect((screen.getByLabelText(/Equipment/) as HTMLTextAreaElement).value).toBe("Two mics");
  });

  it("still lets the organiser go back to the earlier steps, with what was saved filled in", () => {
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored), step: 3 }} />);
    click("Back"); click("Back"); click("Back");
    expect((screen.getByLabelText(/Event name/) as HTMLInputElement).value).toBe("Tech Summit");
  });

  it("starts at the first step for a new form and for a draft the page gave no step", () => {
    const { unmount } = render(<EventRequestForm layouts={layouts} />);
    expect(screen.getByText(/Step 1 of 6/)).toBeTruthy();
    unmount();
    render(<EventRequestForm layouts={layouts} draft={{ id: "draft-1", values: draftToValues(stored) }} />);
    expect(screen.getByText(/Step 1 of 6/)).toBeTruthy();
  });
});
