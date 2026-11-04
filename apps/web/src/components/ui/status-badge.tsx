import { AlertTriangle, BadgeCheck, Ban, CalendarCheck, CheckCircle2, Circle, ClipboardList, Clock, Hourglass, Info, Pause, Pencil, Repeat, Search, Send, TimerOff, Undo2, XCircle, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TONE_ICONS, type StatusDisplay, type StatusIconName, type StatusTone } from "@/lib/status";

const ICONS: Record<StatusIconName, LucideIcon> = {
  circle: Circle,
  info: Info,
  alert: AlertTriangle,
  check: CheckCircle2,
  x: XCircle,
  pause: Pause,
  "timer-off": TimerOff,
  pencil: Pencil,
  send: Send,
  search: Search,
  undo: Undo2,
  clipboard: ClipboardList,
  hourglass: Hourglass,
  "calendar-check": CalendarCheck,
  "badge-check": BadgeCheck,
  ban: Ban,
  clock: Clock,
  repeat: Repeat,
};

interface Props extends Partial<StatusDisplay> {
  label: string;
  tone?: StatusTone;
  className?: string;
}

// SCRUM-120/AC2: Figma App/Status Badge. Always a tinted tone with an icon and a label, never a solid fill, so a status
// can't be mistaken for a button and isn't conveyed by colour alone.
export function StatusBadge({ label, tone = "neutral", icon, className }: Props) {
  const Icon = ICONS[icon ?? TONE_ICONS[tone]];
  return (
    <Badge variant={tone} data-tone={tone} className={cn("h-auto gap-1.5 py-0.5 pr-2.5 pl-2 font-bold tracking-wide", className)}>
      <Icon aria-hidden="true" data-testid="status-icon" />
      {label}
    </Badge>
  );
}

const TONE_TEXT: Record<StatusTone, string> = {
  neutral: "text-status-neutral-fg",
  info: "text-status-info-fg",
  warning: "text-status-warning-fg",
  success: "text-status-success-fg",
  danger: "text-status-danger-fg",
};

/** The status icon alone, tinted by its tone, for compact places (a filter tab) that put the label beside it. */
export function StatusIcon({ tone = "neutral", icon, className }: Partial<StatusDisplay> & { className?: string }) {
  const Icon = ICONS[icon ?? TONE_ICONS[tone]];
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", TONE_TEXT[tone], className)} />;
}
