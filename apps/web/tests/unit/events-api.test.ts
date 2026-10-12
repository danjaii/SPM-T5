import { afterEach, describe, expect, it, vi } from "vitest";
import { buildReviewQueueQuery, fetchReviewQueue } from "@/lib/eventsApi";
import { ApiError, ForbiddenError, UnauthorizedError } from "@/lib/http";

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-22/AC4 — status filter query", () => {
  it("sends each selected status", () => {
    expect(buildReviewQueueQuery({ statuses: ["submitted", "approved"] })).toBe("?status=submitted&status=approved");
  });
});

describe("SCRUM-22/AC3 + AC5 — search and date range query", () => {
  it("adds a trimmed search and the from/to dates", () => {
    expect(buildReviewQueueQuery({ statuses: ["submitted"], search: "  gala ", from: "2026-01-01", to: "2026-02-01" })).toBe(
      "?status=submitted&search=gala&from=2026-01-01&to=2026-02-01",
    );
  });

  it("leaves out blank search and dates", () => {
    expect(buildReviewQueueQuery({ statuses: ["submitted"], search: "  ", from: "", to: "" })).toBe("?status=submitted");
  });
});

describe("SCRUM-22/AC1 — fetchReviewQueue", () => {
  it("calls GET /events with the session cookie and returns the rows", async () => {
    const rows = [{ id: "1", name: "Gala", status: "submitted", submitted_at: null, organiser_name: "Sam" }];
    const fetchMock = respond(200, rows);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchReviewQueue({ statuses: ["submitted"] })).resolves.toEqual(rows);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4002/events?status=submitted",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("throws UnauthorizedError on 401", async () => {
    vi.stubGlobal("fetch", respond(401, { error: "Not signed in." }));
    await expect(fetchReviewQueue({ statuses: ["submitted"] })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ForbiddenError with the server's message on 403", async () => {
    vi.stubGlobal("fetch", respond(403, { error: "You are not allowed to view submitted event requests." }));
    const failure = fetchReviewQueue({ statuses: ["submitted"] });
    await expect(failure).rejects.toBeInstanceOf(ForbiddenError);
    await expect(failure).rejects.toMatchObject({
      status: 403,
      message: "You are not allowed to view submitted event requests.",
    });
  });

  it("throws an ApiError when the service cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const failure = fetchReviewQueue({ statuses: ["submitted"] });
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 0 });
  });
});
