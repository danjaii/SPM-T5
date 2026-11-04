// SCRUM-124/AC2: a Drafts item in the organiser's navigation opens a list of only their drafts

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMyEventRequests } = vi.hoisted(() => ({ getMyEventRequests: vi.fn() }));
vi.mock("@/lib/myEventRequestsServer", () => ({ getMyEventRequests }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));

import DraftsPage from "@/app/my-event-requests/drafts/page";
import { currentHref, NAV_ITEMS } from "@/lib/nav";
import { canOpen } from "@/lib/roleAccess";

const make = (id: string, name: string, status: string) => ({
  id,
  name,
  status,
  preferred_start_datetime: "2026-11-20T01:00:00Z",
  expected_attendance: 100,
  submitted_at: status === "draft" ? null : "2026-10-01T02:00:00Z",
  updated_at: "2026-10-30T02:00:00Z",
});

const renderPage = async () => render(await DraftsPage());

beforeEach(() => getMyEventRequests.mockReset());

describe("SCRUM-124/AC2 the Drafts item in the organiser's navigation", () => {
  it("SCRUM-124/AC2 is in the organiser's navigation and nobody else's", () => {
    const item = NAV_ITEMS.event_organiser.find((i) => i.label === "Drafts");
    expect(item?.href).toBe("/my-event-requests/drafts");
    for (const [role, items] of Object.entries(NAV_ITEMS)) {
      if (role !== "event_organiser") expect(items.map((i) => i.label)).not.toContain("Drafts");
    }
  });

  it("SCRUM-124/AC2 makes Drafts, not My event requests, the current item on the drafts page", () => {
    const items = NAV_ITEMS.event_organiser;
    expect(currentHref(items, "/my-event-requests/drafts")).toBe("/my-event-requests/drafts");
    expect(currentHref(items, "/my-event-requests")).toBe("/my-event-requests");
  });

  it("SCRUM-124/AC2 is only for an event organiser, like My event requests", () => {
    expect(canOpen("event_organiser", "/my-event-requests/drafts")).toBe(true);
    expect(canOpen("attendee", "/my-event-requests/drafts")).toBe(false);
    expect(canOpen("event_coordinator", "/my-event-requests/drafts")).toBe(false);
  });
});

describe("SCRUM-124/AC2 the drafts list", () => {
  it("SCRUM-124/AC2 lists the organiser's drafts only, each marked as a draft, and none of their submitted requests", async () => {
    getMyEventRequests.mockResolvedValue({ requests: [make("1", "Alpha", "draft"), make("2", "Beta", "submitted"), make("3", "Gamma", "draft"), make("4", "Delta", "approved")] });

    await renderPage();

    expect(screen.getByRole("heading", { name: "Drafts" })).toBeTruthy();
    expect(screen.getByRole("row", { name: /Alpha/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /Gamma/ })).toBeTruthy();
    expect(screen.queryByText("Beta")).toBeNull();
    expect(screen.queryByText("Delta")).toBeNull();
    expect(within(screen.getByRole("row", { name: /Alpha/ })).getByText("Draft")).toBeTruthy();
  });

  it("SCRUM-124/AC2 opens a draft in the form and offers Delete on it", async () => {
    getMyEventRequests.mockResolvedValue({ requests: [make("evt-1", "Alpha", "draft")] });

    await renderPage();

    expect(screen.getByRole("link", { name: "Alpha" }).getAttribute("href")).toBe("/events/new?draft=evt-1");
    expect(screen.getByRole("button", { name: "Delete draft Alpha" })).toBeTruthy();
  });

  it("SCRUM-124/AC2 says there are no drafts, and offers a new request, when every request is submitted", async () => {
    getMyEventRequests.mockResolvedValue({ requests: [make("2", "Beta", "submitted")] });

    await renderPage();

    expect(screen.getByText("You have no drafts.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start a new event request" }).getAttribute("href")).toBe("/events/new");
  });

  it("SCRUM-124/AC2 shows why the list could not load instead of 'no drafts'", async () => {
    getMyEventRequests.mockResolvedValue({ error: "We couldn't load your event requests. Please try again." });

    await renderPage();

    expect(screen.getByRole("alert").textContent).toContain("We couldn't load your event requests");
    expect(screen.queryByText("You have no drafts.")).toBeNull();
  });
});
