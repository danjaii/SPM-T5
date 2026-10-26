// SCRUM-56 — an organiser deletes a draft from My event requests

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { MyEventRequestsTable } from "@/components/MyEventRequestsTable";
import { EVENT_URL } from "@/lib/api";
import type { MyEventRequest } from "@/lib/myEventRequests";

const request = (over: Partial<MyEventRequest> = {}): MyEventRequest => ({
  id: "evt-1",
  name: "Tech Summit",
  status: "draft",
  preferred_start_datetime: null,
  expected_attendance: null,
  submitted_at: null,
  ...over,
});

/** event-service's answer to DELETE /events/drafts/:id: 204 has no body. */
function mockDelete(status: number, body?: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Chooses Delete on a draft's row; the confirmation dialog (SCRUM-56/AC3) opens. */
async function chooseDelete(name = "Tech Summit") {
  fireEvent.click(screen.getByRole("button", { name: `Delete draft ${name}` }));
  return screen.findByRole("dialog", { name: "Delete this draft?" });
}

/** Chooses Delete on a draft's row and confirms. */
async function deleteAndConfirm(name = "Tech Summit") {
  const dialog = await chooseDelete(name);
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  return dialog;
}

beforeEach(() => router.refresh.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-56/AC1 deleting a draft from My event requests", () => {
  it("SCRUM-56/AC1 deletes the draft through event-service as the signed-in user and reloads the list", async () => {
    const fetchMock = mockDelete(204);
    render(<MyEventRequestsTable requests={[request()]} />);

    await deleteAndConfirm();

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(`${EVENT_URL}/events/drafts/evt-1`, { method: "DELETE", credentials: "include" });
  });

  it("SCRUM-56/AC1 encodes the id in the address", async () => {
    const fetchMock = mockDelete(204);
    render(<MyEventRequestsTable requests={[request({ id: "a/b" })]} />);

    await deleteAndConfirm();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(`${EVENT_URL}/events/drafts/a%2Fb`);
  });

  it("SCRUM-56/AC1 shows event-service's reason and does not reload when the delete fails", async () => {
    mockDelete(409, { code: "NOT_A_DRAFT", error: "This request has been submitted, so it can no longer be deleted." });
    render(<MyEventRequestsTable requests={[request()]} />);

    const dialog = await deleteAndConfirm();

    expect((await within(dialog).findByRole("alert")).textContent).toBe("This request has been submitted, so it can no longer be deleted.");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("SCRUM-56/AC1 says so, rather than failing silently, when event-service cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<MyEventRequestsTable requests={[request()]} />);

    const dialog = await deleteAndConfirm();

    expect((await within(dialog).findByRole("alert")).textContent).toBe("We couldn't reach the server. Please try again.");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("SCRUM-56/AC1 falls back to a plain message when the error has no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError("no json"); } });
    vi.stubGlobal("fetch", fetchMock);
    render(<MyEventRequestsTable requests={[request()]} />);

    const dialog = await deleteAndConfirm();

    expect((await within(dialog).findByRole("alert")).textContent).toBe("Could not delete the draft.");
  });

  it("SCRUM-56/AC1 shows progress and sends the delete only once while it is under way", async () => {
    let finish: (value: unknown) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(new Promise((resolve) => (finish = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    render(<MyEventRequestsTable requests={[request()]} />);

    const dialog = await deleteAndConfirm();

    const button = await within(dialog).findByRole("button", { name: "Deleting…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    finish({ ok: true, status: 204, json: async () => undefined });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });
});

describe("SCRUM-56/AC3 confirmation prompt", () => {
  it("SCRUM-56/AC3 asks the organiser to confirm, naming the draft and saying it cannot be undone, before anything is sent", async () => {
    const fetchMock = mockDelete(204);
    render(<MyEventRequestsTable requests={[request()]} />);

    const dialog = await chooseDelete();

    expect(dialog.textContent).toContain("Tech Summit");
    expect(dialog.textContent).toContain("This can't be undone");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("SCRUM-56/AC3 closes on Cancel without sending anything, and the draft stays in the list", async () => {
    const fetchMock = mockDelete(204);
    render(<MyEventRequestsTable requests={[request()]} />);
    const dialog = await chooseDelete();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete draft Tech Summit" })).toBeTruthy();
  });

  it("SCRUM-56/AC3 closes the dialog once the draft is deleted", async () => {
    mockDelete(204);
    render(<MyEventRequestsTable requests={[request()]} />);

    await deleteAndConfirm();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("SCRUM-56/AC3 keeps the dialog open with the reason when the delete fails, and Cancel still works", async () => {
    mockDelete(404, { error: "Draft not found." });
    render(<MyEventRequestsTable requests={[request()]} />);

    const dialog = await deleteAndConfirm();

    expect((await within(dialog).findByRole("alert")).textContent).toBe("Draft not found.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("SCRUM-56/AC3 cannot be dismissed with Escape while the delete is under way", async () => {
    let finish: (value: unknown) => void = () => {};
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((resolve) => (finish = resolve))));
    render(<MyEventRequestsTable requests={[request()]} />);
    const dialog = await deleteAndConfirm();
    await within(dialog).findByRole("button", { name: "Deleting…" });

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "Delete this draft?" })).toBeTruthy();
    finish({ ok: true, status: 204, json: async () => undefined });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("SCRUM-56/AC3 starts clean when the dialog is opened again after a failure", async () => {
    mockDelete(500, { error: "Could not delete the draft." });
    render(<MyEventRequestsTable requests={[request()]} />);
    const first = await deleteAndConfirm();
    await within(first).findByRole("alert");
    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const second = await chooseDelete();

    expect(within(second).queryByRole("alert")).toBeNull();
  });
});

describe("SCRUM-56/AC2 only drafts have a Delete control", () => {
  it("SCRUM-56/AC2 offers Delete on a draft", () => {
    render(<MyEventRequestsTable requests={[request()]} />);
    expect(screen.getByRole("button", { name: "Delete draft Tech Summit" })).toBeTruthy();
  });

  it.each(["submitted", "under_review", "returned", "approved", "planning", "confirmed", "completed", "cancelled", "rejected", "something_new"])(
    "SCRUM-56/AC2 offers no Delete at all on a %s request",
    (status) => {
      render(<MyEventRequestsTable requests={[request({ status, submitted_at: "2031-01-01T00:00:00Z" })]} />);
      const row = screen.getByRole("row", { name: /Tech Summit/ });
      expect(within(row).queryByRole("button")).toBeNull();
      expect(row.textContent).not.toMatch(/delete/i);
    },
  );

  it("SCRUM-56/AC2 shows Delete only on the draft rows of a mixed list, and names each draft", () => {
    render(
      <MyEventRequestsTable
        requests={[
          request({ id: "evt-1", name: "Draft A" }),
          request({ id: "evt-2", name: "Sent B", status: "submitted" }),
          request({ id: "evt-3", name: "Draft C" }),
        ]}
      />,
    );

    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Delete draft Draft A", "Delete draft Draft C"]);
  });
});
