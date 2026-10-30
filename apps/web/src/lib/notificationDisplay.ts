import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  FileText,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { NotificationType } from "@spm-t5/shared";
import type { StatusTone } from "@/lib/status";

// SCRUM-141/AC3, AC6: each notification type gets one icon and one status tone, so the kind of change is never carried
// by colour alone. A type this list does not know (the column is free text) falls back to a neutral bell.
export interface NotificationDisplay {
  icon: LucideIcon;
  tone: StatusTone;
}

const BY_TYPE: Record<NotificationType, NotificationDisplay> = {
  event_submitted: { icon: FileText, tone: "info" },
  coordinator_assigned: { icon: Users, tone: "info" },
  coordinator_reassigned: { icon: Users, tone: "info" },
  event_confirmed: { icon: CheckCircle2, tone: "success" },
  registration_opened: { icon: Users, tone: "info" },
  venue_booking_flagged: { icon: AlertTriangle, tone: "warning" },
  technical_assignment_assigned: { icon: Users, tone: "info" },
  technical_assignment_changed: { icon: RefreshCw, tone: "info" },
  technical_assignment_cancelled: { icon: XCircle, tone: "danger" },
  event_approved: { icon: CheckCircle2, tone: "success" },
  event_rejected: { icon: XCircle, tone: "danger" },
  comment_mention: { icon: MessageSquare, tone: "info" },
  comment_reply: { icon: MessageSquare, tone: "info" },
  safety_approved: { icon: ShieldCheck, tone: "success" },
  safety_rejected: { icon: ShieldAlert, tone: "danger" },
  safety_changes_requested: { icon: ShieldAlert, tone: "danger" },
  clarification_requested: { icon: MessageSquare, tone: "warning" },
  clarification_answered: { icon: MessageSquare, tone: "info" },
  venue_booking_approved: { icon: CheckCircle2, tone: "success" },
  venue_booking_rejected: { icon: XCircle, tone: "danger" },
  event_changed: { icon: RefreshCw, tone: "info" },
  registration_status_changed: { icon: Users, tone: "info" },
  event_cancelled: { icon: XCircle, tone: "danger" },
  venue_replaced: { icon: RefreshCw, tone: "info" },
};

export const notificationDisplay = (type: string): NotificationDisplay =>
  (BY_TYPE as Record<string, NotificationDisplay | undefined>)[type] ?? { icon: Bell, tone: "neutral" };

/** Tinted circle behind a type icon: the same tone families as StatusBadge, as static class names Tailwind can see. */
export const TONE_BUBBLE: Record<StatusTone, string> = {
  neutral: "bg-status-neutral text-status-neutral-fg",
  info: "bg-status-info text-status-info-fg",
  warning: "bg-status-warning text-status-warning-fg",
  success: "bg-status-success text-status-success-fg",
  danger: "bg-status-danger text-status-danger-fg",
};

/** The full date and time in Singapore time, as the Notifications page shows it. */
export const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

/** "2 min ago", "3 h ago", "Yesterday", then the date: the short form the popover shows (the full time is its tooltip). */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-SG", { dateStyle: "medium", timeZone: "Asia/Singapore" });
}

export type DayGroup<T> = { label: "Today" | "Yesterday" | "Earlier"; items: T[] };

const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

/** SCRUM-141: splits a newest-first list into Today, Yesterday and Earlier (Singapore days), keeping the order and dropping empty groups. */
export function groupByDay<T extends { createdAt: string }>(items: T[], now: number = Date.now()): DayGroup<T>[] {
  const today = day(now);
  const yesterday = day(now - 24 * 60 * 60 * 1000);
  const groups: DayGroup<T>[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Earlier", items: [] },
  ];
  for (const item of items) {
    const d = day(new Date(item.createdAt).getTime());
    groups[d === today ? 0 : d === yesterday ? 1 : 2].items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}
