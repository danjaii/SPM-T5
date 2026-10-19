import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-123" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// SCRUM-47/AC11: the real header bell, so the page's header can be checked for it (tests/setup.ts stubs it elsewhere)
vi.unmock("@/components/NotificationBell");

import NotificationsPage from "@/app/notifications/page";
import { getNotifications } from "@/lib/notificationsServer";

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

describe("SCRUM-47/AC11 every signed-in page has the notification bell in its header", () => {
  it("the Notifications page's header has the bell", async () => {
    mockFetch(() => ({ status: 200, body: { items: [], unreadCount: 0 } }));

    const { container } = render(await NotificationsPage());

    expect(await within(container.querySelector("header")!).findByRole("button", { name: "Notifications" })).toBeTruthy();
  });
});
