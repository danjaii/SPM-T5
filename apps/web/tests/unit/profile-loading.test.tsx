import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Loading from "@/app/profile/loading";

// SCRUM-122/AC13 + shared AC10: while the profile loads, the page shows a skeleton of its two cards, not a blank screen.
describe("SCRUM-122/AC13 profile loading state", () => {
  it("13-S1: shows the page title and placeholder cards, marked as busy", () => {
    const { container } = render(<Loading />);

    expect(screen.getByRole("heading", { name: "My profile" })).toBeTruthy();
    expect(screen.getByLabelText("Loading your profile").getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll('[data-slot="card"]').length).toBe(2);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
