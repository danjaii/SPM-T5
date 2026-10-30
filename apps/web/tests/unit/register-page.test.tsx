// this test file checks the page at /events/<id>/register

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend loading helper (tested in event-registration-server.test.ts), so this test is only about the page itself
const { getRegistrationForm } = vi.hoisted(() => ({ getRegistrationForm: vi.fn() }));
vi.mock("@/lib/eventRegistrationServer", () => ({ getRegistrationForm }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import RegisterPage from "@/app/events/[id]/register/page";

const formData = {
  event: {
    id: "evt-1",
    name: "Tech Summit",
    start_at: "2026-12-12T11:00:00Z",
    end_at: "2026-12-12T13:00:00Z",
    venue: { name: "Orchid Hall", address: "Level 3, East Wing" },
    availability: "open",
    can_register: true,
    my_registration: null,
  },
  prefill: { name: "Alicia Fernandez", email: "alicia.fernandez@example.com", phone: "" },
};

// ---------------------------------------------------------------------------
// SCRUM-83 — The registration form page (/events/<id>/register)
// ---------------------------------------------------------------------------
describe("SCRUM-83 — Registration form page", () => {
  // AC7: the page loads the event's form and shows it
  it("SCRUM-83/AC7 shows the registration form for the event in the address", async () => {
    getRegistrationForm.mockResolvedValue({ data: formData });

    render(await RegisterPage({ params: Promise.resolve({ id: "evt-1" }) }));

    expect(getRegistrationForm).toHaveBeenCalledWith("evt-1");
    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Register" })).toBeTruthy();
  });

  // AC7: no form for an event attendees can't register for (event-service answered 404 "Event not found.")
  it("SCRUM-83/AC7 shows the loader's error instead of a form", async () => {
    getRegistrationForm.mockResolvedValue({ error: "Event not found." });

    render(await RegisterPage({ params: Promise.resolve({ id: "evt-unknown" }) }));

    expect(screen.getByRole("alert").textContent).toBe("Event not found.");
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });
  // end of AC7
});
// end of SCRUM-83
