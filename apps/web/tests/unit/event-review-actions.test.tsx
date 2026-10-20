import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventReviewActions } from "@/components/EventReviewActions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

/** Pretends event-service answered the browser's request with this status code and JSON body. */
function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const setup = (props: Partial<Parameters<typeof EventReviewActions>[0]> = {}) => {
  const onDecided = vi.fn();
  render(<EventReviewActions eventId="evt-1" status="submitted" canReview onDecided={onDecided} {...props} />);
  return { onDecided };
};

const click = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const dialog = () => screen.getByRole("dialog");
const inDialog = (name: string) => within(dialog()).getByRole("button", { name });

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("SCRUM-125/AC1 — the review panel", () => {
  it.each(["submitted", "under_review"])("shows Request clarification, Reject and Approve together on a %s request", (status) => {
    setup({ status });

    const group = screen.getByRole("group", { name: "Review this request" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Request clarification",
      "Reject",
      "Approve request",
    ]);
  });

  it("shows no actions to someone who may not review", () => {
    setup({ canReview: false });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(["draft", "approved", "rejected", "cancelled"])("shows no actions once the request is %s", (status) => {
    setup({ status });
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("SCRUM-125/AC2 — Reject needs a reason", () => {
  it("opens a destructive dialog and refuses an empty reason", () => {
    const fetchMock = mockServer(200, {});
    setup();

    click("Reject");
    expect(inDialog("Reject request").className).toContain("bg-destructive");
    fireEvent.click(inDialog("Reject request"));

    expect(within(dialog()).getByRole("alert").textContent).toBe("Enter a reason for rejecting this request.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only reason as missing", () => {
    const fetchMock = mockServer(200, {});
    setup();

    click("Reject");
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "   " } });
    fireEvent.click(inDialog("Reject request"));

    expect(within(dialog()).getByRole("alert")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects with the trimmed reason and reports the new status", async () => {
    const fetchMock = mockServer(200, { id: "evt-1", name: "Tech Summit", status: "rejected" });
    const { onDecided } = setup();

    click("Reject");
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "  Venue too small.  " } });
    fireEvent.click(inDialog("Reject request"));

    await vi.waitFor(() => expect(onDecided).toHaveBeenCalledWith("rejected"));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt-1/reject");
    expect(JSON.parse(options.body)).toEqual({ reason: "Venue too small." });
    expect(refresh).toHaveBeenCalled();
  });

  it("cancelling sends nothing and closes the dialog", () => {
    const fetchMock = mockServer(200, {});
    setup();

    click("Reject");
    fireEvent.click(inDialog("Cancel"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-125/AC3 — approve and clarify reach the organiser", () => {
  it("approves after confirmation and reports the new status", async () => {
    const fetchMock = mockServer(200, { id: "evt-1", name: "Tech Summit", status: "approved" });
    const { onDecided } = setup();

    click("Approve request");
    fireEvent.click(inDialog("Approve request"));

    await vi.waitFor(() => expect(onDecided).toHaveBeenCalledWith("approved"));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt-1/approve");
    expect(options).toMatchObject({ method: "POST", credentials: "include" });
    expect(refresh).toHaveBeenCalled();
  });

  it("posts the question as a clarification request in the event conversation", async () => {
    const fetchMock = mockServer(200, {});
    const { onDecided } = setup();

    click("Request clarification");
    fireEvent.change(screen.getByLabelText("Your question for the organiser"), { target: { value: " Is the foyer free? " } });
    fireEvent.click(inDialog("Send question"));

    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt-1/comments");
    expect(JSON.parse(options.body)).toEqual({ body: "Is the foyer free?", clarification_request: true });
    expect(onDecided).not.toHaveBeenCalled(); // the request stays under review
  });

  it("will not send an empty question", () => {
    const fetchMock = mockServer(200, {});
    setup();

    click("Request clarification");
    fireEvent.click(inDialog("Send question"));

    expect(within(dialog()).getByRole("alert").textContent).toBe("Enter the question you want the organiser to answer.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's refusal inside the dialog and leaves the status alone", async () => {
    mockServer(409, { error: "Only submitted or under-review requests can be approved or rejected." });
    const { onDecided } = setup();

    click("Approve request");
    fireEvent.click(inDialog("Approve request"));

    expect((await within(dialog()).findByRole("alert")).textContent).toBe(
      "Only submitted or under-review requests can be approved or rejected.",
    );
    expect(onDecided).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the server gives no reason", async () => {
    mockServer(500, {});
    setup();

    click("Approve request");
    fireEvent.click(inDialog("Approve request"));

    expect((await within(dialog()).findByRole("alert")).textContent).toBe("We couldn't save your decision. Please try again.");
  });
});
