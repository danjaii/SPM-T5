import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventReview } from "@/components/EventReview";

const detail = {
  id: "allowed", name: "Assigned event", organiser_name: "Organiser",
  purpose: "Workshop", preferred_start_datetime: "2026-10-01T01:00:00Z",
  preferred_end_datetime: "2026-10-01T03:00:00Z", expected_attendance: 25,
  layout_preferences: "Classroom", accessibility_requirements: "Step-free access",
  equipment_requirements_notes: "Projector", submitted_at: "2026-09-28T02:00:00Z", status: "submitted",
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ER-01/AC4 request access screen", () => {
  it.each([403, 404])("does not render server-supplied request details on denial %s", async (status) => {
    vi.stubGlobal("fetch", async () => Response.json({ name: "Private event", organiser_name: "Private organiser" }, { status }));
    render(<EventReview requestId="denied" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Request not found or access denied");
    expect(screen.queryByText(/Private/)).toBeNull();
  });
  it("confirms allowed access using a credentialed uncached request", async () => {
    vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
      expect(url).toBe("http://localhost:4006/review/requests/allowed");
      expect(options.credentials).toBe("include");
      expect(options.cache).toBe("no-store");
      return Response.json(detail);
    });
    render(<EventReview requestId="allowed" />);
    expect(await screen.findByRole("heading", { name: detail.name })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not reuse an allowed decision after the request ID changes", async () => {
    vi.stubGlobal("fetch", async () => Response.json(detail));
    const view = render(<EventReview requestId="allowed" />);
    await screen.findByRole("heading", { name: detail.name });
    vi.stubGlobal("fetch", async () => Response.json({}, { status: 404 }));
    view.rerender(<EventReview requestId="denied" />);
    expect(screen.queryByText(detail.name)).toBeNull();
    expect(screen.queryByText(detail.organiser_name)).toBeNull();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
  it("fails closed when the service cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    render(<EventReview requestId="request" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not verify access");
    expect(screen.queryByText(detail.name)).toBeNull();
  });
});
