// SCRUM-124/AC2: the sidebar's Drafts item, rendered in the real shell, and the rows on the Drafts page it opens

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES } from "@spm-t5/shared";

const nav = vi.hoisted(() => ({ pathname: "/" }));
const { getOrganiserHome } = vi.hoisted(() => ({ getOrganiserHome: vi.fn() }));
vi.mock("@/lib/organiserHomeServer", () => ({ getOrganiserHome }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import OrganiserDraftsPage from "@/app/dashboard/event_organiser/drafts/page";
import { ShellFrame } from "@/components/shell/ShellFrame";
import type { OrganiserHomeEvent } from "@/lib/organiserHome";

const DRAFTS = "/dashboard/event_organiser/drafts";
const links = () => within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
const shell = (role: (typeof ROLES)[number]) =>
  render(<ShellFrame shell={{ user: { fullName: "Priya Nair", role }, counts: {} }}><p>body</p></ShellFrame>);

const event = (over: Partial<OrganiserHomeEvent>): OrganiserHomeEvent => ({
  id: "e", name: "Event", status: "planning", start: null, end: null, expected_attendance: null, submitted_at: null, updated_at: "2026-10-01T00:00:00Z",
  venue_names: [], coordinator_name: null, coordinator_assigned_at: null, clarification: null, change_outcome: null, ...over,
});

beforeEach(() => { nav.pathname = "/"; getOrganiserHome.mockReset(); });

describe("SCRUM-124/AC2 the Drafts item in the rendered sidebar", () => {
  it("SCRUM-124/AC2 links to the Drafts page for the organiser, and no other role has the item", () => {
    for (const role of ROLES) {
      const { unmount } = shell(role);
      const drafts = links().filter((a) => a.textContent === "Drafts");
      expect(drafts.map((a) => a.getAttribute("href"))).toEqual(role === "event_organiser" ? [DRAFTS] : []);
      unmount();
    }
  });

  it("SCRUM-124/AC2 marks Drafts, and only Drafts, as the current page on the Drafts page", () => {
    nav.pathname = DRAFTS;
    shell("event_organiser");
    expect(links().filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent)).toEqual(["Drafts"]);
  });

  it("SCRUM-124/AC2 marks Home, not Drafts, on Home", () => {
    nav.pathname = "/dashboard/event_organiser";
    shell("event_organiser");
    expect(links().filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent)).toEqual(["Home"]);
  });
});

describe("SCRUM-124/AC2 the Drafts page", () => {
  it("SCRUM-124/AC2 lists each draft with a Draft badge and a link that opens it in the form, and no submitted request", async () => {
    getOrganiserHome.mockResolvedValue({ events: [
      event({ id: "d1", name: "Design Workshop", status: "draft" }),
      event({ id: "s1", name: "Pitch Day", status: "submitted" }),
      event({ id: "d2", name: "Alumni Night", status: "draft" }),
    ] });
    render(await OrganiserDraftsPage());
    const panel = screen.getByRole("tabpanel");
    for (const [name, id] of [["Design Workshop", "d1"], ["Alumni Night", "d2"]]) {
      const row = within(panel).getByRole("row", { name: new RegExp(name) });
      expect(within(row).getByRole("link", { name }).getAttribute("href")).toBe(`/events/new?draft=${id}`);
      expect(within(row).getAllByText("Draft").length).toBeGreaterThan(0);
    }
    expect(within(panel).queryByText("Pitch Day")).toBeNull();
  });

  it("SCRUM-124/AC2 shows why the drafts cannot load", async () => {
    getOrganiserHome.mockResolvedValue({ error: "We couldn't load your events." });
    render(await OrganiserDraftsPage());
    expect(screen.getByText("We couldn't load your events.")).toBeTruthy();
  });
});

describe("SCRUM-124/AC10 the Drafts page while it loads", () => {
  it("SCRUM-124/AC10 shows a busy placeholder in the shared page frame, named for the drafts", async () => {
    const { default: Loading } = await import("@/app/dashboard/event_organiser/drafts/loading");
    render(<Loading />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-label") ?? status.textContent).toMatch(/drafts/i);
  });
});
