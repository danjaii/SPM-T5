// this test file checks where the sign-in form takes the user once they've signed in

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import { LoginForm } from "@/components/LoginForm";

/** auth-service accepts the sign-in and, as always, names the user's dashboard. */
function mockSuccessfulSignIn() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ redirectTo: "/dashboard/attendee" }) }),
  );
}

function signIn() {
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "alicia.fernandez@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "ConnectSphere2026!" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockClear();
});

// ---------------------------------------------------------------------------
// SCRUM-83 — Register for an event: a guest is returned to the registration form after signing in
// ---------------------------------------------------------------------------
describe("SCRUM-83 — Sign-in returns a guest to the registration form", () => {
  // AC2: the route guard sent the guest here with ?next=/events/<id>/register; signing in takes them back there
  it("SCRUM-83/AC2 returns the user to the registration form after signing in", async () => {
    mockSuccessfulSignIn();
    render(<LoginForm next="/events/evt-1/register" />);

    signIn();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/events/evt-1/register"));
  });

  // AC2: ?next= comes from the URL, so a link could point it at another site ("//evil.example" is a full address to
  // a browser). Only a path on this site is followed; anything else falls back to the dashboard.
  it.each(["//evil.example/phish", "https://evil.example/phish"])(
    "SCRUM-83/AC2 ignores a next address that leaves the site (%s)",
    async (next) => {
      mockSuccessfulSignIn();
      render(<LoginForm next={next} />);

      signIn();

      await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard/attendee"));
    },
  );
  // end of AC2
});
// end of SCRUM-83
