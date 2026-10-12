import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventReviewActions } from "@/components/EventReviewActions";

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

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-24/AC1 — Approve a request", () => {
  it("approves after confirmation and reports the new status", async () => {
    const fetchMock = mockServer(200, { id: "evt-1", name: "Tech Summit", status: "approved" });
    const { onDecided } = setup();

    click("Approve request");
    click("Yes, approve");

    await vi.waitFor(() => expect(onDecided).toHaveBeenCalledWith("approved"));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt-1/approve");
    expect(options).toMatchObject({ method: "POST", credentials: "include" });
  });

  it("offers the decision on a request that is under review", () => {
    setup({ status: "under_review" });
    screen.getByRole("button", { name: "Approve request" });
  });
});

describe("SCRUM-24/AC2 — Reject a request", () => {
  it("requires a reason before the rejection can be confirmed", () => {
    const fetchMock = mockServer(200, {});
    setup();

    click("Reject request");
    click("Continue");

    expect(screen.getByRole("alert").textContent).toBe("Enter a reason for rejecting this request.");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only reason as missing", () => {
    setup();

    click("Reject request");
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "   " } });
    click("Continue");

    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("rejects with the trimmed reason after confirmation", async () => {
    const fetchMock = mockServer(200, { id: "evt-1", name: "Tech Summit", status: "rejected" });
    const { onDecided } = setup();

    click("Reject request");
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "  Venue too small.  " } });
    click("Continue");
    expect(screen.getByRole("alertdialog", { name: "Confirm rejection" }).textContent).toContain("Venue too small.");
    click("Yes, reject");

    await vi.waitFor(() => expect(onDecided).toHaveBeenCalledWith("rejected"));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt-1/reject");
    expect(JSON.parse(options.body)).toEqual({ reason: "Venue too small." });
  });

  it("keeps the reason when going back to edit it", () => {
    setup();

    click("Reject request");
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "Venue too small." } });
    click("Continue");
    click("Edit reason");

    expect((screen.getByLabelText("Reason for rejection") as HTMLTextAreaElement).value).toBe("Venue too small.");
  });
});

describe("SCRUM-24/AC3 — Confirm decision", () => {
  it("asks for confirmation before approving, and cancelling sends nothing", () => {
    const fetchMock = mockServer(200, {});
    setup();

    click("Approve request");
    screen.getByRole("alertdialog", { name: "Confirm approval" });
    click("Cancel");

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancelling the reason step clears its error and sends nothing", () => {
    const fetchMock = mockServer(200, {});
    setup();

    click("Reject request");
    click("Continue");
    click("Cancel");

    expect(screen.queryByRole("alert")).toBeNull();
    screen.getByRole("button", { name: "Reject request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and leaves the status alone", async () => {
    mockServer(409, { error: "Only submitted or under-review requests can be approved or rejected." });
    const { onDecided } = setup();

    click("Approve request");
    click("Yes, approve");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Only submitted or under-review requests can be approved or rejected.",
    );
    expect(onDecided).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the server gives no reason", async () => {
    mockServer(500, {});
    setup();

    click("Approve request");
    click("Yes, approve");

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't save your decision. Please try again.");
  });
});

describe("SCRUM-24/AC5 — Authorisation", () => {
  it("shows no actions to someone who may not review", () => {
    setup({ canReview: false });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(["draft", "approved", "rejected", "cancelled"])("shows no actions once the request is %s", (status) => {
    setup({ status });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
