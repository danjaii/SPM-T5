import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend loader (tested in get-profile.test.ts), so this test is only about the page itself
const { getProfile } = vi.hoisted(() => ({ getProfile: vi.fn() }));
vi.mock("@/lib/profileServer", () => ({ getProfile }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn() }) }));

import ProfilePage from "@/app/profile/page";

// ---------------------------------------------------------------------------
// SCRUM-68: profile page route (/profile)
// ---------------------------------------------------------------------------
describe("SCRUM-68 profile page (/profile)", () => {
  // We already tested that the profile can be fetched, and that the form can display it. This test checks the two work
  // together: the page fetches the person's profile, then passes it on to the form so it is displayed.

  // if user clicks on profile, the webpage is right 
  it("68-S1: shows the person's profile in the form that was loaded", async () => {
    getProfile.mockResolvedValue({
      profile: {
        fullName: "Rachel Tan",
        email: "rachel@example.com",
        loginEmail: "rachel@example.com",
        phone: "+65 8100 2000",
        communicationPreferences: { email: true, sms: false },
        role: "event_coordinator",
        organisation: null,
        department: "Event Coordination",
        responsibilities: ["Search for venues and submit venue booking requests"],
      },
    });

    render(await ProfilePage());

    expect(screen.getByRole("heading", { name: "My profile" })).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Rachel Tan");
    // SCRUM-122/AC13: the shell is the way back; the page carries no top bar or back link of its own
    expect(screen.queryByRole("link", { name: /back to dashboard/i })).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
  });
  // end of showing the profile
  // If the profile could not be loaded (the service is down, say), the page shows that message instead of a form.
  it("68-S1: shows the message instead of the form when the profile could not be loaded", async () => {
    getProfile.mockResolvedValue({ error: "We couldn't reach the server. Please try again." });

    render(await ProfilePage());

    expect(screen.getByRole("alert").textContent).toBe("We couldn't reach the server. Please try again.");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });
  // end of showing the message

});
// end of SCRUM-68 profile page
