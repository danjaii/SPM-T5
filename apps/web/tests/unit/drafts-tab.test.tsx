// SCRUM-124/AC2: the sidebar's Drafts item opens Home's Drafts tab (SCRUM-159). This replaces the earlier separate
// /my-event-requests/drafts page and its tests: main's tab already shows only drafts, each with a Draft badge.

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOrganiserHome } = vi.hoisted(() => ({ getOrganiserHome: vi.fn() }));
vi.mock("@/lib/organiserHomeServer", () => ({ getOrganiserHome }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import EventOrganiserDashboard from "@/app/dashboard/event_organiser/page";
import OrganiserDraftsPage from "@/app/dashboard/event_organiser/drafts/page";
import { OrganiserHome } from "@/components/OrganiserHome";
import { currentHref, NAV_ITEMS } from "@/lib/nav";
import { canOpen } from "@/lib/roleAccess";
import type { OrganiserHomeEvent } from "@/lib/organiserHome";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const event = (over: Partial<OrganiserHomeEvent>): OrganiserHomeEvent => ({
  id: "e", name: "Event", status: "planning", start: "2026-11-14T01:00:00Z", end: "2026-11-14T09:00:00Z", expected_attendance: 10,
  submitted_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", venue_names: [], coordinator_name: null,
  coordinator_assigned_at: null, clarification: null, change_outcome: null, ...over,
});
const EVENTS = [
  event({ id: "d1", name: "Design Workshop", status: "draft", start: null, end: null }),
  event({ id: "s1", name: "Pitch Day", status: "submitted" }),
  event({ id: "d2", name: "Alumni Night", status: "draft", start: null, end: null }),
];

const HOME = "/dashboard/event_organiser";
const DRAFTS = `${HOME}/drafts`;

beforeEach(() => getOrganiserHome.mockReset().mockResolvedValue({ events: EVENTS }));

describe("SCRUM-124/AC2 the Drafts item in the organiser's navigation", () => {
  it("SCRUM-124/AC2 opens Home's Drafts tab, and only the organiser has it", () => {
    expect(NAV_ITEMS.event_organiser.find((i) => i.label === "Drafts")?.href).toBe(DRAFTS);
    for (const [role, items] of Object.entries(NAV_ITEMS)) {
      if (role !== "event_organiser") expect(items.map((i) => i.label)).not.toContain("Drafts");
    }
  });

  it("SCRUM-124/AC2 highlights Drafts, not Home, on the Drafts tab", () => {
    const items = NAV_ITEMS.event_organiser;
    expect(currentHref(items, DRAFTS)).toBe(DRAFTS);
    expect(currentHref(items, HOME)).toBe(HOME);
    expect(currentHref(items, "/my-event-requests")).toBe("/my-event-requests");
  });

  it("SCRUM-124/AC2 is only for an event organiser, like Home", () => {
    expect(canOpen("event_organiser", DRAFTS)).toBe(true);
    expect(canOpen("attendee", DRAFTS)).toBe(false);
    expect(canOpen("event_coordinator", DRAFTS)).toBe(false);
  });

  it("SCRUM-124/AC2 has no separate drafts page any more", () => {
    expect(existsSync(resolve(__dirname, "../../src/app/my-event-requests/drafts/page.tsx"))).toBe(false);
  });
});

describe("SCRUM-124/AC2 Home opens on the Drafts tab", () => {
  it("SCRUM-124/AC2 starts on Drafts when asked to, showing only drafts, each with the Draft badge", () => {
    render(<OrganiserHome events={EVENTS} now="2026-10-01T00:00:00Z" initialTab="drafts" />);
    expect(screen.getByRole("tab", { name: /Drafts/ }).getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    for (const name of ["Design Workshop", "Alumni Night"]) {
      expect(within(within(panel).getByRole("row", { name: new RegExp(name) })).getByText("Draft")).toBeTruthy();
    }
    expect(within(panel).queryByText("Pitch Day")).toBeNull();
  });

  it("SCRUM-124/AC2 starts on All without a tab", () => {
    render(<OrganiserHome events={EVENTS} now="2026-10-01T00:00:00Z" />);
    expect(screen.getByRole("tab", { name: /All/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("SCRUM-124/AC2 the Drafts route is Home with the Drafts tab selected, and Home itself still opens on All", async () => {
    const { unmount } = render(await OrganiserDraftsPage());
    expect(screen.getByRole("tab", { name: /Drafts/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Drafts" })).toBeTruthy();
    unmount();
    render(await EventOrganiserDashboard());
    expect(screen.getByRole("tab", { name: /All/ }).getAttribute("aria-selected")).toBe("true");
  });
});
