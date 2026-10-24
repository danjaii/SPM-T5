// SCRUM-151 — clickable things look clickable: the hand cursor on buttons

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { LoginForm } from "@/components/LoginForm";
import { Button } from "@/components/ui/button";

// jsdom does not apply Tailwind's styles, so these check for the class that sets the cursor.
describe("SCRUM-151/AC1 hand cursor on buttons", () => {
  it("SCRUM-151/AC1 shows the hand cursor over the Sign in button", () => {
    render(<LoginForm />);

    expect(screen.getByRole("button", { name: "Sign in" }).className).toContain("cursor-pointer");
  });

  it.each(["default", "outline", "secondary", "ghost", "destructive", "link"] as const)(
    "SCRUM-151/AC1 shows the hand cursor over every %s button",
    (variant) => {
      render(<Button variant={variant}>Go</Button>);

      expect(screen.getByRole("button", { name: "Go" }).className).toContain("cursor-pointer");
    },
  );
});
