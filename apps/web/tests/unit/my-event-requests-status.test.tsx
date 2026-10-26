// SCRUM-55: the My event requests list shows each request's status (AC1), sets drafts apart (AC2) and filters by status (AC3)

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { MyEventRequestsTable } from "@/components/MyEventRequestsTable";
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
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/events/1", "/events/2", "/events/3"]);
  });

  it("SCRUM-55/AC2 keeps a real draft name as it is", () => {
    render(<MyEventRequestsTable requests={[make("1", "Half done", "draft")]} />);
    expect(screen.getByRole("link", { name: "Half done" })).toBeTruthy();
  });
});
