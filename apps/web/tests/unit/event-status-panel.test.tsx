import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventStatusPanel } from "@/components/EventStatusPanel";

const event = { id: "evt-1", name: "Tech Summit", status: "under_review", canChangeStatus: false };

/** Pretends event-service answered the browser's request with this status code and JSON body. */
function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Event status page", () => {
  // SCRUM-6 AC1 / SCRUM-7 AC1: the viewer sees the event's current status
  it("shows the event's name and current status", () => {
    render(<EventStatusPanel event={event} />);

    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByText("Under review")).toBeTruthy();
  });

  // SCRUM-8 AC4 + AC6: only the assigned coordinator gets the controls to change the status
  it("hides the status controls from anyone who can't change the status", () => {
    render(<EventStatusPanel event={event} />);

    expect(screen.queryByRole("combobox", { name: "New status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  // SCRUM-8 AC1 + AC2: the assigned coordinator changes the status and gets a confirmation
  it("lets the assigned coordinator change the status and confirms it", async () => {
    const fetchMock = mockServer(200, { id: "evt-1", name: "Tech Summit", status: "returned" });
    render(<EventStatusPanel event={{ ...event, canChangeStatus: true }} />);

    fireEvent.change(screen.getByRole("combobox", { name: "New status" }), { target: { value: "returned" } });
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Please add attendance." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Status updated to Returned.")).toBeTruthy();
    expect(screen.getByText("Returned", { selector: ".status-badge" })).toBeTruthy(); // the shown status updates too
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt-1/status");
    expect(options).toMatchObject({ method: "PATCH", credentials: "include" });
    expect(JSON.parse(options.body)).toEqual({ status: "returned", reason: "Please add attendance." });
  });

  // SCRUM-8 AC3/AC4/AC6: when the server refuses, the coordinator sees why
  it("shows the server's message when the change is refused", async () => {
    mockServer(403, { error: "Only the coordinator assigned to this event can change its status." });
    render(<EventStatusPanel event={{ ...event, canChangeStatus: true }} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Only the coordinator assigned to this event can change its status.")).toBeTruthy();
    expect(screen.getByText("Under review", { selector: ".status-badge" })).toBeTruthy(); // the shown status stays the same
  });
});
