import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-123" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import NotificationsPage from "@/app/notifications/page";
import { DashboardView, type DashboardData } from "@/components/DashboardView";
import { getDashboard } from "@/lib/dashboard";
import { notificationsLinkLabel } from "@/lib/notifications";
import { getNotifications, getUnreadCount } from "@/lib/notificationsServer";

function mockFetch(handler: (url: string) => { status: number; body: unknown } | Error) {
  const fetchMock = vi.fn(async (url: string) => {
    const out = handler(url);
    if (out instanceof Error) throw out;
    return { ok: out.status < 400, status: out.status, json: async () => out.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cookieValue.current = "token-123";
  redirect.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SCRUM-46/AC1 loading the notifications (46-S1)", () => {
  it("46-S1: asks notification-service as the signed-in user", async () => {
    const body = { items: [], unreadCount: 0 };
    const fetchMock = mockFetch(() => ({ status: 200, body }));
    await expect(getNotifications()).resolves.toEqual(body);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, { headers: { cookie: string } }];
    expect(url).toBe("http://localhost:4005/notifications");
    expect(options.headers.cookie).toBe("cs_session=token-123");
  });

  it("46-S1: sends anyone not signed in to the sign-in page", async () => {
    cookieValue.current = undefined;
    await expect(getNotifications()).rejects.toThrow("redirect:/login");
    cookieValue.current = "stale";
    mockFetch(() => ({ status: 401, body: {} }));
    await expect(getNotifications()).rejects.toThrow("redirect:/login");
  });

  it("46-S1: other failures become a message, not a crash", async () => {
    mockFetch(() => ({ status: 500, body: {} }));
    await expect(getNotifications()).resolves.toEqual({ error: "We couldn't load your notifications. Please try again." });
    mockFetch(() => new Error("down"));
    await expect(getNotifications()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("46-S1: the page lists the notifications, or shows the error", async () => {
    mockFetch(() => ({
      status: 200,
      body: {
        unreadCount: 1,
        items: [{ id: "n-1", type: "x", title: "Hello there", message: "m", isRead: false, createdAt: "2026-10-01T01:00:00Z", readAt: null, related: null }],
      },
    }));
    render(await NotificationsPage());
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByText("1 unread")).toBeTruthy();
    expect(screen.getByText("Hello there")).toBeTruthy();

    mockFetch(() => ({ status: 500, body: {} }));
    render(await NotificationsPage());
    expect(screen.getByRole("alert").textContent).toContain("couldn't load your notifications");
  });
});

describe("SCRUM-46 the unread count for the dashboard", () => {
  it("returns the count from notification-service", async () => {
    mockFetch(() => ({ status: 200, body: { unreadCount: 4 } }));
    await expect(getUnreadCount()).resolves.toBe(4);
  });

  it("returns null when there is no session, a failure, a strange answer or no connection", async () => {
    cookieValue.current = undefined;
    await expect(getUnreadCount()).resolves.toBeNull();
    cookieValue.current = "token-123";
    mockFetch(() => ({ status: 500, body: {} }));
    await expect(getUnreadCount()).resolves.toBeNull();
    mockFetch(() => ({ status: 200, body: { unreadCount: "many" } }));
    await expect(getUnreadCount()).resolves.toBeNull();
    mockFetch(() => new Error("down"));
    await expect(getUnreadCount()).resolves.toBeNull();
  });

  it("getDashboard fetches the dashboard and the count together; a down service does not break it", async () => {
    const dashboard = { user: { fullName: "Rachel Tan", email: "r@x.com", role: "event_coordinator" }, sections: [] };
    mockFetch((url) =>
      url.endsWith("/dashboard") ? { status: 200, body: dashboard } : { status: 200, body: { unreadCount: 2 } },
    );
    await expect(getDashboard("event_coordinator")).resolves.toEqual({ ...dashboard, notifications: { unread: 2 } });

    mockFetch((url) => (url.endsWith("/dashboard") ? { status: 200, body: dashboard } : new Error("down")));
    await expect(getDashboard("event_coordinator")).resolves.toEqual({ ...dashboard, notifications: { unread: null } });
  });
});

describe("SCRUM-46/AC1 every role's dashboard links to notifications (46-S1)", () => {
  const base = (role: string, notifications?: DashboardData["notifications"]): DashboardData => ({
    user: { fullName: "Test User", email: "t@x.com", role },
    sections: [],
    notifications,
  });

  it.each(["event_organiser", "event_coordinator", "venue_staff", "technical_support_staff", "attendee", "event_coordinator_lead", "safety_officer"])(
    "46-S1: %s sees Notifications (n unread)",
    (role) => {
      render(<DashboardView data={base(role, { unread: 3 })} />);
      expect(screen.getByRole("link", { name: "Notifications (3 unread)" }).getAttribute("href")).toBe("/notifications");
    },
  );

  it("46-S1: with no count (service down) the link shows without one", () => {
    render(<DashboardView data={base("attendee", { unread: null })} />);
    expect(screen.getByRole("link", { name: "Notifications" })).toBeTruthy();
  });

  it("46-S1: notificationsLinkLabel", () => {
    expect(notificationsLinkLabel(0)).toBe("Notifications (0 unread)");
    expect(notificationsLinkLabel(null)).toBe("Notifications");
    expect(notificationsLinkLabel(undefined)).toBe("Notifications");
  });
});
