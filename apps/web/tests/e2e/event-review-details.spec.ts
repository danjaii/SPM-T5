import { test, expect } from "@playwright/test";

test("ER-01/AC2 displays submitted request details on the detail route", async ({ page, baseURL }) => {
  const detail = {
    id: "10000000-0000-4000-8000-000000000001", organiser_name: "Jason Chua",
    name: "Community workshop", purpose: "Learn together",
    preferred_start_datetime: "2026-10-01T01:00:00Z", preferred_end_datetime: "2026-10-01T03:00:00Z",
    expected_attendance: 25, layout_preferences: "Classroom", accessibility_requirements: "Step-free access",
    equipment_requirements_notes: "Projector", submitted_at: "2026-09-28T02:00:00Z", status: "submitted",
  };
  await page.route(`http://localhost:4006/review/requests/${detail.id}`, (route) => route.fulfill({
    status: 200, contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": baseURL!, "Access-Control-Allow-Credentials": "true" },
    body: JSON.stringify(detail),
  }));
  await page.goto(`/event-review/requests/${detail.id}`);
  await expect(page.getByRole("heading", { name: detail.name })).toBeVisible();
  const fields = {
    "Event organiser": "Jason Chua", "Event purpose": "Learn together",
    "Preferred start": "01 Oct 2026, 09:00 SGT", "Preferred end": "01 Oct 2026, 11:00 SGT",
    "Expected attendees": "25", "Layout preferences": "Classroom",
    "Accessibility needs": "Step-free access", "Equipment needs": "Projector",
    "Submission date": "28 Sept 2026, 10:00 SGT", "Current status": "Submitted",
  };
  for (const [label, value] of Object.entries(fields)) {
    await expect(page.locator("dt").filter({ hasText: label }).locator("+ dd")).toHaveText(value);
  }
});
