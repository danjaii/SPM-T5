// SCRUM-159 (Figma 02): the Event Organiser Home, "My events"

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOrganiserHome, push } = vi.hoisted(() => ({ getOrganiserHome: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/organiserHomeServer", () => ({ getOrganiserHome }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

import EventOrganiserDashboard from "@/app/dashboard/event_organiser/page";
import { OrganiserHome } from "@/components/OrganiserHome";
import {
  changeOutcomeText,
  eventSubline,
  eventsInTab,
  formatTimeRange,
  homeCounts,
  needingReply,
  nextConfirmed,
  type OrganiserHomeEvent,
} from "@/lib/organiserHome";

const NOW = "2026-10-01T00:00:00Z";

const event = (over: Partial<OrganiserHomeEvent> = {}): OrganiserHomeEvent => ({
  id: "e1",
  name: "Annual Tech Summit",
  status: "planning",
  start: "2026-11-14T01:00:00Z",
  end: "2026-11-14T09:00:00Z",
  expected_attendance: 450,
  submitted_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  venue_names: [],
  coordinator_name: null,
  coordinator_assigned_at: null,
  clarification: null,
  change_outcome: null,
  ...over,
});

const EVENTS: OrganiserHomeEvent[] = [
  event({ id: "draft1", name: "Design Workshop", status: "draft", start: null, end: null }),
  event({ id: "sub1", name: "Pitch Day", status: "submitted" }),
  event({
    id: "ask1",
    name: "Alumni Night",
    status: "planning",
    coordinator_name: "Daniel Tan",
    coordinator_assigned_at: "2026-10-09T00:00:00Z",
    clarification: { author_name: "Daniel Tan", text: "Will alcohol be served?", asked_at: "2026-10-12T00:00:00Z" },
  }),
  event({ id: "conf1", name: "Product Launch", status: "confirmed", start: "2026-10-22T00:00:00Z", venue_names: ["Seminar Room 2"], coordinator_name: "Priya Nair" }),
  event({ id: "conf2", name: "Later Gala", status: "confirmed", start: "2026-12-18T11:00:00Z" }),
];

beforeEach(() => {
  getOrganiserHome.mockReset();
  push.mockReset();
});

describe("SCRUM-159/AC1 the figures and tab counts group the organiser's events by status", () => {
  it("SCRUM-159/AC1 counts drafts, in review, needs your reply, confirmed, in progress and all", () => {
    expect(homeCounts(EVENTS)).toEqual({ all: 5, drafts: 1, inReview: 1, needsReply: 1, inProgress: 2, confirmed: 2 });
  });

  it("SCRUM-159/AC1 each tab holds only its own group", () => {
    expect(eventsInTab(EVENTS, "drafts").map((e) => e.id)).toEqual(["draft1"]);
    expect(eventsInTab(EVENTS, "in_progress").map((e) => e.id)).toEqual(["sub1", "ask1"]);
    expect(eventsInTab(EVENTS, "confirmed").map((e) => e.id)).toEqual(["conf1", "conf2"]);
    expect(eventsInTab(EVENTS, "all")).toHaveLength(5);
  });

  it("SCRUM-159/AC1 the Confirmed figure names the next confirmed event that has not started", () => {
    expect(nextConfirmed(EVENTS, new Date(NOW))!.id).toBe("conf1");
    expect(nextConfirmed(EVENTS, new Date("2027-01-01T00:00:00Z"))).toBeUndefined();
  });

  it("SCRUM-159/AC1 describes each row under its name: the venue, a draft's last edit, or that it waits for a coordinator", () => {
    expect(eventSubline(EVENTS[3], null)).toBe("Seminar Room 2");
    expect(eventSubline(EVENTS[0], "4 Mar 2031, 1:06 pm")).toBe("Last edited 4 Mar 2031, 1:06 pm");
    expect(eventSubline(EVENTS[0], null)).toBe("Draft");
    expect(eventSubline(EVENTS[1], null)).toBe("Waiting for a coordinator");
    expect(eventSubline(EVENTS[2], null)).toBe("No venue confirmed yet");
  });

  it("SCRUM-159/AC1 shows the time range in Singapore time", () => {
    expect(formatTimeRange("2026-11-14T01:00:00Z", "2026-11-14T09:00:00Z")).toBe("09:00–17:00");
    expect(formatTimeRange("2026-11-14T01:00:00Z", null)).toBe("09:00");
  });

  it("SCRUM-159/AC1 shows each status as an icon and a label in the table", () => {
    render(<OrganiserHome events={EVENTS} now={NOW} />);

    const row = screen.getByRole("row", { name: /Pitch Day/ });
    expect(within(row).getByText("Submitted")).toBeTruthy();
    expect(within(row).getByTestId("status-icon")).toBeTruthy();
  });

  it("SCRUM-159/AC1 filters the table when a tab is chosen, and the tab shows its count", () => {
    render(<OrganiserHome events={EVENTS} now={NOW} />);

    expect(screen.getByRole("tab", { name: /Drafts\s*1/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Drafts/ }));

    expect(screen.getByText("Design Workshop")).toBeTruthy();
    expect(screen.queryByText("Pitch Day")).toBeNull();
  });

  it("SCRUM-159/AC1 says so when a tab has no events", () => {
    render(<OrganiserHome events={[event({ status: "submitted" })]} now={NOW} />);

    fireEvent.click(screen.getByRole("tab", { name: /Drafts/ }));

    expect(screen.getByText("No events here.")).toBeTruthy();
  });

  it("SCRUM-159/AC1 opens an event from anywhere on its row, and a draft opens the form with it loaded", () => {
    render(<OrganiserHome events={EVENTS} now={NOW} />);

    fireEvent.click(within(screen.getByRole("row", { name: /Pitch Day/ })).getByText("Waiting for a coordinator"));
    expect(push).toHaveBeenCalledWith("/events/sub1");

    expect(screen.getByRole("link", { name: "Continue editing: Design Workshop" }).getAttribute("href")).toBe("/events/new?draft=draft1");
  });
});

describe("SCRUM-159/AC2 an event the coordinator asked about is under Needs your reply", () => {
  it("SCRUM-159/AC2 lists the events waiting on the organiser, most recent question first", () => {
    const later = event({ id: "ask2", clarification: { author_name: "Priya Nair", text: "Budget?", asked_at: "2026-10-15T00:00:00Z" } });

    expect(needingReply([...EVENTS, later]).map((e) => e.id)).toEqual(["ask2", "ask1"]);
  });

  it("SCRUM-159/AC2 shows a banner naming the event and the question, linking to the event", () => {
    render(<OrganiserHome events={EVENTS} now={NOW} />);

    const banner = screen.getByTestId("needs-reply-banner");
    expect(within(banner).getByText(/needs more information on Alumni Night/)).toBeTruthy();
    expect(within(banner).getByText(/Will alcohol be served\?/)).toBeTruthy();
    expect(within(banner).getByRole("link", { name: "Reply to Daniel" }).getAttribute("href")).toBe("/events/ask1");
  });

  it("SCRUM-159/AC2 shows the Needs your reply figure as a link to the event, and its row as Needs your reply with a Reply action", () => {
    render(<OrganiserHome events={EVENTS} now={NOW} />);

    const figures = screen.getByRole("region", { name: "Your events at a glance" });
    expect(within(figures).getByRole("link", { name: /Reply to Daniel/ }).getAttribute("href")).toBe("/events/ask1");
    const row = screen.getByRole("row", { name: /Alumni Night/ });
    expect(within(row).getByText("Needs your reply")).toBeTruthy();
    expect(within(row).getByRole("link", { name: "Reply: Alumni Night" })).toBeTruthy();
  });

  it("SCRUM-159/AC2 shows no banner when nothing is waiting", () => {
    render(<OrganiserHome events={[event()]} now={NOW} />);

    expect(screen.queryByTestId("needs-reply-banner")).toBeNull();
    expect(screen.getByText("Nothing waiting")).toBeTruthy();
  });

  it("SCRUM-159/AC2 says how many more events need a reply when there are several", () => {
    const more = event({ id: "ask2", name: "Gala", clarification: { author_name: "Priya Nair", text: "Budget?", asked_at: "2026-10-15T00:00:00Z" } });

    render(<OrganiserHome events={[...EVENTS, more]} now={NOW} />);

    expect(within(screen.getByTestId("needs-reply-banner")).getByText(/1 more event needs a reply/)).toBeTruthy();
  });
});

describe("SCRUM-159/AC3 a decided change request shows its outcome", () => {
  it("SCRUM-159/AC3 words an approved and a rejected change request, with the day it was decided", () => {
    expect(changeOutcomeText({ status: "approved", decided_at: "2026-10-05T00:00:00Z" })).toBe("Change request approved 5 Oct");
    expect(changeOutcomeText({ status: "rejected", decided_at: null })).toBe("Change request rejected");
  });

  it("SCRUM-159/AC3 shows the outcome on the event's row", () => {
    const changed = event({ id: "c1", name: "Moved Summit", change_outcome: { status: "approved", decided_at: "2026-10-05T00:00:00Z" } });

    render(<OrganiserHome events={[changed]} now={NOW} />);

    expect(within(screen.getByRole("row", { name: /Moved Summit/ })).getByText("Change request approved 5 Oct")).toBeTruthy();
  });
});

describe("SCRUM-159/AC4 no events shows an empty state that links to a new request", () => {
  it("SCRUM-159/AC4 says there are none and links to create one", () => {
    render(<OrganiserHome events={[]} now={NOW} />);

    expect(screen.getByText("You have not created any event requests yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create an event request" }).getAttribute("href")).toBe("/events/new");
  });
});

describe("SCRUM-159 the Home page", () => {
  it("SCRUM-159/AC1 is titled My events with its line, inside the shared shell", async () => {
    getOrganiserHome.mockResolvedValue({ events: EVENTS });

    render(await EventOrganiserDashboard());

    expect(screen.getByRole("heading", { level: 1, name: "My events" })).toBeTruthy();
    expect(screen.getByText("Every request you have made, from draft to confirmed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
  });

  it("SCRUM-159/AC1 shows the reason, with an icon, when the events cannot load", async () => {
    getOrganiserHome.mockResolvedValue({ error: "We couldn't load your events. Please try again." });

    render(await EventOrganiserDashboard());

    expect(screen.getByRole("alert").textContent).toContain("We couldn't load your events");
  });
});
