import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, getShellData } = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  getShellData: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/shellServer", () => ({ getShellData }));

import AccessDeniedPage from "@/app/access-denied/page";

beforeEach(() => {
  redirect.mockClear();
  getShellData.mockReset();
});

describe("SCRUM-122/AC3 access-denied page", () => {
  it("SCRUM-122/AC3 explains and links back to the role's home", async () => {
    getShellData.mockResolvedValue({ user: { fullName: "Priya", role: "event_coordinator" }, counts: {} });

    render(await AccessDeniedPage());

    expect(screen.getByRole("heading", { name: /don't have access/i })).toBeTruthy();
    expect(screen.getByText(/Event Coordinator role/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to my home" }).getAttribute("href")).toBe("/dashboard/event_coordinator");
  });

  it("SCRUM-122/AC3 sends a signed-out visitor to sign in", async () => {
    getShellData.mockResolvedValue(null);

    await expect(AccessDeniedPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
