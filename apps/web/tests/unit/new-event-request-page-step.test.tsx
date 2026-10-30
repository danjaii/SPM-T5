// SCRUM-124/AC3: the new request page tells the form which step a reopened draft resumes at

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const srv = vi.hoisted(() => ({ options: vi.fn(), draft: vi.fn() }));
vi.mock("@/lib/eventRequestsServer", () => ({ getRequestOptions: srv.options, getDraftForEdit: srv.draft }));
const form = vi.hoisted(() => vi.fn());
vi.mock("@/components/event-request/EventRequestForm", () => ({
  EventRequestForm: (props: unknown) => { form(props); return <div />; },
}));

import NewEventRequestPage from "@/app/events/new/page";
import { stored } from "./draftFixtures";

const open = async (draft?: string) => render(await NewEventRequestPage({ searchParams: Promise.resolve({ draft }) }));

beforeEach(() => {
  form.mockReset();
  srv.options.mockReset().mockResolvedValue({ roomLayouts: [{ id: "l1", name: "Theatre" }] });
  srv.draft.mockReset();
});

describe("SCRUM-124/AC3 the page resumes a draft at its last edited step", () => {
  it("gives the form the step of the last thing filled in", async () => {
    srv.draft.mockResolvedValue({ draft: { ...stored, registration_required: null, registration_capacity: null, registration_opens_at: null, registration_closes_at: null } });
    await open("draft-1");
    expect((form.mock.calls[0][0] as { draft: { step: number } }).draft.step).toBe(3); // equipment is the last filled step
  });

  it("starts a draft with nothing filled in at the first step", async () => {
    const blank = Object.fromEntries(Object.keys(stored).map((k) => [k, null]));
    srv.draft.mockResolvedValue({ draft: { ...blank, id: "d2", status: "draft", name: "Untitled draft" } });
    await open("d2");
    expect((form.mock.calls[0][0] as { draft: { step: number } }).draft.step).toBe(0);
  });

  it("passes no draft, so no step, for a new form", async () => {
    await open();
    expect((form.mock.calls[0][0] as { draft?: unknown }).draft).toBeUndefined();
  });
});
