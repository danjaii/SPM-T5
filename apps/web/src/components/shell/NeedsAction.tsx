"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { NAV_ITEMS, type QueueKey } from "@/lib/nav";
import { useShell } from "./ShellContext";

const WORDING: Record<QueueKey, (n: number) => string> = {
  leadQueue: (n) => `${n} unassigned event ${n === 1 ? "request" : "requests"} waiting for a coordinator`,
  bookingQueue: (n) => `${n} venue booking ${n === 1 ? "request" : "requests"} to decide`,
  equipmentQueue: (n) => `${n} equipment ${n === 1 ? "request" : "requests"} to review`,
  safetyQueue: (n) => `${n} ${n === 1 ? "event" : "events"} waiting for a safety check`,
};

// SCRUM-162/AC4: a queue can name what is missing instead of the general sentence.
const EMPTY: Partial<Record<QueueKey, string>> = { leadQueue: "No unassigned event requests." };

/**
 * SCRUM-121: "Needs your action" on a role's home page, from the same queue counts as the sidebar. Roles without a queue
 * have nothing to list yet, and outside the shell (no counts) it renders nothing.
 */
export function NeedsAction() {
  const shell = useShell();
  if (!shell) return null;
  const queues = NAV_ITEMS[shell.user.role].filter((i) => i.queue);
  if (queues.length === 0) return null;

  // a count that could not be loaded is unknown, not zero: say nothing rather than "nothing needs your action"
  if (queues.every((i) => shell.counts[i.queue!] === undefined)) return null;

  const waiting = queues.flatMap((i) => {
    const n = shell.counts[i.queue!];
    return n ? [{ href: i.href, text: WORDING[i.queue!](n) }] : [];
  });

  return (
    <section aria-labelledby="needs-action" className="mb-8 rounded-xl border border-border bg-card p-4">
      <h2 id="needs-action" className="mb-3 text-lg font-bold">Needs your action</h2>
      {waiting.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {(queues.length === 1 && EMPTY[queues[0].queue!]) || "Nothing needs your action right now."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {waiting.map((w) => (
            <li key={w.href} className="flex flex-wrap items-center gap-3">
              <StatusBadge tone="warning" label="Action needed" />
              <Link href={w.href} className="text-sm font-medium text-fg-primary underline">{w.text}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
