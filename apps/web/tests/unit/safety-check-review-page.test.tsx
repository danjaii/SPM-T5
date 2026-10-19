// SCRUM-99 — the Safety Officer's review page for one event (/safety-checks/[id])

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-safety" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import SafetyCheckReviewPage from "@/app/safety-checks/[id]/page";
import type { SafetyCheckDetails } from "@/lib/safetyCheckServer";

const details = (over: Partial<SafetyCheckDetails> = {}): SafetyCheckDetails => ({
  id: "evt-1",
  name: "Tech Summit",
  status: "awaiting_arrangements",
  preferred_start_datetime: "2031-06-15T01:00:00Z",
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  expected_attendance: 120,
  layout: "Theatre",
  accessibility_requirements: null,
  venues: [],
  equipment: [],
  decisions: [],
  ...over,
});

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cookieValue.current = "token-safety";
  redirect.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const open = async (id = "evt-1") => render(await SafetyCheckReviewPage({ params: Promise.resolve({ id }) }));

describe("SCRUM-99/AC3 + AC4 review an event", () => {
  it("SCRUM-99/AC3 SCRUM-99/AC4 loads the event's safety information and offers the three outcomes", async () => {
    const fetchMock = mockServer(200, details());

    await open();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4002/safety-checks/evt-1",
      expect.objectContaining({ headers: { cookie: "cs_session=token-safety" }, cache: "no-store" }),
    );
    expect(screen.getByRole("heading", { level: 1, name: "Safety check: Tech Summit" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Expected attendance" }).textContent).toContain("120");
    for (const name of ["Approve", "Reject", "Request changes"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  });

  it.each([
    [403, "Only a Safety Officer can do this."],
    [404, "Event not found."],
  ])("SCRUM-99/AC3 shows event-service's %i refusal and offers no decision", async (status, error) => {
    mockServer(status, { error });

    await open();

    expect(screen.getByRole("alert").textContent).toBe(error);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("SCRUM-99/AC8 shows the recorded decision, and no choices, once the event has been decided", async () => {
    mockServer(200, details({
      decisions: [
        { decision: "rejected", reason: "Fire exit blocked by the stage", officer_name: "Farah Ismail", decided_at: "2031-06-01T02:00:00Z" },
      ],
    }));

    await open();

    const record = screen.getByRole("region", { name: "Safety decision" }).textContent;
    expect(record).toContain("Safety Rejected by Farah Ismail on 2031-06-01 10:00");
    expect(record).toContain("Fire exit blocked by the stage");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});

describe("SCRUM-100/AC6 repeat the safety check", () => {
  it("SCRUM-100/AC6 offers the three outcomes again once the coordinator returns the event, beside the earlier request", async () => {
    mockServer(200, details({
      status: "awaiting_arrangements",
      decisions: [
        { decision: "changes_requested", reason: "Move the stage clear of fire exit B", officer_name: "Farah Ismail", decided_at: "2031-06-01T02:00:00Z" },
      ],
    }));

    await open();

    for (const name of ["Approve", "Reject", "Request changes"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Safety decision" }).textContent).toContain("Move the stage clear of fire exit B");
  });

  it("SCRUM-100/AC6 offers no choices while the coordinator is still making the changes (Planning)", async () => {
    mockServer(200, details({
      status: "planning",
      decisions: [
        { decision: "changes_requested", reason: "Move the stage clear of fire exit B", officer_name: "Farah Ismail", decided_at: "2031-06-01T02:00:00Z" },
      ],
    }));

    await open();

    expect(screen.getByRole("region", { name: "Safety decision" }).textContent).toContain("Move the stage clear of fire exit B");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});

describe("SCRUM-100/AC9 repeat the safety check after an important change", () => {
  const revokedApproval = {
    decision: "approved",
    reason: null,
    officer_name: "Farah Ismail",
    decided_at: "2031-06-01T02:00:00Z",
    revoked_at: "2031-06-03T02:00:00Z",
  };

  it("SCRUM-100/AC9 offers the three outcomes again once the approval no longer applies", async () => {
    mockServer(200, details({ status: "awaiting_arrangements", decisions: [revokedApproval] }));

    await open();

    for (const name of ["Approve", "Reject", "Request changes"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  });

  it("SCRUM-100/AC9 marks the earlier approval as no longer applying, and when", async () => {
    mockServer(200, details({ status: "awaiting_arrangements", decisions: [revokedApproval] }));

    await open();

    const record = screen.getByRole("region", { name: "Safety decision" }).textContent;
    expect(record).toContain("Safety Approved by Farah Ismail on 2031-06-01 10:00");
    expect(record).toContain("No longer applies: an important change was made on 2031-06-03 10:00.");
  });
});
