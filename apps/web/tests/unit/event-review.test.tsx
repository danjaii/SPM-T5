import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventReview } from "@/components/EventReview";

const detail = {
  id: "10000000-0000-4000-8000-000000000001", organiser_name: "Jason Chua",
  name: "Community workshop", purpose: "Learn together",
  preferred_start_datetime: "2026-10-01T01:00:00Z", preferred_end_datetime: "2026-10-01T03:00:00Z",
  expected_attendance: 25, layout_preferences: "Classroom", accessibility_requirements: "Step-free access",
  equipment_requirements_notes: "Projector", submitted_at: "2026-09-28T02:00:00Z", status: "submitted",
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function respond(body: unknown, status = 200) {
  vi.stubGlobal("fetch", async (_url: unknown, options: RequestInit) =>
    options.credentials === "include" ? Response.json(body, { status }) : Response.json({}, { status: 401 }));
}
describe("ER-01 — submitted request page", () => {
  it("AC1 links the submitted request list to the selected detail page", async () => {
    respond([detail]);
    render(<EventReview />);
    const link = await screen.findByRole("link", { name: "Community workshop" });
    expect(link.getAttribute("href")).toBe(`/event-review/requests/${detail.id}`);
  });
  it("AC2 displays every required detail and dates in Singapore time", async () => {
    respond(detail);
    render(<EventReview requestId={detail.id} />);
    await screen.findByRole("heading", { name: "Community workshop" });
    for (const text of ["Jason Chua", "Learn together", "25", "Classroom", "Step-free access", "Projector", "Submitted"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getByText(/01 Oct 2026, 09:00/)).toBeTruthy();
    expect(screen.getByText(/01 Oct 2026, 11:00/)).toBeTruthy();
    expect(screen.getByText(/28 Sept 2026, 10:00/)).toBeTruthy();
  });
  it("AC3 shows absent optional details clearly and preserves zero attendance", async () => {
    respond({ ...detail, purpose: null, layout_preferences: null, accessibility_requirements: null,
      equipment_requirements_notes: null, expected_attendance: 0 });
    render(<EventReview requestId={detail.id} />);
    await screen.findByRole("heading", { name: "Community workshop" });
    expect(screen.getAllByText("Not provided")).toHaveLength(4);
    expect(screen.getByText("0")).toBeTruthy();
  });
  it("AC4 never displays details when the service denies access", async () => {
    respond({ error: "Request not found or access denied." }, 404);
    render(<EventReview requestId={detail.id} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Jason Chua")).toBeNull();
  });
  it("AC4 offers sign-in when the session expires", async () => {
    respond({}, 401);
    render(<EventReview />);
    expect((await screen.findByRole("link", { name: "Sign in" })).getAttribute("href")).toBe("/login");
  });
  it("shows an empty state when no submitted requests are assigned", async () => {
    respond([]);
    render(<EventReview />);
    expect(await screen.findByText("No submitted requests are assigned to you.")).toBeTruthy();
  });
  it("allows retry after a network failure", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    render(<EventReview />);
    const alert = await screen.findByRole("alert");
    respond([detail]);
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Community workshop" })).toBeTruthy();
  });
});
