// SCRUM-55: the My event requests list shows each request's status (AC1), sets drafts apart (AC2) and filters by status (AC3)

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { MyEventRequestsTable } from "@/components/MyEventRequestsTable";
import { MyEventRequestsList } from "@/components/MyEventRequestsList";
import type { MyEventRequest } from "@/lib/myEventRequests";

const make = (id: string, name: string, status: string, over: Partial<MyEventRequest> = {}): MyEventRequest => ({
  id,
  name,
  status,
  preferred_start_datetime: "2026-11-20T01:00:00Z",
  expected_attendance: 100,
  submitted_at: status === "draft" ? null : "2026-10-01T02:00:00Z",
  ...over,
});

describe("SCRUM-55/AC1 each request shows its status clearly", () => {
  it("SCRUM-55/AC1 shows every request's status as a labelled badge with an icon, so it is never colour alone", () => {
    render(<MyEventRequestsTable requests={[make("1", "Alpha", "draft"), make("2", "Beta", "submitted"), make("3", "Gamma", "returned")]} />);

    for (const [name, label] of [["Alpha", "Draft"], ["Beta", "Submitted"], ["Gamma", "Returned"]]) {
      const row = screen.getByRole("row", { name: new RegExp(name) });
      expect(within(row).getByText(label)).toBeTruthy();
      expect(within(row).getByTestId("status-icon")).toBeTruthy();
    }
  });

  it("SCRUM-55/AC1 has a Status column heading", () => {
    render(<MyEventRequestsTable requests={[make("1", "Alpha", "draft")]} />);
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeTruthy();
  });

  it("SCRUM-55/AC1 still shows a status it does not know, by its raw value", () => {
    render(<MyEventRequestsTable requests={[make("1", "Alpha", "on_hold")]} />);
    expect(within(screen.getByRole("row", { name: /Alpha/ })).getByText("on_hold")).toBeTruthy();
  });
});

describe("SCRUM-55/AC2 drafts are visually distinguished", () => {
  it("SCRUM-55/AC2 labels a draft as not submitted yet and marks its row, with the Submitted column saying so", () => {
    render(<MyEventRequestsTable requests={[make("1", "Alpha", "draft")]} />);

    const row = screen.getByRole("row", { name: /Alpha/ });
    expect(row.getAttribute("data-draft")).toBe("true");
    expect(within(row).getByText("Not submitted yet")).toBeTruthy();
    expect(within(row).getByText("Not submitted")).toBeTruthy();
  });

  it("SCRUM-55/AC2 tints a draft row, and only a draft row", () => {
    render(<MyEventRequestsTable requests={[make("1", "Alpha", "draft"), make("2", "Beta", "submitted")]} />);

    const tinted = (name: RegExp) => screen.getByRole("row", { name }).className.split(/\s+/).includes("bg-muted/50");
    expect(tinted(/Alpha/)).toBe(true);
    expect(tinted(/Beta/)).toBe(false);
  });

  it("SCRUM-55/AC2 leaves a submitted request without any draft marking", () => {
    render(<MyEventRequestsTable requests={[make("2", "Beta", "submitted")]} />);

    const row = screen.getByRole("row", { name: /Beta/ });
    expect(row.getAttribute("data-draft")).toBeNull();
    expect(within(row).queryByText("Not submitted yet")).toBeNull();
    expect(row.textContent).toMatch(/1 Oct 2026/);
  });

  it("SCRUM-55/AC2 shows a nameless draft, or the Untitled draft placeholder, as Untitled draft and still links to it", () => {
    render(<MyEventRequestsTable requests={[make("1", "", "draft"), make("2", "Untitled draft", "draft"), make("3", "  ", "draft")]} />);

    const links = screen.getAllByRole("link", { name: "Untitled draft" });
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/events/new?draft=1", "/events/new?draft=2", "/events/new?draft=3"]); // a draft opens the form (SCRUM-54/AC1)
  });

  it("SCRUM-55/AC2 keeps a real draft name as it is", () => {
    render(<MyEventRequestsTable requests={[make("1", "Half done", "draft")]} />);
    expect(screen.getByRole("link", { name: "Half done" })).toBeTruthy();
  });
});

describe("SCRUM-55/AC3 filter by status", () => {
  const REQUESTS = [
    make("1", "Alpha", "draft"),
    make("2", "Beta", "submitted"),
    make("3", "Gamma", "draft"),
    make("4", "Delta", "approved"),
  ];
  const names = () => screen.queryAllByRole("link").map((a) => a.textContent);

  it("SCRUM-55/AC3 shows everything at first, with an All chip chosen and one chip per status present with its count", () => {
    render(<MyEventRequestsList requests={REQUESTS} />);

    expect(names()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(screen.getByRole("button", { name: "All 4" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Draft 2" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Submitted 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approved 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Rejected/ })).toBeNull();
  });

  it("SCRUM-55/AC3 choosing a status shows only the requests with that status, and All brings the rest back", () => {
    render(<MyEventRequestsList requests={REQUESTS} />);

    fireEvent.click(screen.getByRole("button", { name: "Draft 2" }));
    expect(names()).toEqual(["Alpha", "Gamma"]);
    expect(screen.getByRole("button", { name: "Draft 2" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "All 4" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Approved 1" }));
    expect(names()).toEqual(["Delta"]);
    expect(screen.getByRole("button", { name: "Draft 2" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "All 4" }));
    expect(names()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
  });

  it("SCRUM-55/AC3 orders the chips by the request lifecycle, not by the list order", () => {
    render(<MyEventRequestsList requests={[make("1", "A", "approved"), make("2", "B", "draft"), make("3", "C", "mystery")]} />);

    // the status chips only: a draft row also has its own Delete button (SCRUM-56)
    const chips = screen.getAllByRole("button").filter((b) => !b.getAttribute("aria-label")?.startsWith("Delete draft"));
    expect(chips.map((b) => b.textContent)).toEqual(["All 3", "Draft 1", "Approved 1", "mystery 1"]);
  });

  it("SCRUM-55/AC3 offers no filter when there are no requests, and says so", () => {
    render(<MyEventRequestsList requests={[]} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("You have not created any event requests yet.")).toBeTruthy();
  });

  it("SCRUM-55/AC3 says so when the chosen status has no requests left (for example after a refresh)", () => {
    const { rerender } = render(<MyEventRequestsList requests={REQUESTS} />);
    fireEvent.click(screen.getByRole("button", { name: "Approved 1" }));

    rerender(<MyEventRequestsList requests={REQUESTS.filter((r) => r.status !== "approved")} />);

    expect(screen.getByText("No requests match this status.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

// Added after the independent review: the literal AC2/AC3 scenarios with drafts and other requests in the same list
describe("SCRUM-55 mixed lists", () => {
  it("SCRUM-55/AC2 marks the draft and only the draft when both are in the same list", () => {
    render(<MyEventRequestsTable requests={[make("1", "Alpha", "draft"), make("2", "Beta", "submitted")]} />);

    const draft = screen.getByRole("row", { name: /Alpha/ });
    const submitted = screen.getByRole("row", { name: /Beta/ });
    expect(draft.getAttribute("data-draft")).toBe("true");
    expect(within(draft).getByText("Not submitted yet")).toBeTruthy();
    expect(submitted.getAttribute("data-draft")).toBeNull();
    expect(within(submitted).queryByText("Not submitted yet")).toBeNull();
  });

  it.each(["approved", "returned", "under_review", "something_new"])("SCRUM-55/AC2 does not mark a %s request as a draft", (status) => {
    render(<MyEventRequestsTable requests={[make("1", "Zed", status)]} />);

    const row = screen.getByRole("row", { name: /Zed/ });
    expect(row.getAttribute("data-draft")).toBeNull();
    expect(within(row).queryByText("Not submitted yet")).toBeNull();
    expect(within(row).queryByRole("button", { name: /Delete draft/ })).toBeNull();
  });

  it("SCRUM-55/AC2 still shows the Draft badge on a nameless draft", () => {
    render(<MyEventRequestsTable requests={[make("1", "", "draft")]} />);

    expect(within(screen.getByRole("row", { name: /Untitled draft/ })).getByText("Draft")).toBeTruthy();
  });

  it("SCRUM-55/AC3 filtering a mix leaves exactly the matching rows, with their own markings", () => {
    render(<MyEventRequestsList requests={[make("1", "A", "draft"), make("2", "B", "submitted"), make("3", "C", "draft")]} />);

    fireEvent.click(screen.getByRole("button", { name: "Draft 2" }));
    let rows = screen.getAllByRole("row").slice(1); // minus the header
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.getAttribute("data-draft")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Submitted 1" }));
    rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-draft")).toBeNull();
    expect(within(rows[0]).queryByRole("button", { name: /Delete draft/ })).toBeNull();
  });
});
