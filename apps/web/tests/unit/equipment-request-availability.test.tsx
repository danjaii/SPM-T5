import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RequestAvailability } from "@/components/equipment/RequestAvailability";
import type { EquipmentRequestDetailView, RequestAvailabilityView } from "@/lib/equipmentRequests";

// Pretend loader, so the page test is only about the page putting the availability on screen
const { getEquipmentRequest } = vi.hoisted(() => ({ getEquipmentRequest: vi.fn() }));
vi.mock("@/lib/equipmentRequestsServer", () => ({ getEquipmentRequest }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));

import EquipmentRequestPage from "@/app/equipment-requests/[id]/page";

// ----------------------------------------------------------------------------
// Test setup: what equipment-service says about a request for 6 projectors with 4 free in its time window.
// ----------------------------------------------------------------------------

const availability = (changes: Partial<RequestAvailabilityView> = {}): RequestAvailabilityView => ({
  available: 4,
  needed: 6,
  sufficient: false,
  heldBy: [{ eventName: "Robotics Meetup", units: 6 }],
  outOfService: null,
  ...changes,
});

/** A Submitted request for 6 projectors, as GET /equipment-requests/:id answers it. */
const detail = (changes: Partial<EquipmentRequestDetailView> = {}): EquipmentRequestDetailView => ({
  id: "req-1",
  eventId: "evt-devops",
  eventName: "DevOps Summit",
  eventDate: "2026-10-15",
  venueName: "Grand Hall",
  equipment: "AV: Projector Unit",
  quantity: 6,
  status: "SUBMITTED",
  statusLabel: "Submitted",
  updated: false,
  startTime: "09:00",
  endTime: "17:00",
  notes: null,
  reason: null,
  canReview: true,
  lastChangedBy: null,
  lastChangedAt: null,
  availability: availability(),
  ...changes,
});

/** The badge's text and its icon's class, which names the lucide icon drawn. */
const badge = (label: string) => {
  const el = screen.getByText(label, { selector: "[data-tone]" });
  return { tone: el.getAttribute("data-tone"), icon: within(el).getByTestId("status-icon").getAttribute("class") ?? "" };
};

// end of test setup

describe("SCRUM-137/AC1 shortfall shows fail", () => {
  it('shows "Available 4 / need 6" with a fail icon and label', () => {
    render(<RequestAvailability availability={availability()} />);
    expect(screen.getByText("Available 4 / need 6")).toBeTruthy();
    const partial = badge("Partial");
    expect(partial.icon).toMatch(/circle-x|x-circle/);
  });

  it("says which other events hold the missing units", () => {
    render(<RequestAvailability availability={availability({ heldBy: [{ eventName: "Robotics Meetup", units: 4 }, { eventName: "Film Society", units: 2 }] })} />);
    expect(screen.getByText("Held by other events: 4 with Robotics Meetup, 2 with Film Society.")).toBeTruthy();
  });

  it("shows Unavailable, as danger with a fail icon, when none are free, and says why when the item is out of service", () => {
    render(<RequestAvailability availability={availability({ available: 0, heldBy: [], outOfService: "under_maintenance" })} />);
    expect(screen.getByText("Available 0 / need 6")).toBeTruthy();
    expect(badge("Unavailable")).toEqual({ tone: "danger", icon: expect.stringMatching(/circle-x|x-circle/) });
    expect(badge("Under maintenance").tone).toBe("warning");
    expect(screen.queryByText(/Held by other events/)).toBeNull();
  });
});

describe("SCRUM-137/AC1 enough shows pass", () => {
  it("shows Enough, as success with a tick, when enough are free", () => {
    render(<RequestAvailability availability={availability({ available: 8, sufficient: true, heldBy: [] })} />);
    expect(screen.getByText("Available 8 / need 6")).toBeTruthy();
    expect(badge("Enough")).toEqual({ tone: "success", icon: expect.stringMatching(/circle-check|check-circle/) });
  });
});

describe("SCRUM-137/AC1 the request page shows the availability", () => {
  const open = async () => render(await EquipmentRequestPage({ params: Promise.resolve({ id: "req-1" }) }));

  it("shows it on a request still waiting for a decision", async () => {
    getEquipmentRequest.mockResolvedValue({ request: detail() });
    await open();
    expect(screen.getByRole("heading", { name: "Availability at that time" })).toBeTruthy();
    expect(screen.getByText("Available 4 / need 6")).toBeTruthy();
  });

  it("leaves it out when equipment-service sends none (the request is decided)", async () => {
    getEquipmentRequest.mockResolvedValue({ request: detail({ status: "ARRANGED", statusLabel: "Arranged", canReview: false, availability: null }) });
    await open();
    expect(screen.queryByRole("heading", { name: "Availability at that time" })).toBeNull();
  });
});
