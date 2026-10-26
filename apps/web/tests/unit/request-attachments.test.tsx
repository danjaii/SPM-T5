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
