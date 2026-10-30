import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES, type Role } from "@spm-t5/shared";

const nav = vi.hoisted(() => ({ pathname: "/", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));

import { NeedsAction } from "@/components/shell/NeedsAction";
import { useShell } from "@/components/shell/ShellContext";
import { ShellFrame } from "@/components/shell/ShellFrame";
import { currentHref, NAV_ITEMS, type QueueCounts } from "@/lib/nav";

const shellFor = (role: Role, counts: QueueCounts = {}) => ({ user: { fullName: "Priya Nair", role }, counts });
const renderShell = (role: Role, counts?: QueueCounts) =>
  render(<ShellFrame shell={shellFor(role, counts)}><p>page body</p></ShellFrame>);
const labelsIn = (el: HTMLElement) => within(el).getAllByRole("link").map((a) => a.textContent!.replace(/\d+$/, ""));

beforeEach(() => {
  nav.pathname = "/";
  nav.push.mockClear();
});

describe("SCRUM-121/AC1 role navigation", () => {
  it.each(ROLES)("shows only the %s's nav items", (role) => {
    nav.pathname = `/dashboard/${role}`;
    renderShell(role);
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(labelsIn(main)).toEqual(NAV_ITEMS[role].map((i) => i.label));
    // nothing that belongs only to another role leaks in
    const own = new Set(NAV_ITEMS[role].map((i) => i.href));
    const others = ROLES.filter((r) => r !== role).flatMap((r) => NAV_ITEMS[r]);
    for (const item of others.filter((i) => !own.has(i.href))) {
      expect(within(main).queryByRole("link", { name: new RegExp(`^${item.label}`) })?.getAttribute("href")).not.toBe(item.href);
    }
  });

  // SCRUM-139/AC1: the attendee's home item is Browse events; every other role's is Home
it.each(ROLES)("highlights the home item for the %s on its home page and nothing else", (role) => {
    nav.pathname = `/dashboard/${role}`;
    renderShell(role);
    const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(links.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent)).toEqual([role === "attendee" ? "Browse events" : "Home"]);
  });

  it("SCRUM-131: has no separate Search venues item; the old search address highlights the catalogue", () => {
    nav.pathname = "/venues/search";
    renderShell("event_coordinator");
    const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(links.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent)).toEqual(["Venue catalogue"]);
  });

  it("matches a nested page to its section, and an unknown page to nothing", () => {
    const items = NAV_ITEMS.venue_staff;
    expect(currentHref(items, "/booking-queue/abc")).toBe("/booking-queue");
    expect(currentHref(items, "/somewhere-else")).toBeUndefined();
  });

  it("shows the signed-in user's name and role, and the page body", () => {
    renderShell("safety_officer");
    expect(screen.getAllByText("Priya Nair").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Safety Officer").length).toBeGreaterThan(0);
    expect(screen.getByText("page body")).toBeTruthy();
  });

  it("goes through the router on a plain click and leaves a modified click to the browser", () => {
    renderShell("venue_staff");
    const link = screen.getByRole("link", { name: "Venue catalogue" });
    fireEvent.click(link);
    expect(nav.push).toHaveBeenCalledWith("/venues");
    nav.push.mockClear();
    fireEvent.click(link, { ctrlKey: true });
    expect(nav.push).not.toHaveBeenCalled();
  });

  it.each(["/login", "/register", "/forgot-password", "/reset-password"])("renders %s without the shell", (path) => {
    nav.pathname = path;
    renderShell("attendee");
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    expect(screen.getByText("page body")).toBeTruthy();
  });

  it("renders the page alone when nobody is signed in", () => {
    render(<ShellFrame shell={null}><p>public page</p></ShellFrame>);
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    expect(screen.getByText("public page")).toBeTruthy();
  });
});

describe("SCRUM-121/AC2 queue counts", () => {
  it.each([
    ["event_coordinator_lead", { leadQueue: 4 }, "Unassigned requests"],
    ["venue_staff", { bookingQueue: 7 }, "Booking requests"],
    ["technical_support_staff", { equipmentQueue: 2 }, "Equipment requests"],
    ["safety_officer", { safetyQueue: 3 }, "Safety checks"],
  ] as const)("the %s's queue item shows its count", (role, counts, label) => {
    renderShell(role, counts);
    const count = Object.values(counts)[0];
    expect(screen.getByRole("link", { name: `${label}${count}` })).toBeTruthy();
  });

  it("shows no count for an empty queue or when the count could not be loaded", () => {
    const { unmount } = renderShell("venue_staff", { bookingQueue: 0 });
    expect(screen.getByRole("link", { name: "Booking requests" })).toBeTruthy();
    unmount();
    renderShell("venue_staff", {});
    expect(screen.getByRole("link", { name: "Booking requests" })).toBeTruthy();
  });

  it("puts a count only on queue items", () => {
    renderShell("event_coordinator", { bookingQueue: 9 });
    expect(screen.queryByText("9")).toBeNull();
  });
});

describe("SCRUM-178/AC3 the count is read again on moving to another page", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The safety queue answers with this many events; anything else the shell asks for (the bell) is refused. */
  function queueOf(size: number) {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/safety-checks") ? { ok: true, json: async () => Array(size).fill({}) } : { ok: false, json: async () => ({}) },
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  /** What the shell asked for, leaving out the notification bell's own read. */
  const queueReads = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => !url.includes("/notifications"));
  const shell = shellFor("safety_officer", { safetyQueue: 2 });

  it("SCRUM-178/AC3 shows the new number after the page changes", async () => {
    queueOf(1);
    nav.pathname = "/safety-checks/evt-1";
    const { rerender } = render(<ShellFrame shell={shell}><p>page body</p></ShellFrame>);
    expect(screen.getByRole("link", { name: "Safety checks2" })).toBeTruthy();

    nav.pathname = "/safety-checks";
    rerender(<ShellFrame shell={shell}><p>page body</p></ShellFrame>);

    expect(await screen.findByRole("link", { name: "Safety checks1" })).toBeTruthy();
  });

  it("SCRUM-178/AC3 updates Needs your action with the same number", async () => {
    queueOf(1);
    nav.pathname = "/safety-checks";
    const { rerender } = render(<ShellFrame shell={shell}><NeedsAction /></ShellFrame>);
    expect(screen.getByText("2 events waiting for a safety check")).toBeTruthy();

    nav.pathname = "/dashboard/safety_officer";
    rerender(<ShellFrame shell={shell}><NeedsAction /></ShellFrame>);

    expect(await screen.findByText("1 event waiting for a safety check")).toBeTruthy();
  });

  it("SCRUM-178/AC3 does not read again on a full page load, when the server has only just counted", () => {
    const fetchMock = queueOf(1);
    render(<ShellFrame shell={shell}><p>page body</p></ShellFrame>);
    expect(queueReads(fetchMock)).toEqual([]);
  });

  it("SCRUM-178/AC3 takes the newer counts a router.refresh() brings from the server", () => {
    queueOf(1);
    const { rerender } = render(<ShellFrame shell={shell}><p>page body</p></ShellFrame>);

    rerender(<ShellFrame shell={shellFor("safety_officer", { safetyQueue: 5 })}><p>page body</p></ShellFrame>);

    expect(screen.getByRole("link", { name: "Safety checks5" })).toBeTruthy();
  });

  it("SCRUM-178/AC3 ignores an answer that a newer read has overtaken", async () => {
    const answers: ((size: number) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string) =>
      url.endsWith("/safety-checks")
        ? new Promise((resolve) => answers.push((size) => resolve({ ok: true, json: async () => Array(size).fill({}) })))
        : Promise.resolve({ ok: false, json: async () => ({}) }),
    ));
    nav.pathname = "/a";
    const { rerender } = render(<ShellFrame shell={shell}><p>page body</p></ShellFrame>);
    nav.pathname = "/b";
    rerender(<ShellFrame shell={shell}><p>page body</p></ShellFrame>);
    nav.pathname = "/c";
    rerender(<ShellFrame shell={shell}><p>page body</p></ShellFrame>);

    answers[1]!(4);
    expect(await screen.findByRole("link", { name: "Safety checks4" })).toBeTruthy();
    answers[0]!(9);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });

    expect(screen.getByRole("link", { name: "Safety checks4" })).toBeTruthy();
  });

  it("SCRUM-178/AC4 keeps the last known number when the count cannot be read", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    nav.pathname = "/a";
    const { rerender } = render(<ShellFrame shell={shell}><p>page body</p></ShellFrame>);

    nav.pathname = "/b";
    rerender(<ShellFrame shell={shell}><p>page body</p></ShellFrame>);
    await waitFor(() => expect(queueReads(fetchMock)).toHaveLength(1));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });

    expect(screen.getByRole("link", { name: "Safety checks2" })).toBeTruthy();
  });

  it.each(["event_organiser", "event_coordinator", "attendee"] as const)("SCRUM-178/AC5 asks for no count for the %s, who has no queue", async (role) => {
    const fetchMock = queueOf(1);
    nav.pathname = "/a";
    const { rerender } = render(<ShellFrame shell={shellFor(role)}><p>page body</p></ShellFrame>);

    nav.pathname = "/b";
    rerender(<ShellFrame shell={shellFor(role)}><p>page body</p></ShellFrame>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });

    expect(queueReads(fetchMock)).toEqual([]);
  });

  it("SCRUM-178/AC5 asks for no count on a page shown before sign-in", async () => {
    const fetchMock = queueOf(1);
    nav.pathname = "/a";
    const { rerender } = render(<ShellFrame shell={shell}><p>page body</p></ShellFrame>);

    nav.pathname = "/login";
    rerender(<ShellFrame shell={shell}><p>page body</p></ShellFrame>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });

    expect(queueReads(fetchMock)).toEqual([]);
  });

  it("SCRUM-178/AC1 exposes refreshCounts, for a page that changes a queue without moving", async () => {
    queueOf(1);
    function SaveButton() {
      const live = useShell();
      return <button type="button" onClick={() => live?.refreshCounts()}>save</button>;
    }
    render(<ShellFrame shell={shell}><SaveButton /></ShellFrame>);

    fireEvent.click(screen.getByRole("button", { name: "save" }));

    expect(await screen.findByRole("link", { name: "Safety checks1" })).toBeTruthy();
  });
});

describe("SCRUM-121/AC3 mobile menu", () => {
  it("opens from the menu button, lists the role's items, and closes on Escape", () => {
    renderShell("venue_staff");
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("dialog", { name: "Menu" });
    expect(labelsIn(within(menu).getByRole("navigation", { name: "Main" }))).toEqual(NAV_ITEMS.venue_staff.map((i) => i.label));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
  });

  it("closes when a link is chosen, and from the backdrop", () => {
    renderShell("attendee");
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Menu" })).getByRole("link", { name: "My registrations" }));
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Close menu" })[0]!);
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
  });

  it("reports the menu's state to assistive technology", () => {
    renderShell("attendee");
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("SCRUM-122/AC12 profile reached from the user's name", () => {
  it.each(ROLES)("12-S1: no %s nav item is called My profile, and the name links to /profile", (role) => {
    renderShell(role);
    expect(NAV_ITEMS[role].some((i) => i.href === "/profile" || /profile/i.test(i.label))).toBe(false);
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(within(main).queryByRole("link", { name: /profile/i })).toBeNull();
    expect(screen.getByRole("link", { name: /my profile.*priya nair/i }).getAttribute("href")).toBe("/profile");
  });

  it("12-S2: marks the name as the current page on /profile, and not elsewhere", () => {
    nav.pathname = "/profile";
    const { unmount } = renderShell("attendee");
    const link = screen.getByRole("link", { name: /my profile/i });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(within(screen.getByRole("navigation", { name: "Main" })).queryAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page")).toEqual([]);
    unmount();
    nav.pathname = "/dashboard/attendee";
    renderShell("attendee");
    expect(screen.getByRole("link", { name: /my profile/i }).getAttribute("aria-current")).toBeNull();
  });

  it("12-S3: closes the mobile menu when the name is chosen", () => {
    renderShell("attendee");
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Menu" })).getByRole("link", { name: /my profile/i }));
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SCRUM-15 — Each role's sidebar offers the pages its acceptance criterion names, and none from another role's work
// ---------------------------------------------------------------------------
describe("SCRUM-15 — What each role sees in the sidebar", () => {
  const sidebarLinks = (role: Role) => {
    nav.pathname = `/dashboard/${role}`;
    renderShell(role);
    return Object.fromEntries(
      within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link").map((a) => [a.textContent!.replace(/\d+$/, ""), a.getAttribute("href")]),
    );
  };
  const EQUIPMENT_PAGES = ["/equipment-requests", "/equipment-availability", "/equipment-reservation"];

  // AC1: the organiser manages events: creating requests and following their registrations
  it("SCRUM-15/AC1 offers an event organiser event management", () => {
    const links = sidebarLinks("event_organiser");
    expect(links).toMatchObject({ "New event request": "/events/new", "Event registrations": "/registrations-overview" });
    expect(Object.values(links)).not.toContain("/booking-queue");
  });

  // AC2: the coordinator handles logistics and scheduling: reviewing event requests, venue bookings and the venue catalogue
  it("SCRUM-15/AC2 offers an event coordinator logistics and scheduling", () => {
    const links = sidebarLinks("event_coordinator");
    expect(links).toMatchObject({ "Event requests": "/events/review", "My venue bookings": "/venue-bookings", "Venue catalogue": "/venues" });
    for (const href of ["/booking-queue", ...EQUIPMENT_PAGES]) expect(Object.values(links)).not.toContain(href);
  });

  // AC3: venue staff see venue details and the venue bookings waiting for them
  it("SCRUM-15/AC3 offers venue staff venue details and booking information", () => {
    const links = sidebarLinks("venue_staff");
    expect(links).toMatchObject({ "Venue catalogue": "/venues", "Booking requests": "/booking-queue" });
    for (const href of EQUIPMENT_PAGES) expect(Object.values(links)).not.toContain(href);
  });

  // AC4: Technical Support Staff see every equipment page
  it("SCRUM-15/AC4 offers Technical Support Staff all equipment and technical information", () => {
    const links = sidebarLinks("technical_support_staff");
    expect(Object.values(links)).toEqual(expect.arrayContaining(EQUIPMENT_PAGES));
    expect(Object.values(links)).not.toContain("/booking-queue");
  });

  // AC5: the attendee sees their registrations, and Browse events (SCRUM-139/AC1) is the List of events open for booking (SCRUM-71)
  it("SCRUM-15/AC5 offers an attendee their registrations and the events open for booking", () => {
    const links = sidebarLinks("attendee");
    expect(links).toMatchObject({ "Browse events": "/dashboard/attendee", "My registrations": "/registrations" });
    for (const href of ["/events/new", "/events/review", "/booking-queue", ...EQUIPMENT_PAGES]) expect(Object.values(links)).not.toContain(href);
  });
});
// end of SCRUM-15
