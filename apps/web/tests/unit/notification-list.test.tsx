import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationItem } from "@spm-t5/shared";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), redirect: vi.fn() }));

import { NotificationList } from "@/components/NotificationList";

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

const unread: NotificationItem = {
  id: "n-1",
  type: "event_submitted",
  title: "Event request submitted",
  message: "Your request for Tech Summit has been submitted.",
  isRead: false,
  createdAt: "2026-10-01T01:00:00Z",
  readAt: null,
  related: { kind: "event", id: "e-1", label: "Tech Summit", href: "/events/e-1" },
  actionRequired: false,
};
const read: NotificationItem = { ...unread, id: "n-2", title: "Registration is open", isRead: true, readAt: "2026-10-02T01:00:00Z" };
const restricted: NotificationItem = {
  ...unread,
  id: "n-3",
  title: "Booking flagged",
  related: { kind: "venue_booking", id: "b-1", label: "You no longer have access to this item", href: null },
};

describe("SCRUM-46/AC2 notification details (46-S2)", () => {
  it("46-S2: shows the description, the related item and the time (Singapore time)", () => {
    render(<NotificationList items={[unread]} />);
    expect(screen.getByText("Event request submitted")).toBeTruthy();
    expect(screen.getByText("Your request for Tech Summit has been submitted.")).toBeTruthy();
    expect(screen.getByText("Related: Tech Summit")).toBeTruthy();
    expect(screen.getByText(/1 Oct 2026/)).toBeTruthy();
    expect(screen.getByText(/9:00/)).toBeTruthy();
  });

  it("46-S2: says so when there are none", () => {
    render(<NotificationList items={[]} />);
    expect(screen.getByText("You have no notifications.")).toBeTruthy();
  });
});

describe("SCRUM-46/AC3 unread notifications look different (46-S3)", () => {
  it("46-S3: an unread row has the unread class and the visible word Unread; a read row has neither", () => {
    const { container } = render(<NotificationList items={[unread, read]} />);
    const rows = container.querySelectorAll("ul > li");
    expect(rows[0].textContent).toContain("Unread");
    expect(rows[1].textContent).not.toContain("Unread");
    expect(screen.getAllByRole("button", { name: "Mark as read" })).toHaveLength(1);
  });
});

describe("SCRUM-47/AC11 a notification that needs action says so (47-S11)", () => {
  it("47-S11: a row that needs action shows the words Action needed; one that does not, does not", () => {
    const assigned: NotificationItem = { ...unread, id: "n-4", type: "coordinator_assigned", actionRequired: true };
    const { container } = render(<NotificationList items={[assigned, unread]} />);
    const rows = container.querySelectorAll("ul > li");
    expect(rows[0].textContent).toContain("Action needed");
    expect(rows[1].textContent).not.toContain("Action needed");
  });
});

describe("SCRUM-46/AC4 + AC5 selecting a notification (46-S4, 46-S5)", () => {
  it("46-S4 + 46-S5: clicking a row marks it read, then opens its page", async () => {
    const fetchMock = mockServer(200, { ...unread, isRead: true, readAt: "2026-10-15T01:00:00Z" });
    render(<NotificationList items={[unread]} />);

    fireEvent.click(screen.getByText("Event request submitted"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/e-1"));
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4005/notifications/n-1/read");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]);
    expect(screen.queryByText("Unread")).toBeNull();
  });

  it("46-S4: the unread count above the list follows the rows as they are marked read", async () => {
    mockServer(200, { ...unread, isRead: true });
    render(<NotificationList items={[unread, read]} />);
    expect(screen.getByText("1 unread")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));

    await waitFor(() => expect(screen.getByText("0 unread")).toBeDefined());
  });

  it("46-S4: Mark as read marks it without leaving the page", async () => {
    const fetchMock = mockServer(200, { ...unread, isRead: true });
    render(<NotificationList items={[unread]} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));

    await waitFor(() => expect(screen.queryByText("Unread")).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull();
  });

  it("46-S5: a read notification opens its page without another request", () => {
    const fetchMock = mockServer(200, {});
    render(<NotificationList items={[read]} />);
    fireEvent.click(screen.getByText("Registration is open"));
    return waitFor(() => expect(push).toHaveBeenCalledWith("/events/e-1")).then(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("46-S4: if marking read fails, it says so, stays unread and does not navigate", async () => {
    mockServer(500, { error: "Something went wrong." });
    render(<NotificationList items={[unread]} />);

    fireEvent.click(screen.getByText("Event request submitted"));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Something went wrong."));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("Unread")).toBeTruthy();
  });

  it("46-S4: a network failure is reported", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    render(<NotificationList items={[unread]} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("couldn't reach the server"));
  });
});

describe("SCRUM-46/AC7 restricted destination (46-S7)", () => {
  it("46-S7: shows the no-access wording, marks it read, and does not navigate", async () => {
    mockServer(200, { ...restricted, isRead: true });
    render(<NotificationList items={[restricted]} />);
    expect(screen.getByText("You no longer have access to this item")).toBeTruthy();

    fireEvent.click(screen.getByText("Booking flagged"));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it("46-S2: a notification that points at nothing is still marked read when clicked, without navigating", async () => {
    mockServer(200, {});
    render(<NotificationList items={[{ ...unread, related: null }]} />);
    fireEvent.click(screen.getByText("Event request submitted"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });
});

describe("SCRUM-141/AC3 unread items are marked by more than colour", () => {
  it("an unread row has a bold title and a dot and says Unread to screen readers; a read row has none of them", () => {
    const { container } = render(<NotificationList items={[unread, read]} />);
    const rows = container.querySelectorAll("ul > li");
    expect(screen.getByText("Event request submitted").className).toContain("font-bold");
    expect(screen.getByText("Registration is open").className).not.toContain("font-bold");
    expect(rows[0].querySelector('[aria-hidden="true"].rounded-full.size-2')).not.toBeNull();
    expect(rows[1].querySelector('[aria-hidden="true"].rounded-full.size-2')).toBeNull();
    expect(rows[0].querySelector(".sr-only")?.textContent).toBe("Unread");
  });
});

describe("SCRUM-141/AC6 status uses StatusBadge", () => {
  it("Action needed is a StatusBadge with an icon and the words", () => {
    render(<NotificationList items={[{ ...unread, actionRequired: true }]} />);
    const badge = screen.getByText("Action needed");
    expect(badge.getAttribute("data-tone")).toBe("warning");
    expect(badge.querySelector('[data-testid="status-icon"]')).not.toBeNull();
  });
});

describe("SCRUM-141/AC10 empty state", () => {
  it("a person with no notifications sees a designed empty state, not a blank page", () => {
    render(<NotificationList items={[]} />);
    expect(screen.getByText("You have no notifications.")).toBeTruthy();
    expect(screen.getByText(/will show up here/)).toBeTruthy();
  });
});
