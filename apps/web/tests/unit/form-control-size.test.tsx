import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";

// Filters sit side by side (SCRUM-125 review queue), so a dropdown must be as tall as the text and date inputs beside it.
describe("SCRUM-125 form controls share one height", () => {
  it("a default Select trigger is the same height as an Input", () => {
    render(
      <>
        <Input aria-label="Search" />
        <Select items={[{ value: "a", label: "A" }]} defaultValue="a">
          <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
        </Select>
      </>,
    );

    const input = screen.getByLabelText("Search");
    const trigger = screen.getByLabelText("Status");
    expect(input.className).toContain("h-10");
    expect(trigger.className).toContain("data-[size=default]:h-10");
    expect(trigger.getAttribute("data-size")).toBe("default");
  });
});
