import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-coord" as string | undefined },
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import EquipmentRequestPage from "@/app/events/[id]/equipment-request/page";
import { EventEquipmentRequests } from "@/components/EventEquipmentRequests";
import type { EquipmentRequestView } from "@/lib/equipmentRequests";
import { getEquipmentRequestForm, getEventEquipmentRequests } from "@/lib/equipmentRequestsServer";

const aRequest = (over: Partial<EquipmentRequestView> = {}): EquipmentRequestView => ({
  id: "r1",
  equipment: "Audio: Wireless Microphone Set",
  quantity: 4,
  venueName: "Grand Hall",
  venueBookingId: "b-1",
  notes: "Two on stage",
  status: "SUBMITTED",
  statusLabel: "Submitted",
  releasedReason: null,
  ...over,
});

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  cookieValue.current = "token-coord";
  redirect.mockClear();
});

describe("SCRUM-86/AC2 see the request on the event", () => {
  it("shows the equipment, quantity, venue, notes and status", () => {
    render(<EventEquipmentRequests eventId="evt-1" data={{ requests: [aRequest()], canCreate: true }} />);

    const row = screen.getAllByRole("row")[1];
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "Audio: Wireless Microphone Set",
      "4",
      "Grand Hall",
      "Two on stage",
      "Submitted",
    ]);
  });

  it("shows 'No venue' and a dash for a request with no venue or notes", () => {
    render(<EventEquipmentRequests eventId="evt-1" data={{ requests: [aRequest({ venueName: null, notes: null })], canCreate: false }} />);
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell").map((c) => c.textContent);
    expect(cells[2]).toBe("No venue");
    expect(cells[3]).toBe("—");
  });

  it("says so when nothing has been requested yet", () => {
    render(<EventEquipmentRequests eventId="evt-1" data={{ requests: [], canCreate: true }} />);
    expect(screen.getByText("No equipment has been requested for this event yet.")).toBeTruthy();
  });

  it("shows nothing when equipment-service gave no answer for this viewer", () => {
    const { container } = render(<EventEquipmentRequests eventId="evt-1" data={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("SCRUM-86/AC3 several requests per event", () => {
  it("lists each request with its own status", () => {
    render(
      <EventEquipmentRequests
        eventId="evt-1"
        data={{
          requests: [aRequest(), aRequest({ id: "r2", equipment: "AV: Projector Unit", status: "ARRANGED", statusLabel: "Arranged" })],
          canCreate: true,
        }}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[4].textContent)).toEqual(["Submitted", "Arranged"]);
  });
});

describe("SCRUM-86/AC6, AC7 who can add a request", () => {
  it("the assigned coordinator of an open event gets the Request equipment button", () => {
    render(<EventEquipmentRequests eventId="evt-1" data={{ requests: [], canCreate: true }} />);
    expect(screen.getByRole("link", { name: "Request equipment" }).getAttribute("href")).toBe("/events/evt-1/equipment-request");
  });

  it("a finished event, or anyone else, gets no button", () => {
    render(<EventEquipmentRequests eventId="evt-1" data={{ requests: [aRequest()], canCreate: false }} />);
    expect(screen.queryByRole("link", { name: "Request equipment" })).toBeNull();
  });
});

describe("SCRUM-86 the request page (/events/[id]/equipment-request)", () => {
  const form = {
    event: { id: "evt-1", name: "Tech Summit" },
    equipment: [{ id: "eq-mic", label: "Audio: Wireless Microphone Set" }],
    venues: [],
  };
  const open = async () => render(await EquipmentRequestPage({ params: Promise.resolve({ id: "evt-1" }) }));

  it("SCRUM-86/AC1 shows the form, loaded as the signed-in user", async () => {
    const fetchMock = mockServer(200, form);
    await open();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4004/events/evt-1/equipment-request-form",
      expect.objectContaining({ headers: { cookie: "cs_session=token-coord" }, cache: "no-store" }),
    );
    expect(screen.getByRole("heading", { name: "Request equipment" })).toBeTruthy();
    expect(screen.getByText("Tech Summit")).toBeTruthy();
    expect(screen.getByRole("link", { name: "← Back to event" }).getAttribute("href")).toBe("/events/evt-1");
  });

  it.each([
    [403, "You are not allowed to do that."],
    [409, "Equipment can't be requested for a completed, cancelled or rejected event."],
  ])("SCRUM-86/AC6, AC7 shows equipment-service's %s refusal instead of the form", async (status, error) => {
    mockServer(status, { error });
    await open();

    expect(screen.getByRole("alert").textContent).toBe(error);
    expect(screen.queryByRole("button", { name: "Submit request" })).toBeNull();
  });
});

describe("SCRUM-86 equipment-service calls from the server", () => {
  it("the form: a general message when the refusal has none, and a message when unreachable", async () => {
    mockServer(500, {});
    expect(await getEquipmentRequestForm("evt-1")).toEqual({ error: "We couldn't load the equipment request form." });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await getEquipmentRequestForm("evt-1")).toEqual({ error: "We couldn't reach the server. Please try again." });
  });

  it("the form: not signed in (no cookie, or the service says 401) goes to the sign-in page", async () => {
    mockServer(401, {});
    await expect(getEquipmentRequestForm("evt-1")).rejects.toThrow("redirect:/login");

    cookieValue.current = undefined;
    await expect(getEquipmentRequestForm("evt-1")).rejects.toThrow("redirect:/login");
  });

  it("the event's requests: the reply when allowed, otherwise null so the page leaves the section out", async () => {
    const view = { requests: [aRequest()], canCreate: true };
    const fetchMock = mockServer(200, view);
    expect(await getEventEquipmentRequests("evt 1")).toEqual(view);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4004/events/evt%201/equipment-requests");

    mockServer(403, { error: "no" });
    expect(await getEventEquipmentRequests("evt-1")).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await getEventEquipmentRequests("evt-1")).toBeNull();

    cookieValue.current = undefined;
    expect(await getEventEquipmentRequests("evt-1")).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// SCRUM-102/AC7 equipment released with its venue booking
// ----------------------------------------------------------------------------

describe("SCRUM-102/AC7 released equipment on the event page (102-S31)", () => {
  // the Grand Hall venue booking was cancelled ("Moved to a bigger room"), which released the 4 microphones
  it("102-S31 shows equipment released with its venue booking as Released, with why the venue booking was cancelled", () => {
    render(
      <EventEquipmentRequests
        eventId="evt-1"
        data={{ requests: [aRequest({ status: "RELEASED", statusLabel: "Released", releasedReason: "Moved to a bigger room" })], canCreate: false }}
      />,
    );

    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Released")).toBeTruthy();
    expect(within(row).getByText("Venue booking cancelled: Moved to a bigger room")).toBeTruthy();
  });

  it("102-S31 other equipment requests show no release note", () => {
    render(<EventEquipmentRequests eventId="evt-1" data={{ requests: [aRequest()], canCreate: false }} />);

    expect(screen.queryByText(/Venue booking cancelled/)).toBeNull();
  });
});
// end of SCRUM-102
