import { AlertTriangle, TimerOff } from "lucide-react";
import { holdNotice } from "@/lib/holds";
import type { VenueBookingListItem } from "@/lib/venueBookings";
import { cn } from "@/lib/utils";

// SCRUM-108/AC2, AC3, AC5: the hold's warning or expired line on the coordinator's list and detail page (nothing when there is none).
export function HoldNoticeText({ booking, now, block = false }: { booking: Pick<VenueBookingListItem, "status" | "holdExpiresAt" | "holdWarningMinutes">; now: Date; block?: boolean }) {
  const notice = holdNotice(booking, now);
  if (!notice) return null;
  const Icon = notice.kind === "warning" ? AlertTriangle : TimerOff;
  return (
    <p
      data-testid={notice.kind === "warning" ? "hold-warning" : "hold-expired"}
      className={cn("flex items-center gap-1.5 text-sm font-semibold", notice.kind === "warning" ? "text-status-warning-fg" : "text-status-danger-fg", block && "rounded-lg border px-3 py-2")}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {notice.text}
    </p>
  );
}
