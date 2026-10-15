import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect, refresh } = vi.hoisted(() => ({
  cookieValue: { current: "token-tech" as string | undefined },
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  refresh: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ push: vi.fn(), refresh }) }));

import EquipmentRequestPage from "@/app/equipment-requests/[id]/page";
import EquipmentQueuePage from "@/app/equipment-requests/page";
import { EquipmentQueueList } from "@/components/EquipmentQueueList";
import { EquipmentRequestDetail } from "@/components/EquipmentRequestDetail";
import { EquipmentRequestReview } from "@/components/EquipmentRequestReview";
import { EventEquipmentRequests } from "@/components/EventEquipmentRequests";
import type { EquipmentQueueItemView, EquipmentRequestDetailView, EquipmentRequestView } from "@/lib/equipmentRequests";
import { getEquipmentQueue, getEquipmentRequest } from "@/lib/equipmentRequestsServer";

const aQueueItem = (over: Partial<EquipmentQueueItemView> = {}): EquipmentQueueItemView => ({
  id: "req-1",
  eventId: "evt-1",
  eventName: "Tech Summit",
  eventDate: "2026-10-15",
  venueName: "Grand Hall",
  equipment: "AV: Projector Unit",
  quantity: 2,
  status: "SUBMITTED",
  statusLabel: "Submitted",
  ...over,
});

const aDetail = (over: Partial<EquipmentRequestDetailView> = {}): EquipmentRequestDetailView => ({
  ...aQueueItem(),
  startTime: "09:00",
  endTime: "17:00",
  notes: "Two on stage",
  reason: null,
  canReview: true,
  ...over,
});

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  cookieValue.current = "token-tech";
  redirect.mockClear();
  refresh.mockClear();
});

describe("SCRUM-87/AC1 see the list of requests", () => {
  it("shows event, event date, venue, equipment, quantity and status, linking to each request", () => {
    render(<EquipmentQueueList requests={[aQueueItem(), aQueueItem({ id: "req-2", venueName: null, statusLabel: "Under Review" })]} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "Tech Summit",
      "2026-10-15",
      "Grand Hall",
      "AV: Projector Unit",
      "2",
      "Submitted",
    ]);
    expect(within(rows[1]).getAllByRole("cell")[2].textContent).toBe("No venue");
    expect(within(rows[1]).getByRole("link", { name: "Tech Summit" }).getAttribute("href")).toBe("/equipment-requests/req-2");
  });
});

describe("SCRUM-87/AC2 empty list", () => {
  it("says 'No requests waiting for action'", () => {
    render(<EquipmentQueueList requests={[]} />);
    expect(screen.getByText("No requests waiting for action")).toBeTruthy();
  });
});

describe("SCRUM-87/AC3 see request details", () => {
  it("shows event name, event date, start and end time, venue, equipment, quantity, notes and status", () => {
    render(<EquipmentRequestDetail request={aDetail()} />);

    expect(screen.getByRole("heading", { name: "AV: Projector Unit" })).toBeTruthy();
    expect(screen.getByText("Submitted")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tech Summit" }).getAttribute("href")).toBe("/events/evt-1");
    for (const text of ["2026-10-15", "09:00–17:00", "Grand Hall", "2", "Two on stage"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it("shows 'No venue', 'None' for no notes, and the reason once it cannot be fulfilled", () => {
    render(<EquipmentRequestDetail request={aDetail({ venueName: null, notes: null, reason: "All out on loan" })} />);
    expect(screen.getByText("No venue")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Why it cannot be fulfilled" })).toBeTruthy();
    expect(screen.getByText("All out on loan")).toBeTruthy();
  });
});

describe("SCRUM-87/AC4 update the status", () => {
  const statusSelect = () => screen.getByLabelText("New status") as HTMLSelectElement;
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Save status" }));

  it("offers Under Review, Arranged and Cannot Fulfil, leaving out the status it already has", () => {
    const { unmount } = render(<EquipmentRequestReview request={aDetail()} />);
    expect([...statusSelect().options].map((o) => o.text)).toEqual(["Choose the new status", "Under Review", "Arranged", "Cannot Fulfil"]);
    unmount();

    render(<EquipmentRequestReview request={aDetail({ status: "UNDER_REVIEW" })} />);
    expect([...statusSelect().options].map((o) => o.text)).toEqual(["Choose the new status", "Arranged", "Cannot Fulfil"]);
  });

  it("is not shown once the request can no longer be changed", () => {
    const { container } = render(<EquipmentRequestReview request={aDetail({ canReview: false })} />);
    expect(container.innerHTML).toBe("");
  });

  it("asks for a status before sending anything", () => {
    const fetchMock = mockServer(200, {});
    render(<EquipmentRequestReview request={aDetail()} />);
    save();

    expect(screen.getByText("Choose the new status.")).toBeTruthy();
    expect(statusSelect().getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the new status to equipment-service and refreshes the page, where it shows", async () => {
    const fetchMock = mockServer(200, aDetail({ status: "ARRANGED", statusLabel: "Arranged", canReview: false }));
    render(<EquipmentRequestReview request={aDetail({ id: "req 1" })} />);
    fireEvent.change(statusSelect(), { target: { value: "ARRANGED" } });
    save();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4004/equipment-requests/req%201", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ARRANGED", reason: "" }),
    });
  });

  it("shows equipment-service's refusal, e.g. too few units free to mark it Arranged", async () => {
    const error = "Only 1 available for that period, but this request needs 2. It has not been marked Arranged.";
    mockServer(409, { code: "INSUFFICIENT", error, available: 1 });
    render(<EquipmentRequestReview request={aDetail()} />);
    fireEvent.change(statusSelect(), { target: { value: "ARRANGED" } });
    save();

    expect((await screen.findByRole("alert")).textContent).toBe(error);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows a general message when the refusal has none, and a message when the server is unreachable", async () => {
    mockServer(500, {});
    render(<EquipmentRequestReview request={aDetail()} />);
    fireEvent.change(statusSelect(), { target: { value: "UNDER_REVIEW" } });
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't save the status. Please try again.");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    save();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("We couldn't reach the server. Please try again."));
  });
});

describe("SCRUM-87/AC5 give a reason for Cannot Fulfil", () => {
  const statusSelect = () => screen.getByLabelText("New status") as HTMLSelectElement;
  const reason = () => screen.getByLabelText("Why it cannot be fulfilled") as HTMLTextAreaElement;
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Save status" }));

  it("asks for the reason only for Cannot Fulfil", () => {
    render(<EquipmentRequestReview request={aDetail()} />);
    expect(screen.queryByLabelText("Why it cannot be fulfilled")).toBeNull();
    fireEvent.change(statusSelect(), { target: { value: "CANNOT_FULFIL" } });
    expect(reason()).toBeTruthy();
    expect(screen.getByText("0/500. The Event Coordinator will see this.")).toBeTruthy();
  });

  it("does not send without a reason, and asks for one", () => {
    const fetchMock = mockServer(200, {});
    render(<EquipmentRequestReview request={aDetail()} />);
    fireEvent.change(statusSelect(), { target: { value: "CANNOT_FULFIL" } });
    fireEvent.change(reason(), { target: { value: "   " } });
    save();

    expect(screen.getByRole("alert").textContent).toBe("Give a reason why this request cannot be fulfilled.");
    expect(reason().getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the reason with the status", async () => {
    const fetchMock = mockServer(200, aDetail({ status: "CANNOT_FULFIL", statusLabel: "Cannot Fulfil", canReview: false }));
    render(<EquipmentRequestReview request={aDetail()} />);
    fireEvent.change(statusSelect(), { target: { value: "CANNOT_FULFIL" } });
    fireEvent.change(reason(), { target: { value: "All out on loan" } });
    save();

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: "CANNOT_FULFIL", reason: "All out on loan" });
  });

  it("highlights a field equipment-service refused", async () => {
    mockServer(422, { code: "VALIDATION_FAILED", error: "Some fields are invalid.", fieldErrors: { reason: "Keep the reason short." } });
    render(<EquipmentRequestReview request={aDetail()} />);
    fireEvent.change(statusSelect(), { target: { value: "CANNOT_FULFIL" } });
    fireEvent.change(reason(), { target: { value: "All out on loan" } });
    save();

    expect(await screen.findByText("Keep the reason short.")).toBeTruthy();
  });

  it("the coordinator reads the reason on the event", () => {
    const request: EquipmentRequestView = {
      id: "r1",
      equipment: "AV: Projector Unit",
      quantity: 2,
      venueName: "Grand Hall",
      notes: null,
      status: "CANNOT_FULFIL",
      statusLabel: "Cannot Fulfil",
      reason: "All out on loan",
      venueBookingId: "vb-1",
      releasedReason: null,
    };
    render(<EventEquipmentRequests eventId="evt-1" data={{ requests: [request], canCreate: false, readiness: "INCOMPLETE", readinessLabel: "Incomplete" }} />);
    const statusCell = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[4];
    expect(statusCell.textContent).toBe("Cannot FulfilReason: All out on loan");
  });
});

describe("SCRUM-87/AC6 equipment ready for the event", () => {
  it.each([
    ["COMPLETE", "Complete"],
    ["INCOMPLETE", "Incomplete"],
  ] as const)("shows equipment as %s on the event", (readiness, readinessLabel) => {
    render(<EventEquipmentRequests eventId="evt-1" data={{ requests: [], canCreate: false, readiness, readinessLabel }} />);
    expect(screen.getByText(readinessLabel).closest("p")?.textContent).toBe(`Equipment ${readinessLabel}`);
  });

  it("says nothing about readiness when no equipment was requested", () => {
    render(<EventEquipmentRequests eventId="evt-1" data={{ requests: [], canCreate: false, readiness: null, readinessLabel: null }} />);
    expect(screen.queryByText("Complete")).toBeNull();
    expect(screen.queryByText("Incomplete")).toBeNull();
  });
});

describe("SCRUM-87 the queue and request pages", () => {
  it("/equipment-requests lists the waiting requests, loaded as the signed-in user", async () => {
    const fetchMock = mockServer(200, [aQueueItem()]);
    render(await EquipmentQueuePage());

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4004/equipment-requests",
      expect.objectContaining({ headers: { cookie: "cs_session=token-tech" }, cache: "no-store" }),
    );
    expect(screen.getByRole("heading", { name: "Equipment requests" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tech Summit" })).toBeTruthy();
  });

  it("SCRUM-87/AC7 /equipment-requests shows equipment-service's refusal to anyone but Technical Support Staff", async () => {
    mockServer(403, { code: "FORBIDDEN", error: "You are not allowed to do that." });
    render(await EquipmentQueuePage());
    expect(screen.getByRole("alert").textContent).toBe("You are not allowed to do that.");
  });

  it("/equipment-requests/[id] shows the request and its status form", async () => {
    const fetchMock = mockServer(200, aDetail());
    render(await EquipmentRequestPage({ params: Promise.resolve({ id: "req-1" }) }));

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4004/equipment-requests/req-1");
    expect(screen.getByRole("heading", { name: "AV: Projector Unit" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Update status" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "← Back to equipment requests" }).getAttribute("href")).toBe("/equipment-requests");
  });

  it("/equipment-requests/[id] shows the refusal for a request that does not exist", async () => {
    mockServer(404, { code: "NOT_FOUND", error: "Equipment request not found." });
    render(await EquipmentRequestPage({ params: Promise.resolve({ id: "missing" }) }));
    expect(screen.getByRole("alert").textContent).toBe("Equipment request not found.");
  });
});

describe("SCRUM-87 equipment-service calls from the server", () => {
  it("general messages when the refusal has none, and when the service is unreachable", async () => {
    mockServer(500, {});
    expect(await getEquipmentQueue()).toEqual({ error: "We couldn't load the equipment requests." });
    expect(await getEquipmentRequest("req-1")).toEqual({ error: "We couldn't load this equipment request." });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await getEquipmentQueue()).toEqual({ error: "We couldn't reach the server. Please try again." });
    expect(await getEquipmentRequest("req-1")).toEqual({ error: "We couldn't reach the server. Please try again." });
  });

  it("not signed in (no cookie, or the service says 401) goes to the sign-in page", async () => {
    mockServer(401, {});
    await expect(getEquipmentQueue()).rejects.toThrow("redirect:/login");

    cookieValue.current = undefined;
    await expect(getEquipmentRequest("req-1")).rejects.toThrow("redirect:/login");
  });
});
