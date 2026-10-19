import { AlertTriangle, CheckCircle2, Circle, Info, Pause, TimerOff, XCircle, type LucideIcon } from "lucide-react";

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
