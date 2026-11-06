import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { fetchVenueCalendar } from "@/lib/venueCalendar";
import { jsonReply } from "./venue-calendar-fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-84/AC8 a role the service refuses sees no venue information", () => {
  it("SCRUM-84/AC8 shows the service's 403 message and no venues", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(403, { code: "FORBIDDEN", error: "You are not allowed to view the venue calendar." })));
    render(<VenueCalendar />);
    expect((await screen.findByRole("alert")).textContent).toContain("You are not allowed to view the venue calendar.");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("SCRUM-84/AC8 uses a default message when the 403 carries none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(403, {})));
    expect(await fetchVenueCalendar()).toEqual({ kind: "forbidden", message: "You are not allowed to view the venue calendar." });
  });

  it("SCRUM-84/AC8 passes an aborted request on instead of reporting it as an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await expect(fetchVenueCalendar()).rejects.toThrow("aborted");
  });
});
