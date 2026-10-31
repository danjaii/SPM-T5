import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-123" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import { getDraftForEdit } from "@/lib/eventRequestsServer";

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => { cookieValue.current = "token-123"; redirect.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-54/AC1 loading a draft to edit", () => {
  it("asks event-service for that draft as the signed-in organiser", async () => {
    const draft = { id: "d1", name: "Half", status: "draft" };
    const fetchMock = mockServer(200, draft);
    await expect(getDraftForEdit("d1")).resolves.toEqual({ draft });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/drafts/d1");
    expect(options.headers.cookie).toBe("cs_session=token-123");
  });

  it("escapes the id in the address", async () => {
    const fetchMock = mockServer(200, { id: "x" });
    await getDraftForEdit("a/b?c");
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4002/events/drafts/a%2Fb%3Fc");
  });

  it("sends someone who is signed out, or whose session expired, to sign in", async () => {
    cookieValue.current = undefined;
    mockServer(200, {});
    await expect(getDraftForEdit("d1")).rejects.toThrow("redirect:/login");
    cookieValue.current = "t";
    mockServer(401, {});
    await expect(getDraftForEdit("d1")).rejects.toThrow("redirect:/login");
  });

  it.each([[404, "Event not found."], [409, "This request has been submitted and can no longer be edited as a draft."], [403, "You are not allowed to create event requests."]])(
    "passes on the server's reason for a %s", async (status, error) => {
      mockServer(status, { error });
      await expect(getDraftForEdit("d1")).resolves.toEqual({ error });
    },
  );

  it("gives a plain message when the server cannot be reached or answers with something that is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await getDraftForEdit("d1")).toEqual({ error: "We couldn't reach the server. Please try again." });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error("x"); } }));
    expect(await getDraftForEdit("d1")).toEqual({ error: "We couldn't open the draft. Please try again." });
  });
});
