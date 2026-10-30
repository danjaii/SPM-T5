import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportingDocuments } from "@/components/event-request/SupportingDocuments";

const EVENT = "11111111-1111-4111-8111-111111111111";
type Reply = { status: number; body: unknown };

const stored = (id: string, name: string, size = 2048) => ({
  id, event_id: EVENT, file_name: name, storage_path: `${EVENT}/x/${name}`, content_type: "application/pdf", size_bytes: size,
  created_at: "2031-01-01T00:00:00.000Z",
});

/**
 * Fakes event-service and storage. `list` answers GET /request-attachments each time (the last repeats); `routes` overrides the
 * reply for any URL containing a key (matched together with the method as "METHOD fragment").
 */
function mockServer(list: Reply[], routes: Record<string, Reply> = {}) {
  let gets = 0;
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body });
    const key = Object.keys(routes).find((k) => `${method} ${url}`.includes(k));
    const reply = key ? routes[key] : method === "GET" ? list[Math.min(gets++, list.length - 1)] : { status: 200, body: {} };
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const pdf = (name = "floor plan.pdf", size = 1024) => {
  const file = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};
const choose = (files: File[]) => fireEvent.change(screen.getByLabelText(/add documents/i), { target: { files } });

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-51/AC1 upload a supporting document", () => {
  it("lists the documents already attached to the request", async () => {
    mockServer([{ status: 200, body: { attachments: [stored("a1", "programme.pdf")] } }]);
    render(<SupportingDocuments eventId={EVENT} />);

    const list = await screen.findByRole("list", { name: /supporting documents/i });
    expect(within(list).getByText("programme.pdf")).toBeTruthy();
  });

  it("says there are none yet when nothing is attached", async () => {
    mockServer([{ status: 200, body: { attachments: [] } }]);
    render(<SupportingDocuments eventId={EVENT} />);

    expect(await screen.findByText(/no documents attached yet/i)).toBeTruthy();
  });

  it("uploads a chosen file (URL, then the file, then registering it) and lists it alongside the request", async () => {
    const server = mockServer(
      [{ status: 200, body: { attachments: [] } }, { status: 200, body: { attachments: [stored("a1", "floor plan.pdf", 1024)] } }],
      {
        "POST http://localhost:4002/events/drafts": { status: 200, body: { upload_url: "https://storage.test/u", storage_path: `${EVENT}/x/floor_plan.pdf` } },
        "PUT https://storage.test/u": { status: 200, body: {} },
        [`POST http://localhost:4002/events/drafts/${EVENT}/attachments`]: { status: 201, body: stored("a1", "floor plan.pdf", 1024) },
      },
    );
    render(<SupportingDocuments eventId={EVENT} />);
    await screen.findByText(/no documents attached yet/i);

    choose([pdf()]);

    const list = await screen.findByRole("list", { name: /supporting documents/i });
    expect(within(list).getByText("floor plan.pdf")).toBeTruthy();
    const urlCall = server.calls.find((c) => c.url.endsWith("/attachments/upload-url"));
    expect(urlCall?.body).toEqual({ file_name: "floor plan.pdf", content_type: "application/pdf", size: 1024 });
    expect(server.calls.some((c) => c.method === "PUT" && c.url === "https://storage.test/u")).toBe(true);
    expect(server.calls.find((c) => c.method === "POST" && c.url.endsWith(`/drafts/${EVENT}/attachments`))?.body).toEqual({
      file_name: "floor plan.pdf", storage_path: `${EVENT}/x/floor_plan.pdf`, content_type: "application/pdf", size: 1024,
    });
  });

  it("tells the organiser when the file could not be sent to storage, and lists nothing new", async () => {
    mockServer([{ status: 200, body: { attachments: [] } }], {
      "POST http://localhost:4002/events/drafts": { status: 200, body: { upload_url: "https://storage.test/u", storage_path: `${EVENT}/x/a.pdf` } },
      "PUT https://storage.test/u": { status: 500, body: {} },
    });
    render(<SupportingDocuments eventId={EVENT} />);
    await screen.findByText(/no documents attached yet/i);

    choose([pdf("a.pdf")]);

    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't upload a\.pdf/i);
    expect(screen.getByText(/no documents attached yet/i)).toBeTruthy();
  });

  it("shows the service's message when it refuses the upload (for example the request was submitted)", async () => {
    mockServer([{ status: 200, body: { attachments: [] } }], {
      "POST http://localhost:4002/events/drafts": { status: 409, body: { code: "NOT_A_DRAFT", error: "This request has been submitted." } },
    });
    render(<SupportingDocuments eventId={EVENT} />);
    await screen.findByText(/no documents attached yet/i);

    choose([pdf()]);

    expect((await screen.findByRole("alert")).textContent).toContain("This request has been submitted.");
  });

  it("tells the organiser when the list cannot be loaded", async () => {
    mockServer([{ status: 500, body: { error: "Server error." } }]);
    render(<SupportingDocuments eventId={EVENT} />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't load the documents/i);
  });

  it("says the server could not be reached when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    render(<SupportingDocuments eventId={EVENT} />);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/couldn't load the documents/i));
  });
});

describe("SCRUM-51/AC2 a file of an unsupported type is rejected and the accepted types are shown", () => {
  const zip = () => new File(["x"], "all.zip", { type: "application/zip" });

  it("turns the file away before uploading, naming the accepted types, and attaches nothing", async () => {
    const server = mockServer([{ status: 200, body: { attachments: [] } }]);
    render(<SupportingDocuments eventId={EVENT} />);
    await screen.findByText(/no documents attached yet/i);

    choose([zip()]);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("all.zip");
    expect(alert.textContent).toContain("This file type is not supported");
    expect(alert.textContent).toContain("PDF");
    expect(server.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("still uploads the acceptable files chosen together with an unsupported one", async () => {
    const server = mockServer([{ status: 200, body: { attachments: [] } }], {
      "POST http://localhost:4002/events/drafts": { status: 200, body: { upload_url: "https://storage.test/u", storage_path: `${EVENT}/x/a.pdf` } },
    });
    render(<SupportingDocuments eventId={EVENT} />);
    await screen.findByText(/no documents attached yet/i);

    choose([zip(), pdf("a.pdf")]);

    await waitFor(() => expect(server.calls.some((c) => c.url.endsWith("/attachments/upload-url"))).toBe(true));
    expect((await screen.findByRole("alert")).textContent).toContain("all.zip");
    expect(server.calls.filter((c) => c.url.endsWith("/attachments/upload-url"))).toHaveLength(1);
  });

  it("shows the accepted types up front, and the file picker offers only them", async () => {
    mockServer([{ status: 200, body: { attachments: [] } }]);
    render(<SupportingDocuments eventId={EVENT} />);

    expect((await screen.findByText(/accepted:/i)).textContent).toContain("PDF");
    expect(screen.getByLabelText(/add documents/i).getAttribute("accept")).toContain("application/pdf");
  });

  it("shows the service's own refusal of a type (400) when the file got past the form's check", async () => {
    mockServer([{ status: 200, body: { attachments: [] } }], {
      "POST http://localhost:4002/events/drafts": { status: 400, body: { code: "FILE_TYPE_NOT_ACCEPTED", error: "This file type is not supported. Accepted: PDF." } },
    });
    render(<SupportingDocuments eventId={EVENT} />);
    await screen.findByText(/no documents attached yet/i);

    choose([pdf()]);

    expect((await screen.findByRole("alert")).textContent).toContain("Accepted: PDF.");
  });
});

describe("SCRUM-51/AC3 a file over the size limit is rejected and the maximum size is shown", () => {
  const TEN_MB = 10 * 1024 * 1024;

  it("turns a file over 10 MB away before uploading, naming the 10 MB limit, and attaches nothing", async () => {
    const server = mockServer([{ status: 200, body: { attachments: [] } }]);
    render(<SupportingDocuments eventId={EVENT} />);
    await screen.findByText(/no documents attached yet/i);

    choose([pdf("huge.pdf", TEN_MB + 1)]);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("huge.pdf");
    expect(alert.textContent).toContain("10 MB");
    expect(server.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("accepts a file of exactly 10 MB", async () => {
    const server = mockServer([{ status: 200, body: { attachments: [] } }]);
    render(<SupportingDocuments eventId={EVENT} />);
    await screen.findByText(/no documents attached yet/i);

    choose([pdf("exact.pdf", TEN_MB)]);

    await waitFor(() => expect(server.calls.some((c) => c.url.endsWith("/attachments/upload-url"))).toBe(true));
  });

  it("states the maximum size up front", async () => {
    mockServer([{ status: 200, body: { attachments: [] } }]);
    render(<SupportingDocuments eventId={EVENT} />);

    expect((await screen.findByText(/accepted:/i)).textContent).toContain("10 MB");
  });

  it("shows the service's own refusal of a size (400) when the file got past the form's check", async () => {
    mockServer([{ status: 200, body: { attachments: [] } }], {
      "POST http://localhost:4002/events/drafts": { status: 400, body: { code: "FILE_TOO_LARGE", error: "This file is larger than the 10 MB limit." } },
    });
    render(<SupportingDocuments eventId={EVENT} />);
    await screen.findByText(/no documents attached yet/i);

    choose([pdf()]);

    expect((await screen.findByRole("alert")).textContent).toContain("10 MB");
  });
});

describe("SCRUM-51/AC4 remove an attachment from a request not yet submitted", () => {
  const listed = () => [{ status: 200, body: { attachments: [stored("a1", "programme.pdf"), stored("a2", "floor plan.pdf")] } }];

  it("deletes the chosen attachment and drops it from the list, leaving the others", async () => {
    const server = mockServer(
      [...listed(), { status: 200, body: { attachments: [stored("a2", "floor plan.pdf")] } }],
      { "DELETE": { status: 200, body: { removed: true, fileRemoved: true } } },
    );
    render(<SupportingDocuments eventId={EVENT} />);
    const list = await screen.findByRole("list", { name: /supporting documents/i });

    fireEvent.click(within(list).getByRole("button", { name: "Remove programme.pdf" }));

    await waitFor(() => expect(screen.queryByText("programme.pdf")).toBeNull());
    expect(screen.getByText("floor plan.pdf")).toBeTruthy();
    expect(server.calls.find((c) => c.method === "DELETE")?.url).toBe(`http://localhost:4002/events/drafts/${EVENT}/attachments/a1`);
  });

  it("keeps the attachment and says why when the request has been submitted in the meantime", async () => {
    mockServer(listed(), {
      "DELETE": { status: 409, body: { code: "NOT_A_DRAFT", error: "This request has been submitted, so files can no longer be removed." } },
    });
    render(<SupportingDocuments eventId={EVENT} />);
    const list = await screen.findByRole("list", { name: /supporting documents/i });

    fireEvent.click(within(list).getByRole("button", { name: "Remove programme.pdf" }));

    expect((await screen.findByRole("alert")).textContent).toContain("can no longer be removed");
    expect(screen.getByText("programme.pdf")).toBeTruthy();
  });

  it("offers no Remove button when the panel is read-only (a submitted request)", async () => {
    mockServer(listed());
    render(<SupportingDocuments eventId={EVENT} readOnly />);
    await screen.findByRole("list", { name: /supporting documents/i });

    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    expect(screen.queryByLabelText(/add documents/i)).toBeNull();
  });
});

describe("SCRUM-51 panel edge cases", () => {
  it("shows a size in MB for a large file and in KB for a small one", async () => {
    mockServer([{ status: 200, body: { attachments: [stored("a1", "big.pdf", 5 * 1024 * 1024), stored("a2", "small.pdf", 100)] } }]);
    render(<SupportingDocuments eventId={EVENT} />);

    await screen.findByText("big.pdf");
    expect(screen.getByText("5.0 MB")).toBeTruthy();
    expect(screen.getByText("1 KB")).toBeTruthy();
  });

  it("falls back to a plain message when the service gives none (upload URL, attach and remove)", async () => {
    mockServer([{ status: 200, body: { attachments: [stored("a1", "programme.pdf")] } }], {
      "POST http://localhost:4002/events/drafts": { status: 500, body: {} },
      "DELETE": { status: 500, body: {} },
    });
    render(<SupportingDocuments eventId={EVENT} />);
    const list = await screen.findByRole("list", { name: /supporting documents/i });

    choose([pdf("a.pdf")]);
    expect((await screen.findByRole("alert")).textContent).toContain("We couldn't attach it.");

    fireEvent.click(within(list).getByRole("button", { name: "Remove programme.pdf" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes("We couldn't remove it."))).toBe(true));
  });

  it("falls back to a plain message when attaching fails after the upload", async () => {
    mockServer([{ status: 200, body: { attachments: [] } }], {
      "POST http://localhost:4002/events/drafts/11111111-1111-4111-8111-111111111111/attachments/upload-url": {
        status: 200, body: { upload_url: "https://storage.test/u", storage_path: `${EVENT}/x/a.pdf` },
      },
      [`POST http://localhost:4002/events/drafts/${EVENT}/attachments`]: { status: 500, body: {} },
    });
    render(<SupportingDocuments eventId={EVENT} />);
    await screen.findByText(/no documents attached yet/i);

    choose([pdf("a.pdf")]);

    expect((await screen.findByRole("alert")).textContent).toContain("a.pdf: We couldn't attach it.");
  });

  it("does nothing when the file picker is closed without a file", async () => {
    const server = mockServer([{ status: 200, body: { attachments: [] } }]);
    render(<SupportingDocuments eventId={EVENT} />);
    await screen.findByText(/no documents attached yet/i);

    fireEvent.change(screen.getByLabelText(/add documents/i), { target: { files: null } });

    expect(server.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});

// Added after the independent review: two valid files chosen together are both uploaded and registered
describe("SCRUM-51/AC1 several files at once", () => {
  it("prepares, sends and registers each file chosen together, one after the other", async () => {
    const { calls } = mockServer([{ status: 200, body: { attachments: [] } }, { status: 200, body: { attachments: [stored("a", "one.pdf"), stored("b", "two.pdf")] } }], {
      [`POST http://localhost:4002/events/drafts/${EVENT}/attachments/upload-url`]: { status: 200, body: { upload_url: "http://storage.test/put", storage_path: `${EVENT}/x/f.pdf` } },
      "PUT http://storage.test/put": { status: 200, body: {} },
    });
    render(<SupportingDocuments eventId={EVENT} />);
    await screen.findByText("No documents attached yet.");

    choose([pdf("one.pdf"), pdf("two.pdf")]);

    await waitFor(() => expect(screen.getByText("two.pdf")).toBeTruthy());
    expect(screen.getByText("one.pdf")).toBeTruthy();
    const uploads = calls.filter((c) => c.url.endsWith("/attachments/upload-url"));
    const registers = calls.filter((c) => c.method === "POST" && c.url.endsWith(`/events/drafts/${EVENT}/attachments`));
    expect(uploads.map((c) => (c.body as { file_name: string }).file_name)).toEqual(["one.pdf", "two.pdf"]);
    expect(registers.map((c) => (c.body as { file_name: string }).file_name)).toEqual(["one.pdf", "two.pdf"]);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(2);
  });
});
