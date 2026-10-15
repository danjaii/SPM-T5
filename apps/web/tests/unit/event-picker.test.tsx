// this test file checks the dropdown organisers and coordinators use to pick one of their events

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { EventPicker } from "@/components/EventPicker";
import type { ManagedEvent } from "@/lib/eventRegistration";

/** One of the caller's events, as GET /events/managed sends it. */
const anEvent = (id: string, name: string): ManagedEvent => ({
  id,
  name,
  status: "confirmed",
  start_at: "2026-11-20T01:00:00Z",
  registration_capacity: 100,
});

// ---------------------------------------------------------------------------
// SCRUM-74 — Choosing which event's registrations to view
// ---------------------------------------------------------------------------
describe("SCRUM-74 — Event picker", () => {
  // AC3: organisers and coordinators select one of the events they manage to see its registrations
  it("SCRUM-74/AC3 opens the registrations of the event chosen in the dropdown", () => {
    render(<EventPicker events={[anEvent("evt-1", "Tech Summit"), anEvent("evt-2", "Design Week")]} selectedId={null} />);

    fireEvent.change(screen.getByLabelText("Event"), { target: { value: "evt-2" } });

    expect(push).toHaveBeenCalledWith("/registrations-overview?event=evt-2");
  });
  // end of AC3
});
// end of SCRUM-74
