import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";

describe("HomePage", () => {
  it("renders the ConnectSphere heading", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("ConnectSphere");
  });
});
