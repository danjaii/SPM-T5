import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const srv = vi.hoisted(() => ({ options: vi.fn(), draft: vi.fn() }));
vi.mock("@/lib/eventRequestsServer", () => ({ getRequestOptions: srv.options, getDraftForEdit: srv.draft }));
const form = vi.hoisted(() => vi.fn());
vi.mock("@/components/event-request/EventRequestForm", () => ({
  EventRequestForm: (props: { draft?: { id: string } }) => { form(props); return <div data-testid="form">{props.draft?.id ?? "new"}</div>; },
}));

import NewEventRequestPage from "@/app/events/new/page";
import { stored } from "./draftFixtures";

const open = async (draft?: string) => render(await NewEventRequestPage({ searchParams: Promise.resolve({ draft }) }));

beforeEach(() => {
  form.mockReset();
  srv.options.mockReset().mockResolvedValue({ roomLayouts: [{ id: "l1", name: "Theatre" }] });
  srv.draft.mockReset();
});

describe("SCRUM-54/AC1 the new request page opens a draft", () => {
  it("shows an empty form, and asks for no draft, when no draft is named", async () => {
    await open();
    expect(screen.getByTestId("form").textContent).toBe("new");
    expect(srv.draft).not.toHaveBeenCalled();
  });

  it("opens the named draft in the form, pre-filled, and keys the form by the draft so another draft starts fresh", async () => {
    srv.draft.mockResolvedValue({ draft: stored });
    const tree = await NewEventRequestPage({ searchParams: Promise.resolve({ draft: "draft-1" }) });
    render(tree);
    expect(srv.draft).toHaveBeenCalledWith("draft-1");
    expect(form.mock.calls[0][0].draft.id).toBe("draft-1");
    expect(form.mock.calls[0][0].draft.values.name).toBe("Tech Summit");
    const formElement = JSON.stringify(tree, (k, v) => (k === "_owner" ? undefined : v));
    expect(formElement).toContain('"key":"draft-1"');
  });
});

describe("SCRUM-54/AC4 a draft that cannot be opened shows why, and no form", () => {
  it("shows the server's reason for a submitted request and renders no form", async () => {
    srv.draft.mockResolvedValue({ error: "This request has been submitted and can no longer be edited as a draft." });
    await open("sub-1");
    expect((await screen.findByRole("alert")).textContent).toMatch(/can no longer be edited/);
    expect(screen.queryByTestId("form")).toBeNull();
  });

  it("shows the options error when the form cannot load, without a form", async () => {
    srv.options.mockResolvedValue({ error: "We couldn't load the form. Please try again." });
    await open();
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't load the form/);
    expect(screen.queryByTestId("form")).toBeNull();
  });
});
