// SCRUM-97/AC1, AC7: Venue Staff set, extend or shorten a pending request's expiry from the request page

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { HoldExpiryForm } from "@/components/HoldExpiryForm";

afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });

const reply = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
const typeExpiry = (v: string) => fireEvent.change(screen.getByLabelText("Hold expires"), { target: { value: v } });

describe("SCRUM-97/AC1 setting an expiry", () => {
  it("says when there is none yet, and shows the current one in Singapore time otherwise", () => {
    const { unmount } = render(<HoldExpiryForm bookingId="b1" current={null} />);
    expect(screen.getByText("No expiry set. The hold lasts until it is decided or withdrawn.")).toBeTruthy();
    unmount();
    render(<HoldExpiryForm bookingId="b1" current="2030-11-01T09:00:00.000Z" />);
    expect(screen.getByText("Expires 2030-11-01 17:00 (Singapore time).")).toBeTruthy();
  });

  it("asks for a date and time, and sends nothing, when the box is empty", () => {
    const fetchMock = reply(200, {});
    vi.stubGlobal("fetch", fetchMock);
    render(<HoldExpiryForm bookingId="b1" current={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Save expiry" }));
    expect(screen.getByRole("alert").textContent).toContain("Choose an expiry date and time.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the Singapore time as an instant to the hold-expiry route and refreshes the page", async () => {
    const fetchMock = reply(200, { id: "b1", status: "PENDING", holdExpiresAt: "2030-11-01T09:00:00.000Z" });
    vi.stubGlobal("fetch", fetchMock);
    render(<HoldExpiryForm bookingId="b1" current={null} />);
    typeExpiry("2030-11-01T17:00");
    fireEvent.click(screen.getByRole("button", { name: "Save expiry" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:4003/venue-bookings/b1/hold-expiry");
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({ expiresAt: "2030-11-01T09:00:00.000Z" });
    expect(screen.getByRole("status").textContent).toContain("Expiry saved");
  });

  it("shows the service's reason and does not refresh when the save is refused", async () => {
    vi.stubGlobal("fetch", reply(422, { error: "Some fields are invalid.", fieldErrors: { expiresAt: "An expiry date and time in the future, before the event starts, is required" } }));
    render(<HoldExpiryForm bookingId="b1" current={null} />);
    typeExpiry("2030-11-01T17:00");
    fireEvent.click(screen.getByRole("button", { name: "Save expiry" }));
    expect((await screen.findByRole("alert")).textContent).toContain("in the future, before the event starts");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("SCRUM-97/AC7 an expired hold cannot be extended", () => {
  it("shows the hold as expired with no form, and says a new request is needed", () => {
    render(<HoldExpiryForm bookingId="b1" current="2020-01-01T00:00:00.000Z" />);
    expect(screen.getByText(/This hold expired 2020-01-01 08:00/)).toBeTruthy();
    expect(screen.getByText(/new venue request is needed/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save expiry" })).toBeNull();
  });
});
