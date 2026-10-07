import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMENT_REQUIRED, EventComments, NO_COMMENTS } from "@/components/EventComments";

type Reply = { status: number; body: unknown };

/** Fakes event-service: GET /comments answers with each of `threads` in turn (the last one repeats), POST with `post`. */
function mockEventService(threads: Reply[], post?: Reply | "offline") {
  let gets = 0;
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (post === "offline") throw new TypeError("Failed to fetch");
      return { ok: post!.status < 400, status: post!.status, json: async () => post!.body };
    }
    const reply = threads[Math.min(gets++, threads.length - 1)];
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const comment = (id: string, author: string, body: string, created_at: string) => ({
  id,
  body,
  created_at,
  parent_comment_id: null,
  author_name: author,
  mentions: [],
  attachments: [],
});

const FIRST = comment("c1", "Rachel Tan", "Can you confirm the headcount?", "2026-09-01T02:00:00Z");
const SECOND = comment("c2", "Olivia Org", "Yes, 120 people.", "2026-09-01T03:30:00Z");

const thread = (comments: unknown[], can_comment = true): Reply => ({ status: 200, body: { can_comment, comments } });
const posts = (fetchMock: ReturnType<typeof mockEventService>) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

const setup = () => render(<EventComments eventId="evt-1" />);
const box = () => screen.getByLabelText("Add a comment");
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const postButton = () => screen.getByRole("button", { name: "Post comment" });

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-25/AC1 — Add a comment", () => {
  it("posts the trimmed text to the event and shows it in the history", async () => {
    const fetchMock = mockEventService([thread([FIRST]), thread([FIRST, SECOND])], { status: 201, body: {} });
    setup();
    await screen.findByText(FIRST.body);

    type("  Yes, 120 people.  ");
    fireEvent.click(postButton());

    expect(await screen.findByText(SECOND.body)).toBeTruthy();
    const [url, init] = posts(fetchMock)[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4002/events/evt-1/comments");
    expect(JSON.parse(init.body as string)).toEqual({ body: "Yes, 120 people." });
    expect((box() as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps the text and shows the server's message when posting fails", async () => {
    mockEventService([thread([])], { status: 403, body: { error: "You are not allowed to comment on this event." } });
    setup();
    await screen.findByText(NO_COMMENTS);

    type("Hello");
    fireEvent.click(postButton());

    expect((await screen.findByRole("alert")).textContent).toBe("You are not allowed to comment on this event.");
    expect((box() as HTMLTextAreaElement).value).toBe("Hello");
  });

  it("falls back to a generic message when the server gives none", async () => {
    mockEventService([thread([])], { status: 500, body: {} });
    setup();
    await screen.findByText(NO_COMMENTS);

    type("Hello");
    fireEvent.click(postButton());

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't post your comment. Please try again.");
  });

  it("says so when event-service can't be reached", async () => {
    mockEventService([thread([])], "offline");
    setup();
    await screen.findByText(NO_COMMENTS);

    type("Hello");
    fireEvent.click(postButton());

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't reach the server. Please try again.");
  });
});

describe("SCRUM-25/AC2 — Display comment details", () => {
  it("shows each comment's author, date and time, and text", async () => {
    mockEventService([thread([FIRST])]);
    setup();

    const item = within(await screen.findByRole("listitem"));
    expect(item.getByText("Rachel Tan")).toBeTruthy();
    expect(item.getByText("Can you confirm the headcount?")).toBeTruthy();
    // 02:00 UTC is 10:00 in Singapore
    const time = item.getByText(/1 Sept 2026/);
    expect(time.textContent).toMatch(/10:00/);
    expect(time.getAttribute("dateTime")).toBe(FIRST.created_at);
  });

  it("names an author it doesn't know as an unknown user", async () => {
    mockEventService([thread([{ ...FIRST, author_name: null }])]);
    setup();

    expect(await screen.findByText("Unknown user")).toBeTruthy();
  });

  it("says when there are no comments yet", async () => {
    mockEventService([thread([])]);
    setup();

    expect(screen.getByRole("status").textContent).toBe("Loading comments…");
    expect(await screen.findByText(NO_COMMENTS)).toBeTruthy();
  });
});

describe("SCRUM-25/AC3 — View comment history", () => {
  it("lists comments oldest to newest, as event-service orders them", async () => {
    mockEventService([thread([FIRST, SECOND])]);
    setup();

    await screen.findByText(SECOND.body);
    const bodies = screen.getAllByRole("listitem").map((li) => li.querySelector(".comment__body")!.textContent);
    expect(bodies).toEqual([FIRST.body, SECOND.body]);
  });
});

describe("SCRUM-25/AC4 — Prevent empty comments", () => {
  it.each(["", "   \n "])("doesn't post %j and says text is required", async (text) => {
    const fetchMock = mockEventService([thread([])], { status: 201, body: {} });
    setup();
    await screen.findByText(NO_COMMENTS);

    type(text);
    fireEvent.click(postButton());

    expect((await screen.findByRole("alert")).textContent).toBe(COMMENT_REQUIRED);
    expect(box().getAttribute("aria-invalid")).toBe("true");
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("clears the message once a real comment is posted", async () => {
    mockEventService([thread([]), thread([SECOND])], { status: 201, body: {} });
    setup();
    await screen.findByText(NO_COMMENTS);

    fireEvent.click(postButton());
    await screen.findByText(COMMENT_REQUIRED);
    type(SECOND.body);
    fireEvent.click(postButton());

    await screen.findByRole("listitem");
    expect(screen.queryByText(COMMENT_REQUIRED)).toBeNull();
    expect(box().getAttribute("aria-invalid")).toBeNull();
  });
});

describe("SCRUM-25/AC5 — Comment permissions", () => {
  it("shows the comments but no comment form to a viewer who can't take part", async () => {
    mockEventService([thread([FIRST], false)]);
    setup();

    expect(await screen.findByText(FIRST.body)).toBeTruthy();
    expect(screen.queryByLabelText("Add a comment")).toBeNull();
    expect(screen.queryByRole("button", { name: "Post comment" })).toBeNull();
  });

  it("leaves the section out for a viewer event-service won't show comments to", async () => {
    const fetchMock = mockEventService([{ status: 403, body: { error: "You are not allowed to view comments on this event." } }]);
    const { container } = setup();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.innerHTML).toBe(""));
  });
});
