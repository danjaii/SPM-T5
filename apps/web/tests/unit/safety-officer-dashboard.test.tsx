// SCRUM-116 — the Safety Officer signs in through the usual sign-in page and lands on their own home page

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend the loading helpers (tested in their own files), so these tests are only about the pages
const { getSafetyHome, getShellData } = vi.hoisted(() => ({ getSafetyHome: vi.fn(), getShellData: vi.fn() }));
vi.mock("@/lib/safetyCheckServer", () => ({ getSafetyHome }));
vi.mock("@/lib/shellServer", () => ({ getShellData }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import SafetyOfficerDashboard from "@/app/dashboard/safety_officer/page";
import { LoginForm } from "@/components/LoginForm";

// ---------------------------------------------------------------------------
// SCRUM-116 — Safety Officer sign-in (AC4)
// ---------------------------------------------------------------------------
describe("SCRUM-116 — Safety Officer sign-in and home page", () => {
  // AC4: the Safety Officer signs in on the same page as everyone else, choosing their role
  it("SCRUM-116/AC4 offers Safety Officer as a role on the sign-in page", async () => {
    render(<LoginForm />);

    fireEvent.click(screen.getByRole("combobox", { name: /Continue as/ }));
    expect(await screen.findByRole("option", { name: /Safety Officer/ })).toBeTruthy();
  });

  // AC4: after signing in, the Safety Officer lands on their own home page
  it("SCRUM-116/AC4 the Safety Officer lands on their own home page", async () => {
    getShellData.mockResolvedValue({ user: { fullName: "Farah Ismail", role: "safety_officer" }, counts: {} });
    getSafetyHome.mockResolvedValue({
      home: { ready: [], waiting_on_coordinator: 0, approved_this_month: 0, revoked_this_month: 0, recent: [] },
    });

    render(await SafetyOfficerDashboard());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening), Farah$/);
  });
  // end of AC4
});
// end of SCRUM-116
