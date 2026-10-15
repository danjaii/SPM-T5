// SCRUM-116 — only the Safety Officer can make the safety check decision

import { render, screen } from "@testing-library/react";
import { ROLES } from "@spm-t5/shared";
import { describe, expect, it } from "vitest";

import { SafetyCheckActions } from "@/components/SafetyCheckActions";

describe("SCRUM-116/AC1 — Safety Officers can make safety decisions", () => {
  it("SCRUM-116/AC1 offers a Safety Officer Approve, Reject and Request changes", () => {
    render(<SafetyCheckActions role="safety_officer" />);

    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request changes" })).toBeTruthy();
  });
});

describe("SCRUM-116/AC2 — Other roles cannot make safety decisions", () => {
  // Every other role comes from the shared ROLES list, so a role added later is asked about too.
  it.each(ROLES.filter((role) => role !== "safety_officer"))("SCRUM-116/AC2 offers a %s none of the safety decisions", (role) => {
    const { container } = render(<SafetyCheckActions role={role} />);

    expect(container.innerHTML).toBe("");
  });
});
