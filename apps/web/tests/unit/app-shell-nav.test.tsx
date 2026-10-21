import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES, type Role } from "@spm-t5/shared";

const nav = vi.hoisted(() => ({ pathname: "/", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));

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

  it.each(ROLES)("highlights Home for the %s on its home page and nothing else", (role) => {
    nav.pathname = `/dashboard/${role}`;
    renderShell(role);
    const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(links.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent)).toEqual(["Home"]);
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
