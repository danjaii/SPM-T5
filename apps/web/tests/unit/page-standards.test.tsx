import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BackLink, PAGE_MAIN, PageFrame, PageFrameSkeleton, PageTitle } from "@/components/PageFrame";
import { NAV_ITEMS } from "@/lib/nav";

const SRC = path.join(__dirname, "..", "..", "src");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");
const source = (file: string) => readFileSync(file, "utf8");
const ALL = [...tsxFiles(path.join(SRC, "app")), ...tsxFiles(path.join(SRC, "components"))].filter((f) => !rel(f).startsWith("components/ui/"));

// Pages with their own layout on purpose, each with its reason.
const OWN_LAYOUT: Record<string, string> = {
  "components/AuthLayout.tsx": "sign-in, registration and password pages are out of scope",
  "components/auth/AuthParts.tsx": "sign-in, registration and password pages are out of scope",
  "app/access-denied/page.tsx": "a centred message on its own, not a page in the shell",
  "components/styleguide/Styleguide.tsx": "a developer page, not part of the app",
  "app/change-requests/[id]/page.tsx": "redesigned by SCRUM-140, which is not merged yet",
  "components/ChangeRequestReview.tsx": "redesigned by SCRUM-140, which is not merged yet",
  "components/DashboardView.tsx": "no page renders it any more",
  "components/PageFrame.tsx": "defines the standard",
};

// Every sidebar destination except Home, with the page file that renders it.
const SIDEBAR = [...new Map(Object.values(NAV_ITEMS).flat().filter((i) => i.label !== "Home").map((i) => [i.href, i])).values()].map((item) => ({
  ...item,
  file: path.join(SRC, "app", ...item.href.split("/").filter(Boolean), "page.tsx"),
}));

describe("SCRUM-186/AC1 every signed-in page uses the same width and padding", () => {
  it("PageFrame and its skeleton use the shared container", () => {
    const { container, unmount } = render(<PageFrame title="Inventory" />);
    expect(container.querySelector("main")!.className).toBe(PAGE_MAIN);
    unmount();
    render(<PageFrameSkeleton label="Loading" />);
    expect(screen.getByRole("status").className).toBe(PAGE_MAIN);
  });

  it("every <main> in the app uses PAGE_MAIN", () => {
    const offenders = ALL.filter((f) => !OWN_LAYOUT[rel(f)])
      .flatMap((f) => (source(f).match(/<main\b[^>]*>/g) ?? []).filter((tag) => !tag.includes("className={PAGE_MAIN}")).map((tag) => `${rel(f)}: ${tag}`));
    expect(offenders).toEqual([]);
  });
});

describe("SCRUM-186/AC1 the frame's own parts", () => {
  it("shows the description, a badge beside the title and an action", () => {
    render(<PageFrame title="Booking requests" description="Oldest first." badge={<span>3 pending</span>} action={<button type="button">Add</button>} />);
    expect(screen.getByText("Oldest first.")).toBeTruthy();
    expect(screen.getByText("3 pending")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });

  it("shows the error in place of the page when it could not load", () => {
    render(<PageFrame title="Inventory" error="We couldn't load the inventory."><p>the table</p></PageFrame>);
    expect(screen.getByRole("alert").textContent).toContain("We couldn't load the inventory.");
    expect(screen.queryByText("the table")).toBeNull();
  });
});

describe("SCRUM-186/AC2 sidebar pages have no back link", () => {
  it.each(SIDEBAR)("$label ($href)", ({ file }) => {
    const page = source(file);
    // \b so a <Suspense fallback={...}> is not taken for PageFrame's back prop
    expect(page).not.toMatch(/<BackLink|\bback=\{|>\s*(?:←\s*)?Back to /);
  });
});

describe("SCRUM-186/AC3 pages reached from inside the app have one back link, as an arrow and \"Back to <place>\"", () => {
  it("BackLink renders the arrow icon and the wording", () => {
    const { container } = render(<BackLink href="/events/evt-1" to="event" />);
    const link = screen.getByRole("link", { name: "Back to event" });
    expect(link.getAttribute("href")).toBe("/events/evt-1");
    expect(container.querySelector("svg[aria-hidden='true']")).toBeTruthy();
  });

  it("PageFrame puts the back link above the title when given one", () => {
    render(<PageFrame title="Assign a coordinator" back={{ href: "/lead/queue", to: "unassigned requests" }} />);
    const link = screen.getByRole("link", { name: "Back to unassigned requests" });
    expect(link.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("no page writes its own back link any more", () => {
    const offenders = ALL.filter((f) => !OWN_LAYOUT[rel(f)]).filter((f) => /← Back to|<ArrowLeft[^>]*\/>\s*(Back|Back to)\b/.test(source(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("SCRUM-186/AC4 a sidebar page's title is its sidebar label", () => {
  it.each(SIDEBAR)("$label ($href)", ({ label, file }) => {
    const page = source(file);
    expect(page.includes(`title="${label}"`) || page.includes(`<PageTitle>${label}</PageTitle>`)).toBe(true);
  });
});

describe("SCRUM-186/AC5 every page title has the same style", () => {
  it("PageTitle is a level-one heading with the shared classes", () => {
    render(<PageTitle>Safety checks</PageTitle>);
    expect(screen.getByRole("heading", { level: 1, name: "Safety checks" }).className).toContain("font-heading text-2xl font-bold");
  });

  it("no page writes its own <h1>", () => {
    const offenders = ALL.filter((f) => !OWN_LAYOUT[rel(f)]).filter((f) => /<h1\b/.test(source(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});
