// SCRUM-56/AC3 (independent review): dismissing the confirmation any way other than Delete sends nothing, and a failed delete keeps the draft listed

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { MyEventRequestsTable } from "@/components/MyEventRequestsTable";

const draft = { id: "evt-1", name: "Tech Summit", status: "draft", preferred_start_datetime: null, expected_attendance: null, submitted_at: null };

afterEach(() => { vi.unstubAllGlobals(); router.refresh.mockClear(); });

describe("SCRUM-56/AC3 dismissing the confirmation", () => {
  it("Escape while idle closes the dialog and sends nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<MyEventRequestsTable requests={[draft]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete draft Tech Summit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete draft Tech Summit" })).toBeTruthy();
  });
});

describe("SCRUM-56/AC1 a failed delete", () => {
  it("shows the reason, does not refresh, and the draft is still listed after cancelling", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "Could not delete the draft." }) }));
    render(<MyEventRequestsTable requests={[draft]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete draft Tech Summit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Could not delete the draft.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete draft Tech Summit" })).toBeTruthy();
  });
});
