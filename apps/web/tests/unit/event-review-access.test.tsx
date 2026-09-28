import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventReview } from "@/components/EventReview";

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
      return Response.json({ id: "allowed" });
    });
    render(<EventReview requestId="allowed" />);
    expect(await screen.findByText("You have access to this request.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not reuse an allowed decision after the request ID changes", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ id: "allowed" }));
    const view = render(<EventReview requestId="allowed" />);
    await screen.findByText("You have access to this request.");
    vi.stubGlobal("fetch", async () => Response.json({}, { status: 404 }));
    view.rerender(<EventReview requestId="denied" />);
    expect(screen.queryByText("You have access to this request.")).toBeNull();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
  it("fails closed when the service cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    render(<EventReview requestId="request" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not verify access");
    expect(screen.queryByText("You have access to this request.")).toBeNull();
  });
});
