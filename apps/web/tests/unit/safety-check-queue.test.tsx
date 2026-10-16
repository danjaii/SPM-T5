// SCRUM-99 — the Safety Officer's list of events waiting for an Operational Safety Check

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

import SafetyCheckQueuePage from "@/app/safety-checks/page";
import { SafetyCheckQueue } from "@/components/SafetyCheckQueue";
import type { SafetyQueueItem } from "@/lib/safetyCheckServer";

const item = (over: Partial<SafetyQueueItem> = {}): SafetyQueueItem => ({
  id: "evt-1",
  name: "Tech Summit",
  preferred_start_datetime: "2031-06-15T01:00:00Z", // 9:00 AM in Singapore
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  expected_attendance: 120,
  venue_names: ["Riverside Hall", "Orchid Room"],
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

describe("SCRUM-99/AC2 view events waiting for review", () => {
  it("SCRUM-99/AC2 lists each waiting event with a link to its safety check", () => {
    render(<SafetyCheckQueue events={[item(), item({ id: "evt-2", name: "Expo" })]} />);

    expect(screen.getByRole("link", { name: "Review Tech Summit" }).getAttribute("href")).toBe("/safety-checks/evt-1");
    expect(screen.getByRole("link", { name: "Review Expo" }).getAttribute("href")).toBe("/safety-checks/evt-2");
    expect(screen.getAllByText("Riverside Hall, Orchid Room")).toHaveLength(2);
    expect(screen.getAllByText("120")).toHaveLength(2);
  });

  it("SCRUM-99/AC2 says so when no events are waiting for a safety check", () => {
    render(<SafetyCheckQueue events={[]} />);

    expect(screen.getByText("No events are waiting for a safety check.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("SCRUM-99/AC2 loads the waiting events from event-service as the signed-in Safety Officer", async () => {
    const fetchMock = mockServer(200, [item()]);

    render(await SafetyCheckQueuePage());

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4002/safety-checks",
      expect.objectContaining({ headers: { cookie: "cs_session=token-safety" }, cache: "no-store" }),
    );
    expect(screen.getByRole("heading", { name: "Events waiting for a safety check" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review Tech Summit" })).toBeTruthy();
  });

  it("SCRUM-99/AC2 shows the refusal, and no events, when event-service denies access", async () => {
    mockServer(403, { error: "Only a Safety Officer can do this." });

    render(await SafetyCheckQueuePage());

    expect(screen.getByRole("alert").textContent).toBe("Only a Safety Officer can do this.");
    expect(screen.queryByRole("table")).toBeNull();
  });
});
