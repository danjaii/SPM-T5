import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// SCRUM-47/AC11: every signed-in page's header has the notification bell, which calls notification-service from the
// browser. Page tests are about their page, so the bell is left out of them; the tests about the bell itself
// (notification-bell, app-header, dashboard-view) bring the real one back with vi.unmock.
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));

// Vitest globals are off, so Testing Library can't register its own auto-cleanup.
afterEach(() => {
  cleanup();
});
