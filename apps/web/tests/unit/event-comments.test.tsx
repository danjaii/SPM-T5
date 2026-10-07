import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMMENT_REQUIRED,
  encodeMentions,
  EventComments,
  mentionQuery,
  NO_COMMENTS,
  NO_MATCHES,
  REPLY_REQUIRED,
} from "@/components/EventComments";

type Reply = { status: number; body: unknown };

/** SCRUM-27/AC1, AC5: who event-service says may be mentioned on the event. */
const PEOPLE = [
  { id: "u-rachel", full_name: "Rachel Tan" },
  { id: "u-marcus", full_name: "Marcus Lim" },
  { id: "u-olivia", full_name: "Olivia Org" },
];

/**
 * Fakes event-service: GET /comments answers with each of `threads` in turn (the last one repeats), POST with
 * `post`, and GET /mentionable-users with `people`.
 */
function mockEventService(
  threads: Reply[],
  post?: Reply | "offline",
  people: Reply = { status: 200, body: PEOPLE },
) {
  let gets = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (post === "offline") throw new TypeError("Failed to fetch");
      return { ok: post!.status < 400, status: post!.status, json: async () => post!.body };
    }
    const reply = url.endsWith("/mentionable-users") ? people : threads[Math.min(gets++, threads.length - 1)];
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

const reply = (id: string, parent: string, author: string, body: string, created_at: string) => ({
  ...comment(id, author, body, created_at),
  parent_comment_id: parent,
});

const REPLY_1 = reply("r1", "c1", "Olivia Org", "About 120.", "2026-09-01T04:00:00Z");
const REPLY_2 = reply("r2", "c1", "Rachel Tan", "Thanks, noted.", "2026-09-01T05:00:00Z");

const replyButtons = () => screen.getAllByRole("button", { name: "Reply" });
const replyBox = () => screen.getByLabelText(/^Reply to /);

describe("SCRUM-26/AC1 — Reply to a comment", () => {
  it("posts the reply with its parent comment and shows it in the thread", async () => {
    const fetchMock = mockEventService([thread([FIRST]), thread([FIRST, REPLY_1])], { status: 201, body: {} });
    setup();
    await screen.findByText(FIRST.body);

    fireEvent.click(replyButtons()[0]);
    expect(replyBox().id).toBe("reply-c1");
    expect(screen.getByLabelText("Reply to Rachel Tan")).toBeTruthy();
    fireEvent.change(replyBox(), { target: { value: "  About 120. " } });
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));

    expect(await screen.findByText(REPLY_1.body)).toBeTruthy();
    const [, init] = posts(fetchMock)[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ body: "About 120.", parent_comment_id: "c1" });
    expect(screen.queryByLabelText(/^Reply to /)).toBeNull(); // the reply box closes once posted
  });

  it("cancelling closes the reply box without posting", async () => {
    const fetchMock = mockEventService([thread([FIRST])], { status: 201, body: {} });
    setup();
    await screen.findByText(FIRST.body);

    fireEvent.click(replyButtons()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText(/^Reply to /)).toBeNull();
    expect(replyButtons()).toHaveLength(1);
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("opens one reply box at a time", async () => {
    mockEventService([thread([FIRST, comment("c3", "Marcus Lim", "Venue confirmed.", "2026-09-02T01:00:00Z")])]);
    setup();
    await screen.findByText("Venue confirmed.");

    fireEvent.click(replyButtons()[0]);
    fireEvent.click(replyButtons()[0]); // the first comment's button is gone, so this is the second one

    expect(screen.getAllByLabelText(/^Reply to /)).toHaveLength(1);
    expect(screen.getByLabelText("Reply to Marcus Lim")).toBeTruthy();
  });

  it("keeps the reply open with the server's message when posting fails", async () => {
    mockEventService([thread([FIRST])], { status: 400, body: {} });
    setup();
    await screen.findByText(FIRST.body);

    fireEvent.click(replyButtons()[0]);
    fireEvent.change(replyBox(), { target: { value: "About 120." } });
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't post your reply. Please try again.");
    expect((replyBox() as HTMLTextAreaElement).value).toBe("About 120.");
  });

  it("offers no Reply to a viewer who can't take part", async () => {
    mockEventService([thread([FIRST, REPLY_1], false)]);
    setup();
    await screen.findByText(REPLY_1.body);

    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  });
});

describe("SCRUM-26/AC2 — Display reply details and visual hierarchy", () => {
  it("nests each reply, with its author, date and time, and text, under its parent comment", async () => {
    mockEventService([thread([FIRST, SECOND, REPLY_1])]);
    setup();

    const replies = within(await screen.findByRole("list", { name: "Replies to Rachel Tan" }));
    const item = within(replies.getByRole("listitem"));
    expect(item.getByText("Olivia Org")).toBeTruthy();
    expect(item.getByText("About 120.")).toBeTruthy();
    expect(item.getByText(/1 Sept 2026/).textContent).toMatch(/12:00/); // 04:00 UTC is 12:00 in Singapore
    expect(replies.queryByText(SECOND.body)).toBeNull(); // a top-level comment stays at the top level
  });

  it("keeps a reply to a reply in the same thread, one level deep", async () => {
    const nested = reply("r9", "r1", "Marcus Lim", "Same here.", "2026-09-01T06:00:00Z");
    mockEventService([thread([FIRST, REPLY_1, nested])]);
    setup();

    const replies = within(await screen.findByRole("list", { name: "Replies to Rachel Tan" }));
    expect(replies.getAllByRole("listitem").map((li) => li.querySelector(".comment__body")!.textContent))
      .toEqual(["About 120.", "Same here."]);
    expect(replies.queryByRole("list")).toBeNull();
  });

  it("shows a reply whose parent it can't see as a comment of its own", async () => {
    mockEventService([thread([reply("r5", "gone", "Olivia Org", "Orphaned reply.", "2026-09-01T04:00:00Z")])]);
    setup();

    expect(await screen.findByText("Orphaned reply.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: /^Replies to / })).toBeNull();
  });

  it("names the thread of an unknown author generically", async () => {
    mockEventService([thread([{ ...FIRST, author_name: null }, REPLY_1])]);
    setup();
    await screen.findByText(REPLY_1.body);

    expect(screen.getByRole("list", { name: "Replies to this comment" })).toBeTruthy();
    fireEvent.click(replyButtons()[0]);
    expect(screen.getByLabelText("Reply to this comment")).toBeTruthy();
  });
});

describe("SCRUM-26/AC3 — Order replies oldest to newest", () => {
  it("lists a thread's replies in event-service's oldest-first order", async () => {
    mockEventService([thread([FIRST, SECOND, REPLY_1, REPLY_2])]);
    setup();

    const replies = within(await screen.findByRole("list", { name: "Replies to Rachel Tan" }));
    expect(replies.getAllByRole("listitem").map((li) => li.querySelector(".comment__body")!.textContent))
      .toEqual([REPLY_1.body, REPLY_2.body]);
  });
});

describe("SCRUM-26/AC4 — Prevent empty replies", () => {
  it.each(["", "  \n "])("doesn't post %j and says text is required", async (text) => {
    const fetchMock = mockEventService([thread([FIRST])], { status: 201, body: {} });
    setup();
    await screen.findByText(FIRST.body);

    fireEvent.click(replyButtons()[0]);
    fireEvent.change(replyBox(), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));

    expect((await screen.findByRole("alert")).textContent).toBe(REPLY_REQUIRED);
    expect(replyBox().getAttribute("aria-invalid")).toBe("true");
    expect(posts(fetchMock)).toHaveLength(0);
  });
});

const menu = () => screen.queryByRole("listbox", { name: "People you can mention" });
const options = () => within(menu()!).getAllByRole("option").map((o) => o.textContent);
const mentionSearches = (fetchMock: ReturnType<typeof mockEventService>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/mentionable-users"));
const sentBody = (fetchMock: ReturnType<typeof mockEventService>) =>
  JSON.parse(((posts(fetchMock)[0] as unknown[])[1] as RequestInit).body as string);

/** Renders an empty conversation and waits for the comment box. */
async function ready(post?: Reply, people?: Reply) {
  const fetchMock = mockEventService([thread([])], post, people);
  setup();
  await screen.findByText(NO_COMMENTS);
  return fetchMock;
}

describe("SCRUM-27/AC1 — Search for users", () => {
  it("typing @ and part of a name lists the matching people who can see the event", async () => {
    const fetchMock = await ready();

    type("Hi @ra");

    expect(await screen.findByRole("listbox", { name: "People you can mention" })).toBeTruthy();
    expect(options()).toEqual(["Rachel Tan"]);
    expect(box().getAttribute("aria-expanded")).toBe("true");
    expect(mentionSearches(fetchMock)[0][0]).toBe("http://localhost:4002/events/evt-1/mentionable-users");
  });

  it("a bare @ lists everyone, and later keystrokes filter without asking event-service again", async () => {
    const fetchMock = await ready();

    type("@");
    await screen.findByRole("listbox");
    expect(options()).toEqual(["Rachel Tan", "Marcus Lim", "Olivia Org"]);
    type("@mar");

    expect(options()).toEqual(["Marcus Lim"]);
    expect(mentionSearches(fetchMock)).toHaveLength(1);
  });

  it("says when nobody matches", async () => {
    await ready();

    type("@zz");

    expect((await screen.findByText(NO_MATCHES)).getAttribute("role")).toBe("status");
    expect(menu()).toBeNull();
  });

  it("offers nobody when event-service won't say who can be mentioned", async () => {
    await ready(undefined, { status: 403, body: { error: "You are not allowed to search for users on this event." } });

    type("@ra");

    expect(await screen.findByText(NO_MATCHES)).toBeTruthy();
  });

  it("doesn't open for an @ inside a word, such as an email address", async () => {
    const fetchMock = await ready();

    type("mail rachel@ra");

    expect(menu()).toBeNull();
    expect(mentionSearches(fetchMock)).toHaveLength(0);
  });

  it("closes on Escape and when the box loses focus", async () => {
    await ready();

    type("@ra");
    await screen.findByRole("listbox");
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(menu()).toBeNull();

    type("@ma");
    await screen.findByRole("listbox");
    fireEvent.blur(box());
    expect(menu()).toBeNull();
  });

  it.each([
    ["@", ""],
    ["Hi @Rachel T", "Rachel T"],
    ["line one\n@ma", "ma"],
    ["no mention", undefined],
    ["rachel@ra", undefined],
    ["@" + "x".repeat(31), undefined],
  ])("mentionQuery(%j) is %j", (text, expected) => {
    expect(mentionQuery(text)).toBe(expected);
  });
});

describe("SCRUM-27/AC2 — Add a mention", () => {
  it("clicking a person puts their name in the text and posts it as a mention", async () => {
    const fetchMock = await ready({ status: 201, body: {} });

    type("Hi @ra");
    await screen.findByRole("listbox");
    fireEvent.mouseDown(screen.getByRole("option", { name: "Rachel Tan" }));

    expect((box() as HTMLTextAreaElement).value).toBe("Hi @Rachel Tan ");
    expect(menu()).toBeNull();
    type("Hi @Rachel Tan can you check?");
    fireEvent.click(postButton());

    await vi.waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(sentBody(fetchMock)).toEqual({ body: "Hi @[u-rachel] can you check?" });
  });

  it("arrow keys move through the list and Enter picks", async () => {
    await ready();

    type("@");
    await screen.findByRole("listbox");
    expect(screen.getByRole("option", { selected: true }).textContent).toBe("Rachel Tan");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(box().getAttribute("aria-activedescendant")).toBe("new-comment-mentions-1");
    fireEvent.keyDown(box(), { key: "ArrowUp" });
    fireEvent.keyDown(box(), { key: "ArrowUp" }); // wraps round to the last person
    expect(screen.getByRole("option", { selected: true }).textContent).toBe("Olivia Org");
    fireEvent.keyDown(box(), { key: "Enter" });

    expect((box() as HTMLTextAreaElement).value).toBe("@Olivia Org ");
  });

  it("Tab picks too, and other keys are left to the box", async () => {
    await ready();

    type("@mar");
    await screen.findByRole("listbox");
    fireEvent.keyDown(box(), { key: "a" });
    expect(menu()).toBeTruthy();
    fireEvent.keyDown(box(), { key: "Tab" });

    expect((box() as HTMLTextAreaElement).value).toBe("@Marcus Lim ");
  });

  it("keys do nothing special while the list is closed", async () => {
    await ready();

    type("hello");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "Enter" });

    expect((box() as HTMLTextAreaElement).value).toBe("hello");
    expect(menu()).toBeNull();
  });

  it("skips people without a name", async () => {
    await ready(undefined, { status: 200, body: [...PEOPLE, { id: "u-nameless", full_name: null }] });

    type("@");
    await screen.findByRole("listbox");

    expect(options()).toEqual(["Rachel Tan", "Marcus Lim", "Olivia Org"]);
  });

  it("Enter with no matches doesn't pick anyone", async () => {
    await ready();

    type("@zz");
    await screen.findByText(NO_MATCHES);
    fireEvent.keyDown(box(), { key: "Enter" });

    expect((box() as HTMLTextAreaElement).value).toBe("@zz");
  });

  it("works in a reply box, and mentioning the same person twice sends both", async () => {
    const fetchMock = mockEventService([thread([FIRST])], { status: 201, body: {} });
    setup();
    await screen.findByText(FIRST.body);
    fireEvent.click(replyButtons()[0]);

    fireEvent.change(replyBox(), { target: { value: "@ol" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Olivia Org" }));
    fireEvent.change(replyBox(), { target: { value: "@Olivia Org and @ol" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Olivia Org" }));
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));

    await vi.waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(sentBody(fetchMock)).toEqual({ body: "@[u-olivia] and @[u-olivia]", parent_comment_id: "c1" });
  });

  it("encodes longer names first, so one name inside another isn't split", () => {
    const ann = { id: "u-ann", full_name: "Ann" };
    const annLee = { id: "u-ann-lee", full_name: "Ann Lee" };

    expect(encodeMentions("@Ann Lee and @Ann", [ann, annLee])).toBe("@[u-ann-lee] and @[u-ann]");
    expect(encodeMentions("no mentions", [])).toBe("no mentions");
  });

  it("a name the writer edited after picking is posted as plain text", async () => {
    const fetchMock = await ready({ status: 201, body: {} });

    type("@ra");
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Rachel Tan" }));
    type("@Rachel please");
    fireEvent.click(postButton());

    await vi.waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(sentBody(fetchMock)).toEqual({ body: "@Rachel please" });
  });
});

describe("SCRUM-27/AC3 — Display mentions", () => {
  it("shows each mention as the person's name, set apart from the text", async () => {
    mockEventService([thread([{
      ...FIRST,
      body: "Thanks @[u-olivia], looping in @[u-marcus].",
      mentions: [{ user_id: "u-olivia", full_name: "Olivia Org" }, { user_id: "u-marcus", full_name: "Marcus Lim" }],
    }])]);
    setup();

    const body = await screen.findByText(/Thanks/, { selector: ".comment__body" });
    expect(body.textContent).toBe("Thanks @Olivia Org, looping in @Marcus Lim.");
    expect([...body.querySelectorAll(".mention")].map((m) => m.textContent)).toEqual(["@Olivia Org", "@Marcus Lim"]);
  });

  it("shows a mention it can't name as an unknown user", async () => {
    mockEventService([thread([{ ...FIRST, body: "Ask @[u-gone]", mentions: [] }])]);
    setup();

    const body = await screen.findByText(/Ask/, { selector: ".comment__body" });
    expect(body.querySelector(".mention")!.textContent).toBe("@Unknown user");
  });
});
