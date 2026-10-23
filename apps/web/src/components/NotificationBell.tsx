"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { NotificationItem } from "@spm-t5/shared";
import { NotificationRow } from "@/components/NotificationRow";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchNotifications, fetchUnreadCount, markNotificationRead } from "@/lib/notifications";

// SCRUM-141/AC10: what a tab shows when it has nothing to list.
function Empty({ unreadTab }: { unreadTab: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <CheckCheck aria-hidden="true" className="size-7 text-muted-foreground" />
      <p className="text-sm font-semibold text-foreground">{unreadTab ? "You're all caught up." : "You have no notifications."}</p>
      <p className="text-xs text-muted-foreground">
        {unreadTab ? "New notifications will show up here." : "Changes to your events and bookings will show up here."}
      </p>
    </div>
  );
}

// SCRUM-141/AC10: three placeholder rows while the list loads.
function Loading() {
  return (
    <div role="status" aria-label="Loading notifications" className="space-y-4 p-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

// SCRUM-47/AC11: the bell in the app shell's sidebar. It reads notification-service from the browser, so any page can show it
// without loading notifications on the server. SCRUM-141: its popover has All and Unread tabs.
export function NotificationBell() {
  const router = useRouter();
  const [unread, setUnread] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    fetchUnreadCount().then((n) => {
      if (live) setUnread(n);
    });
    return () => {
      live = false;
    };
  }, []);

  async function onOpenChange(opening: boolean) {
    setOpen(opening);
    if (!opening) return;
    setError(undefined);
    const { ok, data } = await fetchNotifications();
    if (!ok) {
      setError("We couldn't load your notifications. Please try again.");
      return;
    }
    setItems(data.items);
  }

  // SCRUM-46/AC4: marks one read (a read one is left alone); false if the service refused
  async function markRead(item: NotificationItem): Promise<boolean> {
    if (item.isRead) return true;
    const { ok } = await markNotificationRead(item.id);
    if (!ok) return false;
    setUnread((n) => (n === null ? n : Math.max(0, n - 1)));
    setItems((current) => current?.map((i) => (i.id === item.id ? { ...i, isRead: true } : i)));
    return true;
  }

  // SCRUM-141/AC2, as on the Notifications page (SCRUM-46/AC4, AC5): mark it read first, then open what it is about
  async function choose(item: NotificationItem) {
    if (!(await markRead(item))) return;
    setOpen(false);
    if (item.related?.href) router.push(item.related.href);
  }

  // a number only when there is something unread (and the count could be loaded)
  const count = unread !== null && unread > 0 ? unread : null;
  const unreadItems = items?.filter((i) => !i.isRead);

  const list = (rows: NotificationItem[], unreadTab: boolean) =>
    rows.length === 0 ? (
      <Empty unreadTab={unreadTab} />
    ) : (
      <div className="max-h-96 overflow-y-auto">
        <ul aria-label={unreadTab ? "Unread notifications" : "Notifications"} className="divide-y divide-border">
          {rows.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => choose(item)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <NotificationRow item={item} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
        className="relative flex size-9 items-center justify-center rounded-lg text-nav-text outline-none hover:bg-nav-chip focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell aria-hidden="true" className="size-5" />
        {count && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-primary-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <Tabs defaultValue="all">
          <div className="px-4 pt-4">
            <h2 className="font-heading text-base font-bold text-foreground">Notifications</h2>
          </div>
          <TabsList variant="line" className="mt-2 w-full justify-start gap-4 border-b border-border px-4">
            <TabsTrigger value="all" className="flex-none">All</TabsTrigger>
            <TabsTrigger value="unread" className="flex-none">
              Unread
              {unreadItems && unreadItems.length > 0 && <Badge variant="info">{unreadItems.length}</Badge>}
            </TabsTrigger>
          </TabsList>
          {/* SCRUM-141/AC10: loading, error, then the list */}
          {error ? (
            <div className="p-4">
              <Alert variant="danger">{error}</Alert>
            </div>
          ) : !items ? (
            open && <Loading />
          ) : (
            <>
              <TabsContent value="all">{list(items, false)}</TabsContent>
              <TabsContent value="unread">{list(unreadItems ?? [], true)}</TabsContent>
            </>
          )}
        </Tabs>
        {/* the full page also has the technicians' Acknowledge (SCRUM-20) */}
        <Link
          href="/notifications"
          onClick={() => setOpen(false)}
          className="border-t border-border px-4 py-3 text-center text-sm font-semibold text-fg-primary outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          View all notifications
        </Link>
      </PopoverContent>
    </Popover>
  );
}
