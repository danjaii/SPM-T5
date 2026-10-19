import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.unmock("@/components/NotificationBell");
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { AppHeader } from "@/components/AppHeader";

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-47/AC11 every signed-in page's header has the notification bell", () => {
  it("shows the user's name and role, then the bell, then Log out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ unreadCount: 2 }) }));

    const { container } = render(<AppHeader user={{ fullName: "Priya Nair", role: "event_coordinator" }} />);

    await screen.findByRole("button", { name: "Notifications, 2 unread" });
    expect(container.querySelector("header")!.textContent).toMatch(/Priya Nair\s*Event Coordinator.*2.*Log out/);
  });

  it("shows a page's own link in Log out's place", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ unreadCount: 0 }) }));

    render(
      <AppHeader>
        <a href="/dashboard/event_coordinator">Back to dashboard</a>
      </AppHeader>,
    );

    expect(await screen.findByRole("link", { name: "Back to dashboard" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
  });
});
