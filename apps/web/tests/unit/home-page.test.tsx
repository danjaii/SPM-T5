import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

import HomePage from "@/app/page";

describe("HomePage", () => {
  it("sends visitors to the sign-in page", () => {
    HomePage();
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
