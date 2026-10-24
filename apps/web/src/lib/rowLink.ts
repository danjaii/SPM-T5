import type { MouseEvent } from "react";

/** SCRUM-151: the row's hover and keyboard-focus look, so a row that opens something shows it can be clicked. */
export const LINKED_ROW_CLASS = "cursor-pointer hover:bg-muted has-focus-visible:bg-muted";

/** SCRUM-151/AC4: the focus ring on the row's link, the row's one Tab stop. */
export const ROW_LINK_FOCUS_CLASS = "focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * SCRUM-151/AC3: opens `href` from a click anywhere on a table row. A click on a link inside the row is left to that link,
 * so the page is not opened twice; a click with a modifier key is left to the browser.
 */
export function openRowLink(e: MouseEvent<HTMLElement>, push: (href: string) => void, href: string) {
  if ((e.target as Element).closest("a") || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  push(href);
}
