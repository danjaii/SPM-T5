// SCRUM-116 — the Safety Officer signs in through the usual sign-in page and lands on their own home page

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend the loading helper (tested in its own file), so these tests are only about the pages
const { getDashboard } = vi.hoisted(() => ({ getDashboard: vi.fn() }));
vi.mock("@/lib/dashboard", () => ({ getDashboard }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import SafetyOfficerDashboard from "@/app/dashboard/safety_officer/page";
import { LoginForm } from "@/components/LoginForm";

/** What auth-service sends for a Safety Officer's dashboard (empty until the safety-check stories fill it). */
const dashboard = {
  user: { fullName: "Farah Ismail", email: "farah.ismail@connectsphere.example.com", role: "safety_officer" },
  sections: [],
};

// ---------------------------------------------------------------------------
// SCRUM-116 — "Given I am logged in as a Safety Officer" (AC1, AC3)
// ---------------------------------------------------------------------------
describe("SCRUM-116 — Safety Officer sign-in and home page", () => {
  // AC1: the Safety Officer signs in on the same page as everyone else, choosing their role
  it("SCRUM-116/AC1 offers Safety Officer as a role on the sign-in page", () => {
    render(<LoginForm />);

    expect(screen.getByRole("radio", { name: /Safety Officer/ })).toBeTruthy();
  });

  // AC1: after signing in, the Safety Officer lands on their own home page
  it("SCRUM-116/AC1 the Safety Officer lands on their own home page", async () => {
    getDashboard.mockResolvedValue(dashboard);

    render(await SafetyOfficerDashboard());

    expect(getDashboard).toHaveBeenCalledWith("safety_officer");
    expect(screen.getByRole("heading", { name: "Safety Officer dashboard" })).toBeTruthy();
  });
  // end of AC1
});
// end of SCRUM-116
