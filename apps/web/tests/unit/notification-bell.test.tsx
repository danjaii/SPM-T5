import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationItem } from "@spm-t5/shared";

vi.unmock("@/components/NotificationBell");
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { NotificationBell } from "@/components/NotificationBell";

type Reply = { status: number; body: unknown } | "offline";

/**
 * Fakes notification-service for the browser: GET /notifications/unread-count answers with `count`, GET /notifications
 * with `list`, and POST /notifications/:id/read with the item marked read.
 */
function mockService({ count = { status: 200, body: { unreadCount: 0 } }, list }: { count?: Reply; list?: Reply } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const reply: Reply | undefined = url.endsWith("/unread-count")
      ? count
      : init?.method === "POST"
        ? { status: 200, body: { isRead: true } }
        : list;
    if (!reply || reply === "offline") throw new TypeError("Failed to fetch");
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const item = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: "n-1",
  type: "coordinator_assigned",
  title: "You are responsible for an event",
  message: "Tech Summit",
  isRead: false,
  createdAt: "2026-10-17T01:00:00Z",
  readAt: null,
  related: { kind: "event", id: "e-1", label: "Tech Summit", href: "/events/e-1" },
  actionRequired: true,
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe("SCRUM-47/AC11 the notification bell in the page header", () => {
  it("shows how many notifications are unread", async () => {
    mockService({ count: { status: 200, body: { unreadCount: 3 } } });

    render(<NotificationBell />);

    const bell = await screen.findByRole("button", { name: "Notifications, 3 unread" });
    expect(bell.textContent).toContain("3");
  });

  it("shows 99+ on the bell above 99, so the number fits", async () => {
    mockService({ count: { status: 200, body: { unreadCount: 120 } } });

    render(<NotificationBell />);

    const bell = await screen.findByRole("button", { name: "Notifications, 120 unread" });
    expect(bell.textContent).toBe("99+");
  });

  it.each([
    ["nothing is unread", { status: 200, body: { unreadCount: 0 } } as Reply],
    ["the service can't be reached", "offline" as Reply],
  ])("has no number when %s", async (_case, count) => {
    const fetchMock = mockService({ count });

    const { container } = render(<NotificationBell />);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeTruthy();
    expect(container.querySelector(".bell__count")).toBeNull();
  });

  it("opens a list of the notifications, marking the unread ones and those that need action", async () => {
    const assigned = item();
    const approved = item({ id: "n-2", type: "event_approved", title: "Your event request was approved", isRead: true, actionRequired: false });
    mockService({ count: { status: 200, body: { unreadCount: 1 } }, list: { status: 200, body: { items: [assigned, approved], unreadCount: 1 } } });
    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));

    const rows = within(await screen.findByRole("list", { name: "Notifications" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/You are responsible for an event.*Action needed.*Unread/),
      expect.not.stringMatching(/Unread|Action needed/),
    ]);
    expect(rows[1].textContent).toContain("Your event request was approved");
  });

  it("choosing a notification marks it read, lowers the number, then opens its page", async () => {
    const fetchMock = mockService({
      count: { status: 200, body: { unreadCount: 1 } },
      list: { status: 200, body: { items: [item()], unreadCount: 1 } },
    });
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));

    fireEvent.click(await screen.findByRole("button", { name: /You are responsible for an event/ }));

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/events/e-1"));
    const read = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(read?.[0]).toBe("http://localhost:4005/notifications/n-1/read");
    expect(fetchMock.mock.invocationCallOrder[fetchMock.mock.calls.indexOf(read!)]).toBeLessThan(push.mock.invocationCallOrder[0]);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it("a notification about something you can no longer see says so, and opens nothing", async () => {
    const gone = item({
      isRead: true,
      related: { kind: "venue_booking", id: "b-1", label: "You no longer have access to this item", href: null },
    });
    mockService({ list: { status: 200, body: { items: [gone], unreadCount: 0 } } });
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));

    const row = await screen.findByRole("button", { name: /You are responsible for an event/ });
    expect(row.textContent).toContain("You no longer have access to this item");
    fireEvent.click(row);

    await vi.waitFor(() => expect(screen.queryByRole("list", { name: "Notifications" })).toBeNull());
    expect(push).not.toHaveBeenCalled();
  });

  it("lists every notification, even more than 8 (the list scrolls rather than stopping at 8)", async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => item({ id: `n-${i + 1}`, title: `Notification ${i + 1}` }));
    mockService({ count: { status: 200, body: { unreadCount: 12 } }, list: { status: 200, body: { items: twelve, unreadCount: 12 } } });
    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 12 unread" }));

    const list = await screen.findByRole("list", { name: "Notifications" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(12);
  });

  it("says so when there are no notifications", async () => {
    mockService({ list: { status: 200, body: { items: [], unreadCount: 0 } } });
    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));

    expect(await screen.findByText("You have no notifications.")).toBeTruthy();
  });

  it("says so when the list can't be loaded", async () => {
    mockService({ list: "offline" });
    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't load your notifications. Please try again.");
  });

  it("links to the full Notifications page", async () => {
    mockService({ list: { status: 200, body: { items: [item({ isRead: true })], unreadCount: 0 } } });
    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));

    expect((await screen.findByRole("link", { name: "View all notifications" })).getAttribute("href")).toBe("/notifications");
  });

  it("closes on Escape", async () => {
    mockService({ list: { status: 200, body: { items: [item({ isRead: true })], unreadCount: 0 } } });
    render(<NotificationBell />);
    const bell = await screen.findByRole("button", { name: "Notifications" });
    fireEvent.click(bell);
    await screen.findByRole("list", { name: "Notifications" });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("list", { name: "Notifications" })).toBeNull();
    expect(bell.getAttribute("aria-expanded")).toBe("false");
  });

  it("fetches the list only once opened, and shows a loading state until it arrives", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/unread-count")) return { ok: true, status: 200, json: async () => ({ unreadCount: 1 }) };
      await gate;
      return { ok: true, status: 200, json: async () => ({ items: [item()], unreadCount: 1 }) };
    }));
    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));

    expect(await screen.findByRole("status", { name: "Loading notifications" })).toBeTruthy();
    release();
    expect(await screen.findByRole("list", { name: "Notifications" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading notifications" })).toBeNull();
  });
});

describe("SCRUM-141 the notification centre", () => {
  const read = item({ id: "n-2", type: "event_approved", title: "Your event request was approved", isRead: true, actionRequired: false });
  const openWith = async () => {
    mockService({
      count: { status: 200, body: { unreadCount: 1 } },
      list: { status: 200, body: { items: [item(), read], unreadCount: 1 } },
    });
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    await screen.findByRole("list", { name: "Notifications" });
  };

  it("AC1: the bell shows the unread count in a badge", async () => {
    mockService({ count: { status: 200, body: { unreadCount: 6 } } });
    render(<NotificationBell />);
    const bell = await screen.findByRole("button", { name: "Notifications, 6 unread" });
    expect(bell.textContent).toBe("6");
  });

  it("AC3: unread rows have a bold title, a dot and the word Unread for screen readers; read rows do not", async () => {
    await openWith();
    const [unreadRow, readRow] = within(screen.getByRole("list", { name: "Notifications" })).getAllByRole("listitem");
    expect(within(unreadRow).getByText("You are responsible for an event").className).toContain("font-bold");
    expect(unreadRow.querySelector('[aria-hidden="true"].rounded-full.size-2')).not.toBeNull();
    expect(unreadRow.querySelector(".sr-only")?.textContent).toBe("Unread");
    expect(within(readRow).getByText("Your event request was approved").className).not.toContain("font-bold");
    expect(readRow.querySelector(".sr-only")).toBeNull();
  });

  it("AC6: Action needed is a StatusBadge with an icon and the words", async () => {
    await openWith();
    const badge = screen.getByText("Action needed");
    expect(badge.getAttribute("data-tone")).toBe("warning");
    expect(badge.querySelector('[data-testid="status-icon"]')).not.toBeNull();
  });

  it("the Unread tab lists only the unread ones, with their number on the tab", async () => {
    await openWith();
    const tab = screen.getByRole("tab", { name: /Unread/ });
    expect(tab.textContent).toContain("1");

    fireEvent.click(tab);

    const list = await screen.findByRole("list", { name: "Unread notifications" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).queryByText("Your event request was approved")).toBeNull();
  });

  it("AC10: the Unread tab says you are all caught up when nothing is unread", async () => {
    mockService({ list: { status: 200, body: { items: [read], unreadCount: 0 } } });
    render(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    await screen.findByRole("list", { name: "Notifications" });

    fireEvent.click(screen.getByRole("tab", { name: /Unread/ }));

    expect(await screen.findByText("You're all caught up.")).toBeTruthy();
  });

  it("AC9: the bell is a button that can be reached and opened with the keyboard, and Escape closes it", async () => {
    await openWith();
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("list", { name: "Notifications" })).toBeNull());
  });
});
