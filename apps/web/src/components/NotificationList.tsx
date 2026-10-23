"use client";

import { CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotificationItem } from "@spm-t5/shared";
import { NotificationRow } from "@/components/NotificationRow";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatSgt } from "@/lib/bookingQueue";
import { acknowledgeNotification, markNotificationRead } from "@/lib/notifications";
import { groupByDay } from "@/lib/notificationDisplay";
import { cn } from "@/lib/utils";

// SCRUM-46: the signed-in user's notifications. An unread row is bold with a dot and a tinted background, so colour alone
// never carries the meaning (AC3; SCRUM-141/AC3). Selecting a row marks it read, then opens its target when the user can
// still see it (AC4, AC5); a target they cannot see shows the no-access wording and goes nowhere (AC7).
export function NotificationList({ items: initial }: { items: NotificationItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string>();
  const [now] = useState(() => Date.now());

  async function markRead(item: NotificationItem): Promise<boolean> {
    if (item.isRead) return true;
    const { ok, data } = await markNotificationRead(item.id);
    if (!ok) {
      setError(data.error ?? "We couldn't mark that notification as read. Please try again.");
      return false;
    }
    setError(undefined);
    setItems((current) => current.map((i) => (i.id === item.id ? { ...i, isRead: true, readAt: data.readAt ?? i.readAt } : i)));
    router.refresh();
    return true;
  }

  // SCRUM-20/AC4, AC5: acknowledging an assignment notification marks it read and the assignment acknowledged
  async function acknowledge(item: NotificationItem) {
    const { ok, data } = await acknowledgeNotification(item.id);
    if (!ok) {
      setError(data.error ?? "We couldn't acknowledge that notification. Please try again.");
      return;
    }
    setError(undefined);
    setItems((current) => current.map((i) => (i.id === item.id ? data : i)));
    router.refresh();
  }

  async function open(item: NotificationItem) {
    if (!(await markRead(item))) return;
    if (item.related?.href) router.push(item.related.href);
  }

  // counted from the rows on screen, so it never disagrees with them while a refresh is on its way
  const unreadCount = items.filter((i) => !i.isRead).length;
  const unreadItems = items.filter((i) => !i.isRead);
  const actionItems = items.filter((i) => i.actionRequired && !i.isRead);

  // SCRUM-141/AC10: a designed empty state
  if (items.length === 0) {
    return (
      <>
        <p className="mb-4 text-sm text-muted-foreground">0 unread</p>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <CheckCheck aria-hidden="true" className="size-8 text-muted-foreground" />
          <p className="font-semibold text-foreground">You have no notifications.</p>
          <p className="text-sm text-muted-foreground">Changes to your events and bookings will show up here.</p>
        </div>
      </>
    );
  }

  // SCRUM-141: Today, Yesterday and Earlier, each its own list under a heading
  const groups = (rows: NotificationItem[], emptyText: string) =>
    rows.length === 0 ? (
      <p className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
    ) : (
      <div className="space-y-6">
        {groupByDay(rows, now).map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{group.label}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {group.items.map((item) => (
                <li key={item.id} className={cn("flex flex-wrap items-start gap-4 p-5 sm:flex-nowrap sm:gap-6 sm:p-6", !item.isRead && "bg-secondary")}>
                  <button
                    type="button"
                    onClick={() => open(item)}
                    className="flex min-w-0 flex-1 items-start gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <NotificationRow item={item} detailed />
                  </button>
                  <div className="flex shrink-0 flex-col items-start gap-2 max-sm:w-full max-sm:flex-row sm:items-end">
                    {item.acknowledgement?.acknowledgedAt && (
                      <span className="text-xs text-muted-foreground">Acknowledged on {formatSgt(item.acknowledgement.acknowledgedAt)}</span>
                    )}
                    {item.acknowledgement?.canAcknowledge && (
                      <Button size="sm" onClick={() => acknowledge(item)}>Acknowledge</Button>
                    )}
                    {/* SCRUM-141: a row that needs action says what to do next, not just what happened */}
                    {item.actionRequired && item.related?.href && (
                      <Button size="sm" variant="outline" onClick={() => open(item)}>Open</Button>
                    )}
                    {!item.isRead && (
                      <Button size="sm" variant="ghost" onClick={() => markRead(item)}>Mark as read</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );

  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">{unreadCount} unread</p>
      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}
      <Tabs defaultValue="all" className="gap-4">
        <TabsList variant="line" className="w-full justify-start gap-4 border-b border-border">
          <TabsTrigger value="all" className="flex-none">All</TabsTrigger>
          <TabsTrigger value="unread" className="flex-none">
            Unread
            {unreadItems.length > 0 && <Badge variant="info">{unreadItems.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="action" className="flex-none">
            Action needed
            {actionItems.length > 0 && <Badge variant="warning">{actionItems.length}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all">{groups(items, "You have no notifications.")}</TabsContent>
        <TabsContent value="unread">{groups(unreadItems, "You're all caught up.")}</TabsContent>
        <TabsContent value="action">{groups(actionItems, "Nothing needs your action right now.")}</TabsContent>
      </Tabs>
    </>
  );
}
