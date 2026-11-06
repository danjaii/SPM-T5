// SCRUM-55/AC3: the filter works on the real My event requests page, not only on the list component

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMyEventRequests } = vi.hoisted(() => ({ getMyEventRequests: vi.fn() }));
vi.mock("@/lib/myEventRequestsServer", () => ({ getMyEventRequests }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));

import MyEventRequestsPage from "@/app/my-event-requests/page";

const make = (id: string, name: string, status: string) => ({
  id, name, status, preferred_start_datetime: null, expected_attendance: null, submitted_at: status === "draft" ? null : "2026-10-01T02:00:00Z",
});

beforeEach(() => getMyEventRequests.mockReset());

describe("SCRUM-55/AC3 the filter on the page", () => {
  it("SCRUM-55/AC3 choosing Draft on the page leaves only the draft, and All brings the submitted request back", async () => {
    getMyEventRequests.mockResolvedValue({ requests: [make("1", "Alpha", "draft"), make("2", "Beta", "submitted")] });
    render(await MyEventRequestsPage());

    fireEvent.click(screen.getByRole("button", { name: /^Draft 1$/ }));
    expect(screen.getByRole("row", { name: /Alpha/ })).toBeTruthy();
    expect(screen.queryByRole("row", { name: /Beta/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^All 2$/ }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3); // header + 2
  });

  it("SCRUM-55/AC1 shows a different badge for a draft and a submitted request in the same list", async () => {
    getMyEventRequests.mockResolvedValue({ requests: [make("1", "Alpha", "draft"), make("2", "Beta", "submitted")] });
    render(await MyEventRequestsPage());

    const draft = within(screen.getByRole("row", { name: /Alpha/ })).getByText("Draft");
    const submitted = within(screen.getByRole("row", { name: /Beta/ })).getByText("Submitted");
    expect(draft.closest("[data-slot], span")?.innerHTML).not.toBe(submitted.closest("[data-slot], span")?.innerHTML);
    expect(draft.textContent).not.toBe(submitted.textContent);
  });
});
