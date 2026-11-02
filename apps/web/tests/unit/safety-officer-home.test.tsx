// SCRUM-165 (Figma 19): the Safety Officer Home

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SafetyHome, SafetyHomeEvent } from "@/lib/safetyCheckServer";

const { getSafetyHome, getShellData } = vi.hoisted(() => ({ getSafetyHome: vi.fn(), getShellData: vi.fn() }));
vi.mock("@/lib/safetyCheckServer", () => ({ getSafetyHome }));
vi.mock("@/lib/shellServer", () => ({ getShellData }));

import SafetyOfficerDashboard from "@/app/dashboard/safety_officer/page";
import { decisionView, eventSummary, greeting } from "@/lib/safetyHome";

const event = (over: Partial<SafetyHomeEvent> = {}): SafetyHomeEvent => ({
  id: "e1",
  name: "Annual Tech Summit 2026",
  start: "2026-11-14T02:00:00Z",
  end: "2026-11-14T10:00:00Z",
  expected_attendance: 450,
  venue_names: ["A", "B", "C", "D"],
  recheck: false,
  ...over,
});

const home = (over: Partial<SafetyHome> = {}): SafetyHome => ({
  ready: [event(), event({ id: "e2", name: "Alumni Networking Night", recheck: true })],
  waiting_on_coordinator: 1,
  approved_this_month: 9,
  revoked_this_month: 0,
  recent: [{ event_id: "e9", name: "Product Launch Breakfast", decision: "approved", decided_at: "2026-10-12T05:00:00Z" }],
  ...over,
});

async function renderPage(h: SafetyHome | { error: string }) {
  getShellData.mockResolvedValue({ user: { fullName: "Nadia Hassan", role: "safety_officer" }, counts: {} });
  getSafetyHome.mockResolvedValue("error" in h ? h : { home: h });
  render(await SafetyOfficerDashboard());
}

/** The list row that holds an event's name and its action button. */
const rowOf = (name: string) => screen.getByText(name, { selector: "p" }).closest("li")!;

describe("SCRUM-165/AC1 events ready for a check link to the safety queue", () => {
  it("SCRUM-165/AC1 shows the ready count as a link to /safety-checks", async () => {
    await renderPage(home());

    const figure = screen.getByText("Ready for check").closest("li")!;
    expect(within(figure).getByRole("link", { name: "2" }).getAttribute("href")).toBe("/safety-checks");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening), Nadia$/);
  });

  it("SCRUM-165/AC1 opens the first waiting event from Start next check", async () => {
    await renderPage(home());

    expect(screen.getByRole("link", { name: /Start next check/ }).getAttribute("href")).toBe("/safety-checks/e1");
  });
});

describe("SCRUM-165/AC2 an event back after changes is marked Re-check needed", () => {
  it("SCRUM-165/AC2 tags only the re-check row, with a label and Review change", async () => {
    await renderPage(home());

    const first = rowOf("Annual Tech Summit 2026");
    const second = rowOf("Alumni Networking Night");
    expect(within(first).getByText("Safety check")).toBeTruthy();
    expect(within(first).getByRole("link", { name: "Start check: Annual Tech Summit 2026" })).toBeTruthy();
    expect(within(first).queryByText("Re-check needed")).toBeNull();
    expect(within(second).getByText("Re-check needed")).toBeTruthy();
    expect(within(second).getByRole("link", { name: "Review change: Alumni Networking Night" })).toBeTruthy();
  });
});

describe("SCRUM-165/AC3 nothing waiting shows an empty state", () => {
  it("SCRUM-165/AC3 says no events are waiting and offers no Start next check", async () => {
    await renderPage(home({ ready: [] }));

    expect(screen.getByRole("status").textContent).toContain("No events are waiting for a safety check.");
    expect(screen.queryByRole("link", { name: /Start next check/ })).toBeNull();
  });

  it("SCRUM-165/AC3 shows the error instead of the page when the Home cannot load", async () => {
    await renderPage({ error: "We couldn't load your safety home." });

    expect(screen.getByRole("alert").textContent).toContain("couldn't load");
  });
});

describe("SCRUM-165 alignment: every row has the same tag and action columns", () => {
  it("SCRUM-165/AC2 gives every tag column and button the same fixed width", async () => {
    await renderPage(home());

    const buttons = screen.getAllByRole("link", { name: /^(Start check|Review change):/ });
    expect(buttons.length).toBe(2);
    for (const b of buttons) {
      expect(b.className).toContain("sm:w-32");
      expect(b.previousElementSibling?.className).toContain("sm:w-40");
    }
  });
});

describe("SCRUM-165 helpers", () => {
  it("SCRUM-165/AC1 greets by the hour in Singapore", () => {
    expect(greeting("Nadia Hassan", new Date("2026-11-01T00:00:00Z"))).toBe("Good morning, Nadia");
    expect(greeting("Nadia Hassan", new Date("2026-11-01T06:00:00Z"))).toBe("Good afternoon, Nadia");
    expect(greeting("", new Date("2026-11-01T13:00:00Z"))).toBe("Good evening");
  });

  it("SCRUM-165/AC1 summarises an event and each decision", () => {
    expect(eventSummary(event())).toBe("450 people across 4 spaces · Sat 14 Nov");
    expect(eventSummary(event({ expected_attendance: 1, venue_names: ["Hall"], start: null }))).toBe("1 person across 1 space");
    expect(eventSummary(event({ expected_attendance: null, venue_names: ["Hall"], start: null }))).toBe("Hall");
    expect(eventSummary(event({ expected_attendance: null, venue_names: [], start: null }))).toBe("Details not specified");
    expect(eventSummary(event({ expected_attendance: 5, venue_names: [], start: null }))).toBe("5 people");
    expect(decisionView({ event_id: "x", name: "x", decision: "rejected", decided_at: "2026-10-03T05:00:00Z" })).toMatchObject({
      display: { label: "Rejected" },
      note: "Rejected 3 Oct",
    });
  });
});
