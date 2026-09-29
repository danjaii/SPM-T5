import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getEvent } = vi.hoisted(() => ({ getEvent: vi.fn() }));
vi.mock("@/lib/getEvent", () => ({ getEvent }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn() }) }));

import EventPage from "@/app/events/[id]/page";

const open = async (id: string) => render(await EventPage({ params: Promise.resolve({ id }) }));

describe("Event status page route (/events/[id])", () => {
  it("shows the event it was asked for", async () => {
    getEvent.mockResolvedValue({ event: { id: "evt-1", name: "Tech Summit", status: "approved", canChangeStatus: false } });

    await open("evt-1");

    expect(getEvent).toHaveBeenCalledWith("evt-1");
    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to dashboard/i }).getAttribute("href")).toBe("/dashboard");
  });

  it("shows event-service's message when the event can't be shown", async () => {
    getEvent.mockResolvedValue({ error: "Event not found." });

    await open("missing");

    expect(screen.getByRole("alert").textContent).toBe("Event not found.");
  });
});
