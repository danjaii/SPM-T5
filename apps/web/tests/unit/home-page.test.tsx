import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, getShellData } = vi.hoisted(() => ({ redirect: vi.fn(), getShellData: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/shellServer", () => ({ getShellData }));

import HomePage from "@/app/page";

describe("HomePage", () => {
  beforeEach(() => {
    redirect.mockClear();
    getShellData.mockReset();
  });

  it("sends visitors to the sign-in page", async () => {
    getShellData.mockResolvedValue(null);
    await HomePage();
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  // SCRUM-122/AC1: the role home redirect
  it.each(["event_organiser", "safety_officer", "attendee"])("SCRUM-122/AC1 sends a signed-in %s to their home page", async (role) => {
    getShellData.mockResolvedValue({ user: { fullName: "A", role }, counts: {} });
    await HomePage();
    expect(redirect).toHaveBeenCalledWith(`/dashboard/${role}`);
  });
});
