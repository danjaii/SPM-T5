import type { NotificationItem } from "@spm-t5/shared";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatWhen, notificationDisplay, relativeTime, TONE_BUBBLE } from "@/lib/notificationDisplay";
import { cn } from "@/lib/utils";

// SCRUM-141/AC3: what one notification looks like, in the popover and on the Notifications page. An unread one has a bold
// title, a dot and the words "Unread" for screen readers, so it is never marked by colour alone. AC6: "Action needed" is
// a StatusBadge, and the type icon sits in a tinted circle.
export function NotificationRow({ item, detailed = false }: { item: NotificationItem; detailed?: boolean }) {
  const { icon: Icon, tone } = notificationDisplay(item.type);
  return (
    <>
      <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", TONE_BUBBLE[tone])}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className={cn("block text-sm text-foreground", item.isRead ? "font-medium" : "font-bold")}>{item.title}</span>
        {detailed && <span className="block text-sm text-muted-foreground">{item.message}</span>}
        {/* which event or booking it is about, or the no-access wording (SCRUM-46/AC7) */}
        {item.related && (
          <span className="block text-xs text-muted-foreground">
            {detailed && item.related.href ? `Related: ${item.related.label}` : item.related.label}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <time dateTime={item.createdAt} title={formatWhen(item.createdAt)}>
            {detailed ? formatWhen(item.createdAt) : relativeTime(item.createdAt)}
          </time>
          {item.actionRequired && <StatusBadge tone="warning" label="Action needed" />}
        </span>
      </span>
      {!item.isRead && (
        <>
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
          <span className="sr-only">Unread</span>
        </>
      )}
    </>
  );
}
