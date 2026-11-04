import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-lead" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect, usePathname: () => "/lead/events", useRouter: () => ({ push: vi.fn() }) }));

import LeadActiveEventsPage, { dynamic } from "@/app/lead/events/page";
import LeadQueuePage from "@/app/lead/queue/page";
import { LeadActiveEvents } from "@/components/LeadActiveEvents";
import { getLeadActiveEvents, type LeadActiveEvent } from "@/lib/leadServer";
import { NAV_ITEMS } from "@/lib/nav";

// SCRUM-189 — View and filter all active events (/lead/events)

const rachel = { id: "c-1", full_name: "Rachel Tan" };
const marcus = { id: "c-2", full_name: "Marcus Lim" };
const event = (id: string, name: string, status: string, coordinator: LeadActiveEvent["coordinator"]): LeadActiveEvent => ({
  id,
  name,
  status,
  coordinator,
  preferred_start_datetime: "2031-06-15T01:00:00Z",
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  expected_attendance: 120,
});
const events = [
  event("e-1", "Tech Summit", "planning", rachel),
  event("e-2", "Annual Gala", "confirmed", marcus),
  event("e-3", "Tech Expo", "confirmed", rachel),
];

/** event-service answers each path with its own status and body. */
function mockServer(routes: Record<string, [number, unknown]>) {
  const fetchMock = vi.fn(async (url: string) => {
    const [status, body] = routes[new URL(url).pathname] ?? [404, { error: "Not found" }];
    return { ok: status < 400, status, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Opens a filter and picks an option, as a Lead does (Base UI ignores a pick that follows opening too quickly). */
async function pick(filter: string, label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: filter }));
  const option = await screen.findByRole("option", { name: label });
  await new Promise((resolve) => setTimeout(resolve, 300));
  fireEvent.pointerDown(option);
  fireEvent.mouseDown(option);
  fireEvent.pointerUp(option);
  fireEvent.mouseUp(option);
  fireEvent.click(option);
}

const names = () => screen.queryAllByRole("link").map((a) => a.textContent);

afterEach(() => {
  vi.unstubAllGlobals();
  cookieValue.current = "token-lead";
});

describe("SCRUM-189 all active events", () => {
  it("SCRUM-189/AC1 reads event-service's list as the signed-in Lead, fresh on every visit", async () => {
    const fetchMock = mockServer({ "/lead/events": [200, events] });

    expect(await getLeadActiveEvents()).toEqual({ events });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4002/lead/events", expect.objectContaining({ cache: "no-store" }));
    expect(dynamic).toBe("force-dynamic");
  });

  it("SCRUM-189/AC1 shows each event's name, status with an icon, coordinator, date and attendance, in the order given", async () => {
    mockServer({ "/lead/events": [200, events] });

    render(await LeadActiveEventsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Active events" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Event", "Status", "Coordinator", "Preferred date and time", "Expected attendance",
    ]);
    expect(names()).toEqual(["Tech Summit", "Annual Gala", "Tech Expo"]);
    const row = screen.getByRole("row", { name: /Tech Summit/ });
    expect(within(row).getByText("Planning")).toBeTruthy();
    expect(within(row).getByTestId("status-icon")).toBeTruthy();
    expect(within(row).getByText("Rachel Tan")).toBeTruthy();
    expect(within(row).getByText("120")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tech Summit" }).getAttribute("href")).toBe("/lead/events/e-1");
    expect(screen.getByText("3 active events")).toBeTruthy();
  });

  it("SCRUM-189/AC1 says Not specified for a missing date, attendance or coordinator", () => {
    render(<LeadActiveEvents events={[{ ...event("e-9", "Quiet", "approved", null), preferred_start_datetime: null, expected_attendance: null }]} />);

    expect(within(screen.getByRole("row", { name: /Quiet/ })).getAllByText("Not specified")).toHaveLength(3);
    expect(screen.getByText("1 active event")).toBeTruthy();
  });

  it("SCRUM-189/AC2 shows a designed empty state when no event is active", () => {
    render(<LeadActiveEvents events={[]} />);

    expect(screen.getByText("No events are active right now.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("SCRUM-189/AC3 offers only the coordinators and statuses in the list, each once", async () => {
    render(<LeadActiveEvents events={events} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Coordinator" }));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["All coordinators", "Marcus Lim", "Rachel Tan"]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());

    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["All statuses", "Confirmed", "Planning"]);
  });

  it("SCRUM-189/AC3 narrows by coordinator, status and name together, and Clear filters shows them all again", async () => {
    render(<LeadActiveEvents events={events} />);

    await pick("Coordinator", "Rachel Tan");
    await waitFor(() => expect(names()).toEqual(["Tech Summit", "Tech Expo"]));

    await pick("Status", "Confirmed");
    await waitFor(() => expect(names()).toEqual(["Tech Expo"]));
    expect(screen.getByText("Showing 1 of 3 active events")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(names()).toEqual(["Tech Summit", "Annual Gala", "Tech Expo"]);
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("SCRUM-189/AC3 the name search ignores case and surrounding spaces", () => {
    render(<LeadActiveEvents events={events} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "  tech " } });

    expect(names()).toEqual(["Tech Summit", "Tech Expo"]);
  });

  it("SCRUM-189/AC4 says no event matches, with a way to clear the filters", () => {
    render(<LeadActiveEvents events={events} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "nothing like this" } });

    expect(screen.getByText("No events match these filters.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    const clears = screen.getAllByRole("button", { name: "Clear filters" });
    fireEvent.click(clears[clears.length - 1]!);
    expect(names()).toHaveLength(3);
  });

  it("SCRUM-189/AC5 shows event-service's refusal to a non-Lead instead of a list", async () => {
    mockServer({ "/lead/events": [403, { error: "Only an Event Coordinator Lead can do this." }] });

    render(await LeadActiveEventsPage());

    expect(screen.getByRole("alert").textContent).toBe("Only an Event Coordinator Lead can do this.");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("SCRUM-189/AC5 falls back to a general message when event-service gives none", async () => {
    mockServer({ "/lead/events": [500, {}] });

    expect(await getLeadActiveEvents()).toEqual({ error: "We couldn't load the active events." });
  });

  it("SCRUM-189/AC5 sends someone who is not signed in to the sign-in page", async () => {
    cookieValue.current = undefined;
    mockServer({});

    await expect(getLeadActiveEvents()).rejects.toThrow("redirect:/login");
  });

  it("SCRUM-189/AC6 View all active events on the queue opens this page, which is also in the Lead's sidebar", async () => {
    mockServer({ "/lead/queue": [200, []], "/lead/coordinators": [200, []], "/lead/summary": [200, null] });

    render(await LeadQueuePage());

    expect(screen.getByRole("link", { name: "View all active events" }).getAttribute("href")).toBe("/lead/events");
    expect(NAV_ITEMS.event_coordinator_lead.find((i) => i.href === "/lead/events")?.label).toBe("Active events");
  });
});
