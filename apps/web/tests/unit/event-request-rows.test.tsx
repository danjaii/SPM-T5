// SCRUM-151 — clickable things look clickable: an Event Coordinator's event request rows on Event requests

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReviewQueueTable } from "@/components/ReviewQueueTable";
import type { ReviewQueueItem } from "@/lib/eventsApi";

const item = (over: Partial<ReviewQueueItem> = {}): ReviewQueueItem => ({
  id: "evt-1",
  name: "Tech Summit",
  status: "submitted",
  submitted_at: "2031-06-01T02:00:00Z",
  organiser_name: "Jason Chua",
  ...over,
});

/** The table's event rows, without the header row. */
const eventRows = () => screen.getAllByRole("row").slice(1);

// jsdom does not apply Tailwind's styles, so these check for the classes that set the hover colour and the cursor.
describe("SCRUM-151/AC2 an event request row shows it can be clicked", () => {
  it("SCRUM-151/AC2 highlights the whole row in the muted tint on hover, which stands out on the white card", () => {
    render(<ReviewQueueTable events={[item(), item({ id: "evt-2", name: "Expo" })]} />);

    for (const row of eventRows()) expect(row.className).toContain("hover:bg-muted");
  });

  it("SCRUM-151/AC2 shows the hand cursor anywhere on the row", () => {
    render(<ReviewQueueTable events={[item()]} />);

    expect(eventRows()[0].className).toContain("cursor-pointer");
  });

  it("SCRUM-151/AC2 leaves the header row without the hover highlight or the hand", () => {
    render(<ReviewQueueTable events={[item()]} />);

    const header = screen.getAllByRole("row")[0];
    expect(header.className).not.toContain("hover:bg-muted");
    expect(header.className).not.toContain("cursor-pointer");
  });
});
