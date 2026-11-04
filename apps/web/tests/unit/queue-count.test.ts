import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_URL } from "@/lib/api";
import { fetchQueueCount } from "@/lib/queueCount";

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-178/AC3 reading a queue's size from the browser", () => {
  it("SCRUM-178/AC3 counts the list the queue answers with, sending the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{}, {}] });
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchQueueCount("safetyQueue")).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(`${EVENT_URL}/safety-checks`, { credentials: "include", cache: "no-store" });
  });
});

describe("SCRUM-178/AC4 a count that cannot be read is unknown", () => {
  it.each([
    ["the queue refuses", vi.fn().mockResolvedValue({ ok: false, json: async () => [{}] })],
    ["the answer is not a list", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ length: 3 }) })],
    ["the service cannot be reached", vi.fn().mockRejectedValue(new Error("down"))],
  ])("SCRUM-178/AC4 gives no number when %s", async (_case, fetchMock) => {
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchQueueCount("bookingQueue")).toBeUndefined();
  });
});
